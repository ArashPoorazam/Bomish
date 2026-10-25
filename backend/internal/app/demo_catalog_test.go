package app

import (
	"context"
	"testing"
)

func TestDemoProducts(t *testing.T) {
	products := demoProducts()
	if len(products) != 30 {
		t.Fatalf("products: %d", len(products))
	}
	ids := map[string]bool{}
	count := 0
	for _, p := range products {
		if err := p.Validate(true); err != nil {
			t.Fatalf("%s: %v", p.ID, err)
		}
		if ids[p.ID] {
			t.Fatalf("duplicate %s", p.ID)
		}
		ids[p.ID] = true
		if len(p.Packages) < 3 || len(p.Packages) > 4 {
			t.Fatalf("packages for %s", p.ID)
		}
		count += len(p.Packages)
		for _, pack := range p.Packages {
			if pack.PriceRials <= 0 || pack.PriceRials%10000 != 0 || pack.ShippingGrams < pack.Weight() {
				t.Fatalf("invalid pack: %+v", pack)
			}
			if pack.ShippingVerified {
				t.Fatal("demo measurements must not be marked merchant-verified")
			}
		}
	}
	if count != 110 {
		t.Fatalf("package count: %d", count)
	}
}

func TestDemoRefreshPreservesHistoryAndRevokesStaff(t *testing.T) {
	a := setup(t)
	ctx := context.Background()
	oldStaff := newClient(t, a.Handler())
	oldStaff.staff(t, "owner")
	if _, err := a.Pool.Exec(ctx, `INSERT INTO audit_events(staff_id,action,entity_id) VALUES('owner','fixture.history','turmeric')`); err != nil {
		t.Fatal(err)
	}
	if _, err := a.Pool.Exec(ctx, `INSERT INTO users(id,phone) VALUES('demo-history','09121112222'); INSERT INTO orders(id,user_id,idempotency_key,status,address,subtotal_rials,shipping_rials,total_rials,reservation_expires_at) VALUES('demo-history','demo-history','history','paid','{}',100000,0,100000,now()); INSERT INTO order_items(order_id,product_id,name,grams,price_rials,total_rials,package_id,package_label,quantity) VALUES('demo-history','turmeric','زردچوبه',100,100000,100000,'old','100 g',1)`); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if err := a.RefreshDemoCatalog(ctx); err != nil {
			t.Fatal(err)
		}
		var products, packages, staff, oldActive, history int
		if err := a.Pool.QueryRow(ctx, `SELECT count(*),sum(jsonb_array_length(content->'packages')) FROM products WHERE status='published'`).Scan(&products, &packages); err != nil {
			t.Fatal(err)
		}
		if err := a.Pool.QueryRow(ctx, `SELECT count(*) FROM staff WHERE active AND archived_at IS NULL`).Scan(&staff); err != nil {
			t.Fatal(err)
		}
		if err := a.Pool.QueryRow(ctx, `SELECT count(*) FROM staff WHERE id IN ('owner','editor','operator') AND active`).Scan(&oldActive); err != nil {
			t.Fatal(err)
		}
		if err := a.Pool.QueryRow(ctx, `SELECT count(*) FROM order_items WHERE order_id='demo-history' AND product_id='turmeric'`).Scan(&history); err != nil {
			t.Fatal(err)
		}
		if products != 30 || packages != 110 || staff != 5 || oldActive != 0 || history != 1 {
			t.Fatalf("unexpected state %d %d %d %d %d", products, packages, staff, oldActive, history)
		}
	}
	if code, _ := oldStaff.call("GET", "/staff/products", nil); code != 401 && code != 403 {
		t.Fatalf("old session still works: %d", code)
	}
	for _, role := range []string{"owner", "manager", "editor", "operator", "salesperson"} {
		newClient(t, a.Handler()).staff(t, role)
	}
	// A normal restart must leave edited data and account identities alone.
	var before string
	if err := a.Pool.QueryRow(ctx, "SELECT id FROM staff WHERE username='owner'").Scan(&before); err != nil {
		t.Fatal(err)
	}
	if err := a.Seed(ctx); err != nil {
		t.Fatal(err)
	}
	var after string
	if err := a.Pool.QueryRow(ctx, "SELECT id FROM staff WHERE username='owner'").Scan(&after); err != nil {
		t.Fatal(err)
	}
	if before != after {
		t.Fatal("startup replaced staff")
	}
	a.Dev = false
	if err := a.RefreshDemoCatalog(ctx); err == nil {
		t.Fatal("allowed production reset")
	}
}

func TestFreshDemoSeed(t *testing.T) {
	a := setupCatalog(t, false)
	ctx := context.Background()
	var products, staff, articles, suggestions int
	if err := a.Pool.QueryRow(ctx, `SELECT (SELECT count(*) FROM products WHERE status='published'),(SELECT count(*) FROM staff WHERE active),(SELECT count(*) FROM articles),(SELECT count(*) FROM product_suggestions)`).Scan(&products, &staff, &articles, &suggestions); err != nil {
		t.Fatal(err)
	}
	if products != 30 || staff != 5 || articles != 2 || suggestions != 8 {
		t.Fatalf("fresh seed: %d %d %d %d", products, staff, articles, suggestions)
	}
	if err := a.Seed(ctx); err != nil {
		t.Fatal(err)
	}
}
