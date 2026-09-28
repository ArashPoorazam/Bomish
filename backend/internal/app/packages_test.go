package app

import (
	"bomish/internal/domain"
	"context"
	"encoding/json"
	"testing"
)

func TestPackagesOperations(t *testing.T) {
	a := setup(t)
	ctx := context.Background()
	h := a.Handler()
	owner := newClient(t, h)
	owner.staff(t, "owner")
	operator := newClient(t, h)
	operator.staff(t, "operator")
	editor := newClient(t, h)
	editor.staff(t, "editor")
	c := newClient(t, h)
	var p domain.Product
	c.ok(t, "GET", "/products/turmeric", nil, &p)
	p.Packages = []domain.Package{{ID: "small", Amount: 200, Unit: "g", PriceRials: 2000000, MaxQuantity: 5}, {ID: "large", Amount: .5, Unit: "kg", PriceRials: 4000000, MaxQuantity: 5}}
	p.Sections = []domain.Section{{Title: "عنوان سفارشی", Body: "**متن**"}}
	owner.ok(t, "PUT", "/staff/products/turmeric", p, nil)
	owner.ok(t, "POST", "/staff/products/turmeric/publish", nil, nil)
	c.ok(t, "PUT", "/cart/items/turmeric", map[string]any{"packageId": "small", "quantity": 2}, nil)
	c.ok(t, "PUT", "/cart/items/turmeric", map[string]any{"packageId": "large", "quantity": 1}, nil)
	var cart domain.Cart
	c.ok(t, "GET", "/cart", nil, &cart)
	if len(cart.Items) != 2 || cart.SubtotalRials != 8000000 {
		t.Fatalf("separate lines/price %+v", cart)
	}
	for _, body := range []map[string]any{{"packageId": "small", "quantity": 6}, {"packageId": "invalid", "quantity": 1}, {"packageId": "small", "quantity": 0}, {"grams": 400}} {
		if code, _ := c.call("PUT", "/cart/items/turmeric", body); code != 400 {
			t.Fatalf("invalid package accepted %d", code)
		}
	}
	c.ok(t, "DELETE", "/cart/items/turmeric?packageId=small", nil, &cart)
	if len(cart.Items) != 1 || cart.Items[0].Package.ID != "large" {
		t.Fatal("delete affected wrong package")
	}
	c.ok(t, "PUT", "/cart/items/turmeric", map[string]any{"packageId": "small", "quantity": 2}, nil)
	c.login(t, "09123334444")
	var shipping shippingConfig
	owner.ok(t, "GET", "/staff/shipping", nil, &shipping)
	shipping.FreeShippingRials = 8000000
	owner.ok(t, "PUT", "/staff/shipping", shipping, nil)
	var q quoteResult
	c.ok(t, "POST", "/checkout/quote", map[string]string{"province": "تهران"}, &q)
	if q.ShippingRials != 0 {
		t.Fatal("threshold not inclusive")
	}
	addr := domain.Address{Recipient: "مشتری", Phone: "09123334444", Province: "تهران", City: "تهران", Street: "خیابان آزمایشی، پلاک ۱", PostalCode: "1234567890"}
	lat, lng := 35.7, 51.4
	addr.Latitude = &lat
	addr.Longitude = &lng
	c.ok(t, "POST", "/addresses", addr, nil)
	var addresses []domain.Address
	c.ok(t, "GET", "/addresses", nil, &addresses)
	if len(addresses) != 1 || addresses[0].Latitude == nil || *addresses[0].Longitude != lng {
		t.Fatal("map coordinates lost")
	}
	var result map[string]string
	c.ok(t, "POST", "/checkout", map[string]any{"address": addr, "expectedTotalRials": q.TotalRials, "idempotencyKey": "package-checkout-0001"}, &result)
	id := result["orderId"]
	c.ok(t, "POST", "/orders/"+id+"/simulate", map[string]bool{"success": true}, nil)
	c.ok(t, "GET", "/cart", nil, &cart)
	if len(cart.Items) != 0 {
		t.Fatal("mixed package cart not cleared")
	}
	if code, _ := operator.call("PATCH", "/staff/orders/"+id, map[string]string{"status": "shipped", "tracking": "123456789012345678901234"}); code != 409 {
		t.Fatal("skipped stage")
	}
	operator.ok(t, "PATCH", "/staff/orders/"+id, map[string]string{"status": "packing"}, nil)
	if code, _ := operator.call("PATCH", "/staff/orders/"+id, map[string]string{"status": "shipped"}); code != 400 {
		t.Fatal("missing tracking accepted")
	}
	operator.ok(t, "PATCH", "/staff/orders/"+id, map[string]string{"status": "shipped", "tracking": "123456789012345678901234"}, nil)
	operator.ok(t, "PATCH", "/staff/orders/"+id, map[string]string{"status": "received"}, nil)
	if code, _ := operator.call("PATCH", "/staff/orders/"+id, map[string]string{"status": "received"}); code != 409 {
		t.Fatal("duplicate stage accepted")
	}
	var detail struct {
		Order       domain.Order `json:"order"`
		TrackingURL string       `json:"trackingUrl"`
	}
	c.ok(t, "GET", "/orders/"+id, nil, &detail)
	if len(detail.Order.Events) != 4 || len(detail.Order.Items) != 2 || detail.Order.Tracking == "" || detail.TrackingURL != "https://pishkhan24.com/posttracking/?barcode=123456789012345678901234" {
		t.Fatalf("history/track %+v", detail)
	}
	var count int
	a.Pool.QueryRow(ctx, "SELECT count(*) FROM jobs WHERE kind='order_sms' AND payload->>'orderId'=$1", id).Scan(&count)
	if count != 4 {
		t.Fatalf("SMS jobs %d", count)
	}
	outsider := newClient(t, h)
	outsider.login(t, "09125556666")
	if code, _ := outsider.call("GET", "/orders/"+id, nil); code != 404 {
		t.Fatal("order leaked")
	}
	if code, _ := editor.call("POST", "/staff/product-discounts", map[string]any{"id": "all-sale", "name": "Store sale", "all": true, "percent": 10}); code != 201 {
		t.Fatal("editor could not modify pricing")
	}
	owner.ok(t, "POST", "/staff/product-discounts", map[string]any{"id": "single-sale", "name": "Single sale", "productIds": []string{"turmeric"}, "percent": 10}, nil)
	owner.ok(t, "POST", "/staff/pricing", map[string]any{"productIds": []string{"turmeric"}, "amount": 100000}, nil)
	c.ok(t, "GET", "/products/turmeric", nil, &p)
	if p.DiscountPercent != 10 || p.Packages[0].PriceRials != 2100000 || p.PackagePrice(p.Packages[0]) != 1890000 {
		t.Fatal("price control wrong")
	}
	if code, _ := owner.call("POST", "/staff/pricing", map[string]any{"all": true, "amount": -10000000000}); code != 400 {
		t.Fatal("negative price allowed")
	}
	c.ok(t, "GET", "/products/turmeric", nil, &p)
	if p.Packages[0].PriceRials != 2100000 {
		t.Fatal("partial price update")
	}
	// Product statistics count paid package quantities, and events are session-deduplicated.
	c.ok(t, "POST", "/events", map[string]string{"kind": "view", "productId": "turmeric"}, nil)
	c.ok(t, "POST", "/events", map[string]string{"kind": "view", "productId": "turmeric"}, nil)
	c.ok(t, "POST", "/events", map[string]string{"kind": "search", "query": "زردچوبه"}, nil)
	var report map[string]json.RawMessage
	owner.ok(t, "GET", "/omnisire/analytics?section=overview", nil, &report)
	if len(report["items"]) == 0 || len(report["columns"]) == 0 {
		t.Fatal("analytics missing")
	}
	for _, cli := range []*client{c, editor, operator} {
		if code, _ := cli.call("GET", "/omnisire/analytics", nil); code != 403 {
			t.Fatal("business data leaked")
		}
	}
	// Expiry still closes an unpaid order without changing product availability.
	c.ok(t, "PUT", "/cart/items/turmeric", map[string]any{"packageId": "small", "quantity": 1}, nil)
	c.ok(t, "PUT", "/cart/items/turmeric", map[string]any{"packageId": "large", "quantity": 1}, nil)
	c.ok(t, "POST", "/checkout/quote", map[string]string{"province": "تهران"}, &q)
	c.ok(t, "POST", "/checkout", map[string]any{"address": addr, "expectedTotalRials": q.TotalRials, "idempotencyKey": "package-expiry-00001"}, &result)
	a.Pool.Exec(ctx, "UPDATE orders SET reservation_expires_at=now()-interval '1 second' WHERE id=$1", result["orderId"])
	if e := a.ExpireReservations(ctx); e != nil {
		t.Fatal(e)
	}
	var expiredStatus string
	if e := a.Pool.QueryRow(ctx, "SELECT status FROM orders WHERE id=$1", result["orderId"]).Scan(&expiredStatus); e != nil || expiredStatus != "expired" {
		t.Fatalf("expiry: %s %v", expiredStatus, e)
	}
	// An oil can define a volume package with an independent shipping weight.
	p.ID = "oil"
	p.Slug = "oil"
	p.Name = "روغن"
	p.Packages = []domain.Package{{ID: "bottle", Amount: 1.5, Unit: "l", PriceRials: 3000000, MaxQuantity: 5, ShippingGrams: 1450}}
	owner.ok(t, "PUT", "/staff/products/oil", p, nil)
	owner.ok(t, "POST", "/staff/products/oil/publish", nil, nil)
}
