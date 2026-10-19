package app

import (
	"bomish/internal/domain"
	"context"
	"testing"
)

type chartResponse struct {
	Days     []string         `json:"days"`
	Points   []map[string]any `json:"points"`
	Totals   []map[string]any `json:"totals"`
	Packages []map[string]any `json:"packages"`
}

func TestDailyChartsAndManualAvailability(t *testing.T) {
	a := setupCommerce(t)
	ctx := context.Background()
	owner := couponOwner(t, a)
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, e := a.Pool.Exec(ctx, sql, args...); e != nil {
			t.Fatal(e)
		}
	}
	exec(`INSERT INTO users(id,phone) VALUES('chart-customer','09129998888')`)
	exec(`INSERT INTO orders(id,user_id,idempotency_key,status,address,subtotal_rials,shipping_rials,total_rials,reservation_expires_at,paid_at,discount_rials) VALUES('chart-order','chart-customer','chart-test','paid','{"recipient":"مشتری نمودار"}',400000,10000,370000,now(),'2026-09-21T21:00:00Z',40000)`)
	exec(`INSERT INTO order_items(order_id,product_id,name,grams,price_rials,total_rials,package_id,package_label,quantity) VALUES('chart-order','turmeric','زردچوبه',200,100000,200000,'small','۲۰۰ گرم',2),('chart-order','cinnamon','دارچین',500,200000,200000,'large','۵۰۰ گرم',1)`)
	exec(`INSERT INTO analytics_events(kind,product_id,session_hash,created_at) VALUES('click','turmeric','chart-session','2026-09-21T21:01:00Z'),('click','cinnamon','chart-session','2026-09-22T08:00:00Z')`)
	query := "&from=2026-09-21&to=2026-09-27"
	for _, section := range []string{"overview", "products", "packages", "categories", "customers", "searches", "prices"} {
		var data chartResponse
		owner.ok(t, "GET", "/omnisire/analytics/charts?section="+section+query, nil, &data)
		if len(data.Days) != 7 || data.Days[0] != "2026-09-21" {
			t.Fatalf("calendar days: %+v", data.Days)
		}
		if section == "overview" {
			var revenue float64
			for _, r := range data.Points {
				revenue += r["revenue"].(float64)
				if r["revenue"].(float64) > 0 && r["day"] != "2026-09-22" {
					t.Fatal("not grouped by Tehran day", r)
				}
			}
			if revenue != 360000 {
				t.Fatal("revenue must exclude shipping and coupon", revenue)
			}
		}
	}
	var compared chartResponse
	owner.ok(t, "GET", "/omnisire/analytics/charts?section=products"+query+"&ids=turmeric,cinnamon", nil, &compared)
	var qty, clicks, revenue float64
	for _, r := range compared.Points {
		if r["id"] != "turmeric" && r["id"] != "cinnamon" {
			t.Fatal("selection ignored")
		}
		qty += r["quantity"].(float64)
		clicks += r["clicks"].(float64)
		revenue += r["revenue"].(float64)
	}
	if qty != 3 || clicks != 2 || revenue != 360000 || len(compared.Packages) < 2 {
		t.Fatalf("wrong product chart %+v", compared)
	}
	owner.ok(t, "GET", "/omnisire/analytics/charts?section=products"+query+"&ids=mint", nil, &compared)
	if len(compared.Points) != 1 || compared.Points[0]["quantity"].(float64) != 0 {
		t.Fatal("zero-sale product should be comparable", compared)
	}
	exec(`INSERT INTO price_history(product_id,package_id,package_label,new_rials,new_discount,old_rials,old_discount,created_at) VALUES('turmeric','history','بسته',100000,0,90000,0,'2026-09-20'),('turmeric','history','بسته',200000,10,100000,0,'2026-09-23')`)
	owner.ok(t, "GET", "/omnisire/analytics/charts?section=prices"+query+"&ids=turmeric", nil, &compared)
	found := false
	for _, r := range compared.Points {
		if r["id"] == "turmeric:history" && r["day"] == "2026-09-24" {
			found = true
			if r["price"].(float64) != 180000 {
				t.Fatal("effective price carry-forward", r)
			}
		}
	}
	if !found {
		t.Fatal("price series missing")
	}
	if code, _ := owner.call("GET", "/omnisire/analytics/charts?section=products&from=2026-09-29&to=2026-09-20", nil); code != 400 {
		t.Fatal("inverted dates accepted")
	}
	if code, _ := owner.call("GET", "/omnisire/analytics/charts?section=products&from=invalid", nil); code != 400 {
		t.Fatal("invalid dates accepted")
	}
	guest := newClient(t, a.Handler())
	if code, _ := guest.call("GET", "/omnisire/analytics/charts", nil); code != 403 {
		t.Fatal("private charts exposed")
	}
	editor, _ := testStaff(t, a, "editor", nil)
	editor.ok(t, "POST", "/staff/products/turmeric/availability", map[string]bool{"outOfStock": true}, nil)
	var product domain.Product
	guest.ok(t, "GET", "/products/turmeric", nil, &product)
	if !product.OutOfStock {
		t.Fatal("manual unavailability lost")
	}
	if code, _ := guest.call("PUT", "/cart/items/turmeric", map[string]any{"packageId": "test500", "quantity": 1}); code != 409 {
		t.Fatal("unavailable product purchasable", code)
	}
	guest.login(t, "09127776666")
	editor.ok(t, "POST", "/staff/products/turmeric/availability", map[string]bool{"outOfStock": false}, nil)
	guest.ok(t, "PUT", "/cart/items/turmeric", map[string]any{"packageId": "test500", "quantity": 1}, nil)
	editor.ok(t, "POST", "/staff/products/turmeric/availability", map[string]bool{"outOfStock": true}, nil)
	if code, _ := guest.call("POST", "/checkout/quote", commerceQuote("")); code != 422 {
		t.Fatal("stale cart accepted", code)
	}
	if code, _ := editor.call("POST", "/staff/products/missing/availability", map[string]bool{}); code != 404 {
		t.Fatal("missing product accepted")
	}
}

func TestAnalyticsBoundedRankingAndSearch(t *testing.T) {
	a := setup(t)
	owner := couponOwner(t, a)
	ctx := context.Background()
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := a.Pool.Exec(ctx, sql, args...); err != nil {
			t.Fatal(err)
		}
	}
	// More entities than any page or chart: all must contribute to the denominator.
	exec(`INSERT INTO products(id,slug,name,category_id) SELECT 'scale-'||n,'scale-'||n,'محصول '||n,(SELECT id FROM categories LIMIT 1) FROM generate_series(1,2000) n`)
	exec(`INSERT INTO analytics_events(kind,product_id,session_hash,created_at) SELECT 'click','scale-'||n,'scale','2026-09-22'::timestamptz FROM generate_series(1,2000) n`)
	var ranked struct {
		chartResponse
		Summary map[string]float64 `json:"summary"`
	}
	path := "/omnisire/analytics/charts?section=products&from=2026-09-21&to=2026-09-27&metric=clicks"
	owner.ok(t, "GET", path, nil, &ranked)
	if len(ranked.Totals) != 8 || len(ranked.Points) > 35 || ranked.Summary["clicks"] != 2000 || ranked.Summary["entityCount"] < 2000 {
		t.Fatalf("unbounded or truncated summary: totals=%d points=%d summary=%+v", len(ranked.Totals), len(ranked.Points), ranked.Summary)
	}
	owner.ok(t, "GET", path+"&id=scale-2000", nil, &ranked)
	if len(ranked.Points) == 0 || ranked.Points[0]["id"] != "scale-2000" || ranked.Summary["clicks"] != 2000 {
		t.Fatal("selection changed scope", ranked)
	}
	exec(`INSERT INTO analytics_events(kind,query,session_hash,created_at) VALUES('search','چای, سبز','term','2026-09-22'),('search','چای, سبز','term2','2026-09-22'),('search','ادویه','term3','2026-09-22')`)
	owner.ok(t, "GET", "/omnisire/analytics/charts?section=searches&from=2026-09-21&to=2026-09-27&id=%DA%86%D8%A7%DB%8C%2C%20%D8%B3%D8%A8%D8%B2", nil, &ranked)
	if len(ranked.Points) != 1 || ranked.Points[0]["orders"].(float64) != 2 || ranked.Totals[0]["name"] != "چای, سبز" {
		t.Fatal("comma term or search ranking", ranked)
	}
	var report struct {
		Total int              `json:"total"`
		Items []map[string]any `json:"items"`
	}
	owner.ok(t, "GET", "/omnisire/analytics?section=products&q=quantity", nil, &report)
	if report.Total != 0 {
		t.Fatal("search matched a JSON field instead of a label")
	}
	owner.ok(t, "GET", "/omnisire/analytics?section=products&q=%DB%B2%DB%B0%DB%B0%DB%B0", nil, &report)
	if report.Total != 1 {
		t.Fatal("Persian digits not normalized", report)
	}
	owner.ok(t, "GET", "/omnisire/analytics?section=products&q=%25", nil, &report)
	if report.Total != 0 {
		t.Fatal("wildcard search wasn't escaped")
	}
	for _, url := range []string{"/omnisire/analytics?from=invalid", "/omnisire/analytics?from=2020-01-01&to=2026-01-01", "/omnisire/analytics/charts?section=products&metric=unknown"} {
		if code, _ := owner.call("GET", url, nil); code != 400 {
			t.Fatal("invalid input accepted", url, code)
		}
	}
	// Match storefront ceiling-to-1000-toman behavior and retain unknown history.
	exec(`INSERT INTO price_history(product_id,package_id,package_label,new_rials,new_discount,created_at) VALUES('turmeric','rounding','بسته تست',105000,10,'2026-09-23')`)
	owner.ok(t, "GET", "/omnisire/analytics/charts?section=prices&from=2026-09-21&to=2026-09-24&id=turmeric:rounding", nil, &ranked)
	if len(ranked.Points) != 4 || ranked.Points[0]["price"] != nil || ranked.Points[3]["price"].(float64) != 100000 {
		t.Fatal("price rounding or unknown history", ranked.Points)
	}
}
