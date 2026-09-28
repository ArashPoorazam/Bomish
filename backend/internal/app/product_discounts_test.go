package app

import (
	"context"
	"testing"
)

func TestManagedDiscountLifecycle(t *testing.T) {
	a := setup(t)
	owner := couponOwner(t, a)
	ctx := context.Background()
	var other string
	if e := a.Pool.QueryRow(ctx, "SELECT id FROM products WHERE id<>'turmeric' ORDER BY id LIMIT 1").Scan(&other); e != nil {
		t.Fatal(e)
	}
	if _, e := a.Pool.Exec(ctx, "INSERT INTO product_drafts(product_id,content) SELECT id,content FROM products WHERE id='turmeric'"); e != nil {
		t.Fatal(e)
	}
	check := func(want int64) {
		t.Helper()
		var live, draft int64
		if e := a.Pool.QueryRow(ctx, "SELECT (p.content->>'discountPercent')::bigint,(d.content->>'discountPercent')::bigint FROM products p JOIN product_drafts d ON d.product_id=p.id WHERE p.id='turmeric'").Scan(&live, &draft); e != nil {
			t.Fatal(e)
		}
		if live != want || draft != want {
			t.Fatalf("live=%d draft=%d want=%d", live, draft, want)
		}
	}
	owner.ok(t, "POST", "/staff/product-discounts", map[string]any{"id": "group", "name": "Group sale", "percent": 10, "productIds": []string{"turmeric", other}}, nil)
	owner.ok(t, "POST", "/staff/product-discounts", map[string]any{"id": "single", "name": "Single sale", "percent": 25, "productIds": []string{"turmeric"}}, nil)
	check(25)
	owner.ok(t, "PATCH", "/staff/product-discounts/single", map[string]bool{"active": false}, nil)
	check(10)
	owner.ok(t, "PATCH", "/staff/product-discounts/single", map[string]bool{"active": true}, nil)
	check(25)
	owner.ok(t, "DELETE", "/staff/product-discounts/single", nil, nil)
	check(10)
	// A stale editor save cannot restore the removed percentage.
	if _, e := a.Pool.Exec(ctx, "UPDATE products SET content=jsonb_set(content,'{discountPercent}','25') WHERE id='turmeric'"); e != nil {
		t.Fatal(e)
	}
	check(10)
	owner.ok(t, "DELETE", "/staff/product-discounts/group", nil, nil)
	check(0)
	owner.ok(t, "POST", "/staff/product-discounts", map[string]any{"id": "all", "name": "Store sale", "percent": 5, "all": true}, nil)
	check(5)
	owner.ok(t, "DELETE", "/staff/product-discounts/all", nil, nil)
	check(0)
	// Base-price batch changes validate every target before committing.
	var before, after string
	if e := a.Pool.QueryRow(ctx, "SELECT content::text FROM products WHERE id='turmeric'").Scan(&before); e != nil {
		t.Fatal(e)
	}
	if code, _ := owner.call("POST", "/staff/pricing", map[string]any{"all": true, "amount": -100000000000, "productIds": []string{"turmeric", other}}); code != 400 {
		t.Fatalf("invalid price status=%d", code)
	}
	if e := a.Pool.QueryRow(ctx, "SELECT content::text FROM products WHERE id='turmeric'").Scan(&after); e != nil {
		t.Fatal(e)
	}
	if before != after {
		t.Fatal("invalid batch changed a product")
	}
	owner.ok(t, "POST", "/staff/pricing", map[string]any{"amount": 100, "productIds": []string{"turmeric", other}}, nil)
	createCode(t, owner, "REMOVE10", "percent", 10, 0)
	owner.ok(t, "DELETE", "/staff/discount-codes/REMOVE10", nil, nil)
	var codes []discountCode
	owner.ok(t, "GET", "/staff/discount-codes", nil, &codes)
	for _, v := range codes {
		if v.Code == "REMOVE10" {
			t.Fatal("deleted code still listed")
		}
	}
	var active, deleted bool
	if e := a.Pool.QueryRow(ctx, "SELECT active,deleted_at IS NOT NULL FROM discount_codes WHERE code='REMOVE10'").Scan(&active, &deleted); e != nil {
		t.Fatal(e)
	}
	if active || !deleted {
		t.Fatal("code not retained as deleted and inactive")
	}
	if code, _ := owner.call("PATCH", "/staff/discount-codes/REMOVE10", map[string]bool{"active": true}); code != 404 {
		t.Fatalf("deleted code reactivation status=%d", code)
	}
}
