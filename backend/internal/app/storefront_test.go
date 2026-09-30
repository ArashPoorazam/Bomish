package app

import (
	"bomish/internal/domain"
	"bomish/migrations"
	"context"
	"testing"
	"time"
)

func TestStorefrontPublicationAndDiscountOrdering(t *testing.T) {
	a := setup(t)
	c := newClient(t, a.Handler())
	owner := newClient(t, a.Handler())
	owner.staff(t, "owner")
	var p domain.Product
	c.ok(t, "GET", "/products/turmeric", nil, &p)
	if p.FirstPublishedAt != "" {
		t.Fatal("unknown publication was invented")
	}
	p.ID = "new-redesign"
	p.Slug = p.ID
	p.Name = "محصول تازه"
	p.DiscountPercent = 10
	p.Packages = []domain.Package{{ID: "small", Amount: 100, Unit: "g", PriceRials: 470000, MaxQuantity: 5}}
	owner.ok(t, "PUT", "/staff/products/"+p.ID, p, nil)
	owner.ok(t, "POST", "/staff/products/"+p.ID+"/publish", nil, nil)
	c.ok(t, "GET", "/products/"+p.ID, nil, &p)
	first := p.FirstPublishedAt
	if first == "" {
		t.Fatal("missing first publication")
	}
	owner.ok(t, "PUT", "/staff/products/"+p.ID, p, nil)
	owner.ok(t, "POST", "/staff/products/"+p.ID+"/publish", nil, nil)
	c.ok(t, "GET", "/products/"+p.ID, nil, &p)
	if p.FirstPublishedAt != first {
		t.Fatal("republishing changed first publication")
	}
	var rows []domain.Product
	c.ok(t, "GET", "/products?sort=newest&pageSize=1", nil, &rows)
	if len(rows) != 1 || rows[0].ID != p.ID || rows[0].FirstPublishedAt != first {
		t.Fatalf("newest order: %+v", rows)
	}
	// A pricing operation does not make a legacy product newly published.
	owner.ok(t, "POST", "/staff/products/turmeric/publish", nil, nil)
	var legacy domain.Product
	c.ok(t, "GET", "/products/turmeric", nil, &legacy)
	if legacy.FirstPublishedAt != "" {
		t.Fatal("legacy date invented on republish")
	}
	owner.ok(t, "POST", "/staff/product-discounts", map[string]any{"id": "redesign-sale", "name": "Redesign sale", "percent": 10, "productIds": []string{p.ID}}, nil)
	c.ok(t, "GET", "/products?discounted=true&sort=price-asc&max=42999", nil, &rows)
	for _, x := range rows {
		if x.ID == p.ID {
			t.Fatal("filter used unrounded price")
		}
	}
	var page struct {
		Items []domain.Product
		Total int64
	}
	c.ok(t, "GET", "/products?discounted=true&ids="+p.ID+"&max=43000&page=1&pageSize=1", nil, &page)
	if page.Total != 1 || len(page.Items) != 1 {
		t.Fatalf("discounted page %+v", page)
	}
	c.ok(t, "PUT", "/cart/items/"+p.ID, map[string]any{"packageId": "small", "quantity": 2}, nil)
	var cart domain.Cart
	c.ok(t, "GET", "/cart", nil, &cart)
	if cart.SubtotalRials != 860000 {
		t.Fatalf("rounded cart %d", cart.SubtotalRials)
	}
	c.login(t, "09129991111")
	var quote quoteResult
	c.ok(t, "POST", "/checkout/quote", map[string]string{"province": "تهران"}, &quote)
	if quote.SubtotalRials != cart.SubtotalRials {
		t.Fatal("checkout differs from cart")
	}
}

func TestAddressManagementOwnershipAndOrderSnapshot(t *testing.T) {
	a := setup(t)
	ctx := context.Background()
	c := newClient(t, a.Handler())
	c.login(t, "09123334444")
	outsider := newClient(t, a.Handler())
	outsider.login(t, "09125556666")
	addr := domain.Address{Recipient: "مشتری", Phone: "09123334444", Province: "تهران", City: "تهران", Street: "خیابان آزمایشی، پلاک ۱", PostalCode: "1234567890"}
	c.ok(t, "POST", "/addresses", addr, &addr)
	path := "/addresses/" + addr.ID
	for _, method := range []string{"PUT", "DELETE"} {
		if code, _ := outsider.call(method, path, addr); code != 404 {
			t.Fatalf("%s leaked address: %d", method, code)
		}
	}
	// Existing orders hold their own address snapshots.
	c.ok(t, "PUT", "/cart/items/turmeric", map[string]any{"packageId": "test500", "quantity": 1}, nil)
	var quote quoteResult
	c.ok(t, "POST", "/checkout/quote", map[string]string{"province": "تهران"}, &quote)
	var order map[string]string
	c.ok(t, "POST", "/checkout", map[string]any{"address": addr, "expectedTotalRials": quote.TotalRials, "idempotencyKey": "redesign-address-snapshot"}, &order)
	addr.Street = "خیابان تازه، پلاک ۲"
	addr.Phone = "۰۹۱۲۳۳۳۴۴۴۴"
	addr.PostalCode = "۱۲۳۴۵۶۷۸۹۰"
	lat, lng := 35.7, 51.4
	addr.Latitude = &lat
	addr.Longitude = &lng
	var updated domain.Address
	c.ok(t, "PUT", path, addr, &updated)
	if updated.ID != addr.ID || updated.Phone != "09123334444" || updated.PostalCode != "1234567890" || updated.Latitude == nil {
		t.Fatal("address update failed")
	}
	invalid := addr
	invalid.PostalCode = "x"
	if code, _ := c.call("PUT", path, invalid); code != 400 {
		t.Fatal("invalid address accepted")
	}
	token := c.csrf
	c.csrf = "bad"
	if code, _ := c.call("DELETE", path, nil); code != 403 {
		t.Fatalf("CSRF: %d", code)
	}
	c.csrf = token
	c.ok(t, "DELETE", path, nil, nil)
	var addresses []domain.Address
	c.ok(t, "GET", "/addresses", nil, &addresses)
	for _, x := range addresses {
		if x.ID == addr.ID {
			t.Fatal("address not deleted")
		}
	}
	var street string
	if e := a.Pool.QueryRow(ctx, "SELECT address->>'street' FROM orders WHERE id=$1", order["orderId"]).Scan(&street); e != nil {
		t.Fatal(e)
	}
	if street != "خیابان آزمایشی، پلاک ۱" {
		t.Fatal("historical order was modified")
	}
	if code, _ := c.call("DELETE", path, nil); code != 404 {
		t.Fatal("missing address accepted")
	}
}

func TestPublicationMigrationBackfillsOnlyRecordedHistory(t *testing.T) {
	a := setup(t)
	ctx := context.Background()
	_, e := a.Pool.Exec(ctx, `ALTER TABLE products DROP COLUMN first_published_at; INSERT INTO audit_events(action,entity_id,created_at) VALUES ('product.publish','turmeric','2025-01-02'),('product.publish','turmeric','2025-02-03')`)
	if e != nil {
		t.Fatal(e)
	}
	migration, e := migrations.Files.ReadFile("008_storefront.sql")
	if e != nil {
		t.Fatal(e)
	}
	if _, e = a.Pool.Exec(ctx, string(migration)); e != nil {
		t.Fatal(e)
	}
	var first time.Time
	if e = a.Pool.QueryRow(ctx, "SELECT first_published_at FROM products WHERE id='turmeric'").Scan(&first); e != nil {
		t.Fatal(e)
	}
	if first.Year() != 2025 || first.Month() != 1 || first.Day() != 2 {
		t.Fatal("did not use first audited publication")
	}
	var unknown bool
	a.Pool.QueryRow(ctx, "SELECT first_published_at IS NULL FROM products WHERE id='mint'").Scan(&unknown)
	if !unknown {
		t.Fatal("unknown date invented")
	}
}
