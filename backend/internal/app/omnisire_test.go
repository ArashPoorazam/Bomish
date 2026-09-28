package app

import (
	"archive/zip"
	"bomish/internal/domain"
	"bytes"
	"context"
	"encoding/xml"
	"fmt"
	"io"
	"os"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestCommissionRounding(t *testing.T) {
	for _, v := range []struct{ net, want int64 }{{0, 0}, {1, 10000}, {100000, 10000}, {1000000, 70000}, {1000010, 80000}, {2490000, 180000}, {100000000000, 7000000000}} {
		if got := commission(v.net); got != v.want {
			t.Fatalf("net=%d got=%d want=%d", v.net, got, v.want)
		}
	}
}
func testStaff(t *testing.T, a *App, role string, restricted []string) (*client, string) {
	t.Helper()
	id := token()
	if restricted == nil {
		restricted = []string{}
	}
	_, e := a.Pool.Exec(context.Background(), `INSERT INTO staff(id,username,password_hash,totp_secret,role,full_name,phone,bank_card,restrictions) VALUES($1,$1,'test','test',$2,'آزمایش','09123456789','5022291002696175',$3)`, id, role, restricted)
	if e != nil {
		t.Fatal(e)
	}
	c := newClient(t, a.Handler())
	_, e = a.Pool.Exec(context.Background(), "UPDATE sessions SET staff_id=$1 WHERE token_hash=$2", id, hash(c.cookies[0].Value))
	if e != nil {
		t.Fatal(e)
	}
	return c, id
}
func TestOmnisirePermissionsAndProfiles(t *testing.T) {
	a := setup(t)
	owner := couponOwner(t, a)
	paths := map[string]string{"products": "/staff/products", "articles": "/staff/articles", "pricing": "/staff/discount-codes", "orders": "/staff/orders", "shipping": "/staff/shipping", "sales": "/staff/sales", "omnisire": "/omnisire/members"}
	for _, role := range []string{"manager", "editor", "operator", "salesperson"} {
		c, id := testStaff(t, a, role, nil)
		for permission, path := range paths {
			want := 403
			for _, p := range effectivePermissions(role, nil) {
				if p == permission {
					want = 200
				}
			}
			if code, body := c.call("GET", path, nil); code != want {
				t.Fatalf("%s %s got %d want %d: %s", role, path, code, want, body)
			}
		}
		for permission, path := range paths {
			if permission == "omnisire" {
				continue
			}
			_, e := a.Pool.Exec(context.Background(), "UPDATE staff SET restrictions=ARRAY[$2]::text[] WHERE id=$1", id, permission)
			if e != nil {
				t.Fatal(e)
			}
			if code, _ := c.call("GET", path, nil); code != 403 {
				t.Fatalf("restriction bypass %s %s", role, permission)
			}
		}
	}
	var created map[string]string
	body := map[string]any{"fullName": "آزمایش فروشنده", "username": "new-sales", "phone": "۰۹۱۲۳۴۵۶۷۸۹", "bankCard": "۵۰۲۲ - ۲۹۱۰ - ۰۲۶۹ - ۶۱۷۵", "role": "salesperson", "active": true, "password": "test-password-123", "restrictions": []string{}}
	owner.ok(t, "POST", "/omnisire/members", body, &created)
	if created["totpSecret"] == "" {
		t.Fatal("missing TOTP")
	}
	var member map[string]any
	owner.ok(t, "GET", "/omnisire/members/"+created["id"], nil, &member)
	if member["bankCard"] != "5022291002696175" {
		t.Fatal(member)
	}
	_, raw := owner.call("GET", "/omnisire/members", nil)
	if bytes.Contains(raw, []byte("5022291002696175")) {
		t.Fatal("card leaked into list")
	}
	for _, method := range []string{"PATCH", "DELETE"} {
		path := "/omnisire/members/owner"
		var ownerID string
		a.Pool.QueryRow(context.Background(), "SELECT id FROM staff WHERE role='owner'").Scan(&ownerID)
		path = "/omnisire/members/" + ownerID
		if code, _ := owner.call(method, path, body); code != 403 {
			t.Fatalf("owner protection %s %d", method, code)
		}
	}
	// Direct product writes and publication cannot bypass a pricing restriction.
	editor, _ := testStaff(t, a, "editor", []string{"pricing"})
	var product domain.Product
	editor.ok(t, "GET", "/products/turmeric", nil, &product)
	product.Packages[0].PriceRials += 10000
	if code, _ := editor.call("PUT", "/staff/products/turmeric", product); code != 403 {
		t.Fatal("price bypass", code)
	}
	owner.ok(t, "PUT", "/staff/products/turmeric", product, nil)
	if code, _ := editor.call("POST", "/staff/products/turmeric/publish", nil); code != 403 {
		t.Fatal("publish price bypass", code)
	}
	owner.ok(t, "DELETE", "/omnisire/members/"+created["id"], nil, nil)
	if code, _ := owner.call("GET", "/staff/members", nil); code != 404 {
		t.Fatal("legacy endpoint survives")
	}
}
func TestReferralSettlementLedgerAndExport(t *testing.T) {
	a := setup(t)
	ctx := context.Background()
	owner := couponOwner(t, a)
	sales, id := testStaff(t, a, "salesperson", nil)
	_, other := testStaff(t, a, "salesperson", nil)
	var code, otherCode string
	a.Pool.QueryRow(ctx, "SELECT referral_code FROM staff WHERE id=$1", id).Scan(&code)
	a.Pool.QueryRow(ctx, "SELECT referral_code FROM staff WHERE id=$1", other).Scan(&otherCode)
	c := newClient(t, a.Handler())
	c.ok(t, "POST", "/referral", map[string]string{"code": otherCode}, nil)
	c.ok(t, "POST", "/referral", map[string]string{"code": code}, nil)
	c.login(t, "09121112222")
	var uid, ref string
	a.Pool.QueryRow(ctx, "SELECT u.id,r.staff_id FROM users u JOIN customer_referrals r ON r.user_id=u.id WHERE u.phone='09121112222'").Scan(&uid, &ref)
	if ref != id {
		t.Fatal("last referral not bound", ref, id)
	}
	c.ok(t, "POST", "/referral", map[string]string{"code": otherCode}, nil)
	var p domain.Product
	c.ok(t, "GET", "/products/turmeric", nil, &p)
	c.ok(t, "PUT", "/cart/items/turmeric", map[string]any{"packageId": p.Packages[0].ID, "quantity": 1}, nil)
	createCode(t, owner, "REF10", "percent", 10, 0)
	quote := couponQuote(t, c, "REF10")
	var order map[string]string
	c.ok(t, "POST", "/checkout", couponOrderBody("REF10", "referral-checkout-01", quote), &order)
	if status, e := a.settle(ctx, order["orderId"], uid, true); e != nil || status != "paid" {
		t.Fatal(status, e)
	}
	a.settle(ctx, order["orderId"], uid, true)
	var balance int64
	var count int
	a.Pool.QueryRow(ctx, "SELECT sum(amount_rials),count(*) FROM member_ledger WHERE staff_id=$1", id).Scan(&balance, &count)
	want := commission(quote.SubtotalRials - quote.DiscountRials)
	if balance != want || count != 1 {
		t.Fatalf("commission %d/%d want %d", balance, count, want)
	}
	var summary map[string]any
	sales.ok(t, "GET", "/staff/sales?staffId="+other, nil, &summary)
	if summary["referralCode"] != code {
		t.Fatal("personal identity override")
	}
	_, raw := sales.call("GET", "/staff/sales?part=customers", nil)
	if bytes.Contains(raw, []byte("09121112222")) {
		t.Fatal("customer phone leaked")
	}
	pay := map[string]any{"amountRials": want, "transactionNumber": "txn-001", "occurredAt": time.Now().Format(time.RFC3339), "note": "تسویه", "idempotencyKey": "payment-1"}
	var paid map[string]string
	owner.ok(t, "POST", "/omnisire/members/"+id+"/payments", pay, &paid)
	owner.ok(t, "POST", "/omnisire/members/"+id+"/payments", pay, nil)
	pay["idempotencyKey"] = "payment-2"
	pay["transactionNumber"] = "txn-002"
	if status, _ := owner.call("POST", "/omnisire/members/"+id+"/payments", pay); status != 409 {
		t.Fatal("overpayment", status)
	}
	refund := map[string]any{"orderId": order["orderId"], "amountRials": quote.SubtotalRials - quote.DiscountRials, "reason": "استرداد کامل خارج از سایت", "idempotencyKey": "refund-1"}
	owner.ok(t, "POST", "/omnisire/members/"+id+"/refunds", refund, nil)
	owner.ok(t, "POST", "/omnisire/members/"+id+"/refunds", refund, nil)
	a.Pool.QueryRow(ctx, "SELECT sum(amount_rials) FROM member_ledger WHERE staff_id=$1", id).Scan(&balance)
	if balance != -want {
		t.Fatal("negative balance not retained", balance)
	}
	owner.ok(t, "POST", "/omnisire/members/"+id+"/payments/"+paid["id"]+"/reverse", map[string]string{"reason": "اشتباه در ثبت", "idempotencyKey": "reverse-1"}, nil)
	a.Pool.QueryRow(ctx, "SELECT sum(amount_rials) FROM member_ledger WHERE staff_id=$1", id).Scan(&balance)
	if balance != 0 {
		t.Fatal("reversal balance", balance)
	}
	for section := range reportSpecs {
		owner.ok(t, "GET", "/omnisire/analytics?section="+section, nil, nil)
	}
	owner.ok(t, "GET", "/omnisire/analytics/series?section=products&metric=revenue&ids=turmeric", nil, nil)
	owner.ok(t, "GET", "/omnisire/events?actor="+id, nil, nil)
	owner.ok(t, "GET", "/omnisire/summary", nil, nil)
	var job map[string]string
	owner.ok(t, "POST", "/omnisire/exports", map[string]string{"section": "products"}, &job)
	if e := a.ProcessExports(ctx); e != nil {
		t.Fatal(e)
	}
	status, data := owner.call("GET", "/omnisire/exports/"+job["id"]+"/download", nil)
	if status != 200 {
		t.Fatalf("export %d %s", status, data)
	}
	z, e := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if e != nil {
		t.Fatal(e)
	}
	for _, f := range z.File {
		r, e := f.Open()
		if e != nil {
			t.Fatal(e)
		}
		dec := xml.NewDecoder(r)
		for {
			_, e = dec.Token()
			if e == io.EOF {
				break
			}
			if e != nil {
				t.Fatalf("invalid xlsx %s %v", f.Name, e)
			}
		}
		r.Close()
	}
	if code, _ := sales.call("GET", "/omnisire/exports/"+job["id"]+"/download", nil); code != 403 {
		t.Fatal("export leaked")
	}
}
func fixtureCommission(t *testing.T, a *App, staff, user string, at time.Time) (string, error) {
	t.Helper()
	id := token()
	tx, e := a.Pool.Begin(context.Background())
	if e != nil {
		return "", e
	}
	defer tx.Rollback(context.Background())
	_, e = tx.Exec(context.Background(), `INSERT INTO orders(id,user_id,idempotency_key,status,address,subtotal_rials,shipping_rials,total_rials,reservation_expires_at,paid_at) VALUES($1,$2,$1,'paid','{}',1000000,0,1000000,now(),$3)`, id, user, at)
	if e == nil {
		e = creditCommission(context.Background(), tx, id, user, at)
	}
	if e == nil {
		e = tx.Commit(context.Background())
	}
	return id, e
}
func TestReferralWindowSuspensionAndConcurrentPayments(t *testing.T) {
	a := setup(t)
	ctx := context.Background()
	owner := couponOwner(t, a)
	sales, id := testStaff(t, a, "salesperson", nil)
	user := token()
	start := time.Now().Add(-time.Hour)
	end := start.Add(30 * 24 * time.Hour)
	_, e := a.Pool.Exec(ctx, "INSERT INTO users(id,phone) VALUES($1,'09121113333')", user)
	if e != nil {
		t.Fatal(e)
	}
	_, e = a.Pool.Exec(ctx, "INSERT INTO customer_referrals(user_id,staff_id,created_at,expires_at) VALUES($1,$2,$3,$4)", user, id, start, end)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = fixtureCommission(t, a, id, user, start); e != nil {
		t.Fatal(e)
	}
	if _, e = fixtureCommission(t, a, id, user, end); e != nil {
		t.Fatal(e)
	}
	a.Pool.Exec(ctx, "UPDATE staff SET active=false WHERE id=$1", id)
	fixtureCommission(t, a, id, user, start.Add(time.Hour))
	a.Pool.Exec(ctx, "UPDATE staff SET active=true WHERE id=$1", id)
	fixtureCommission(t, a, id, user, start.Add(2*time.Hour))
	var count int
	a.Pool.QueryRow(ctx, "SELECT count(*) FROM commission_sales WHERE staff_id=$1", id).Scan(&count)
	if count != 2 {
		t.Fatal("window/suspension", count)
	}
	// Purchases outside eligibility and during suspension remain visible, with no commission.
	var purchases struct {
		Items []struct {
			Eligible   bool  `json:"eligible"`
			Commission int64 `json:"commissionRials"`
		} `json:"items"`
		Total int `json:"total"`
	}
	sales.ok(t, "GET", "/staff/sales?part=orders&customer="+user, nil, &purchases)
	eligible := 0
	for _, item := range purchases.Items {
		if item.Eligible {
			eligible++
		} else if item.Commission != 0 {
			t.Fatal("ineligible purchase earned commission")
		}
	}
	if purchases.Total != 4 || eligible != 2 {
		t.Fatalf("attributed purchases %+v", purchases)
	}
	var wg sync.WaitGroup
	codes := make(chan int, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			status, _ := owner.call("POST", "/omnisire/members/"+id+"/payments", map[string]any{"amountRials": 140000, "transactionNumber": fmt.Sprint("race-", i), "occurredAt": time.Now().Format(time.RFC3339), "idempotencyKey": fmt.Sprint("race-", i)})
			codes <- status
		}(i)
	}
	wg.Wait()
	close(codes)
	success := 0
	for status := range codes {
		if status == 201 {
			success++
		} else if status != 409 {
			t.Fatal(status)
		}
	}
	if success != 1 {
		t.Fatal("concurrent overpayment", success)
	}
}
func TestReportPaginationAndPriceCapture(t *testing.T) {
	a := setup(t)
	ctx := context.Background()
	owner := couponOwner(t, a)
	for i := 0; i < 36; i++ {
		testStaff(t, a, "salesperson", nil)
	}
	var page pageResult
	owner.ok(t, "GET", "/omnisire/members?page=2", nil, &page)
	if len(page.Items) != 14 || page.Total != 39 {
		t.Fatalf("pagination %+v", page)
	}
	owner.ok(t, "POST", "/staff/pricing", map[string]any{"productIds": []string{"turmeric"}, "amount": 10000}, nil)
	var actor string
	var old, new int64
	e := a.Pool.QueryRow(ctx, "SELECT old_rials,new_rials,actor_id FROM price_history WHERE product_id='turmeric' ORDER BY id DESC LIMIT 1").Scan(&old, &new, &actor)
	if e != nil || new-old != 10000 || actor == "" {
		t.Fatal("price capture", e, old, new, actor)
	}
	owner.ok(t, "GET", "/omnisire/analytics?section=prices", nil, nil)
	// Invalid sort names are never interpolated into SQL.
	owner.ok(t, "GET", "/omnisire/analytics?section=products&sort=drop%20table%20staff", nil, nil)
	for _, path := range []string{"/products?page=1", "/staff/products?page=1", "/staff/product-options?page=1", "/staff/orders?page=1"} {
		owner.ok(t, "GET", path, nil, nil)
	}
}

// This opt-in test exercises the agreed launch-size workload in its own disposable schema.
func TestOmnisireScale(t *testing.T) {
	if os.Getenv("OMNISIRE_SCALE_TEST") != "1" {
		t.Skip("set OMNISIRE_SCALE_TEST=1 for the large-data acceptance fixture")
	}
	a := setup(t)
	ctx := context.Background()
	owner := couponOwner(t, a)
	statements := []string{
		`INSERT INTO products(id,slug,name,category_id,status,content) SELECT 'scale-product-'||g,'scale-product-'||g,'محصول مقیاس '||g,'spices','published',jsonb_build_object('packages',jsonb_build_array(jsonb_build_object('id','small','amount',100,'unit','g','priceRials',100000,'maxQuantity',5))) FROM generate_series(1,1000) g`,
		`INSERT INTO inventory(product_id,stock_grams) SELECT 'scale-product-'||g,100000 FROM generate_series(1,1000) g`,
		`INSERT INTO staff(id,username,password_hash,totp_secret,role,full_name) SELECT 'scale-staff-'||g,'scale-staff-'||g,'test','test','salesperson','همکار مقیاس '||g FROM generate_series(1,1000) g`,
		`INSERT INTO users(id,phone) VALUES('scale-customer','09120009999')`,
		`INSERT INTO orders(id,user_id,idempotency_key,status,address,subtotal_rials,discount_rials,shipping_rials,total_rials,reservation_expires_at,paid_at,created_at) SELECT 'scale-order-'||g,'scale-customer','scale-order-'||g,'paid','{}',100000,10000,0,90000,now(),now()-(g%30)*interval '1 day',now()-(g%30)*interval '1 day' FROM generate_series(1,100000) g`,
		`INSERT INTO order_items(order_id,product_id,name,grams,price_rials,total_rials,package_id,quantity) SELECT 'scale-order-'||g,'scale-product-'||(g%1000+1),'محصول مقیاس',100,100000,100000,'small',1 FROM generate_series(1,100000) g`,
		`INSERT INTO analytics_events(kind,product_id,session_hash,created_at) SELECT CASE WHEN g%2=0 THEN 'view' ELSE 'click' END,'scale-product-'||(g%1000+1),md5(g::text),now()-(g%30)*interval '1 day' FROM generate_series(1,1000000) g`,
		`ANALYZE`,
	}
	for _, sql := range statements {
		if _, e := a.Pool.Exec(ctx, sql); e != nil {
			t.Fatal(e)
		}
	}
	for _, path := range []string{"/omnisire/members?page=30", "/omnisire/analytics?section=products&page=30", "/omnisire/analytics?section=customers", "/staff/products?page=30", "/staff/orders?page=3000", "/products?page=30"} {
		start := time.Now()
		var result pageResult
		owner.ok(t, "GET", path, nil, &result)
		if len(result.Items) > 25 {
			t.Fatal("unbounded response", path)
		}
		t.Logf("%s: %d rows / %d total in %s", path, len(result.Items), result.Total, time.Since(start))
	}
	var series struct {
		Combined bool             `json:"combined"`
		Count    int              `json:"count"`
		Items    []map[string]any `json:"items"`
	}
	owner.ok(t, "GET", "/omnisire/analytics/series?section=products&metric=revenue&ids=scale-product-1,scale-product-2,scale-product-3,scale-product-4,scale-product-5,scale-product-6,scale-product-7,scale-product-8,scale-product-9", nil, &series)
	if !series.Combined || series.Count != 9 || len(series.Items) != 1 {
		t.Fatal("large comparison aggregation", series)
	}
	var orderNet, lineNet int64
	if e := a.Pool.QueryRow(ctx, "SELECT (SELECT sum(subtotal_rials-discount_rials) FROM orders WHERE paid_at IS NOT NULL),(SELECT sum(net_rials) FROM analytics_order_lines)").Scan(&orderNet, &lineNet); e != nil || orderNet != lineNet {
		t.Fatal("analytics reconciliation", orderNet, lineNet, e)
	}
	var plan string
	if e := a.Pool.QueryRow(ctx, `EXPLAIN (FORMAT JSON) SELECT * FROM analytics_events WHERE kind='view' AND product_id='scale-product-1' AND created_at>now()-interval '1 hour'`).Scan(&plan); e != nil {
		t.Fatal(e)
	}
	if !strings.Contains(plan, "Index") {
		t.Fatalf("missing event index: %s", plan)
	}
	var job map[string]string
	owner.ok(t, "POST", "/omnisire/exports", map[string]string{"section": "products"}, &job)
	if e := a.ProcessExports(ctx); e != nil {
		t.Fatal(e)
	}
	status, raw := owner.call("GET", "/omnisire/exports/"+job["id"]+"/download", nil)
	if status != 200 {
		t.Fatalf("large export %d %s", status, raw)
	}
	z, e := zip.NewReader(bytes.NewReader(raw), int64(len(raw)))
	if e != nil {
		t.Fatal(e)
	}
	for _, f := range z.File {
		if f.Name == "xl/worksheets/sheet1.xml" {
			r, _ := f.Open()
			content, _ := io.ReadAll(r)
			r.Close()
			if bytes.Count(content, []byte("<row ")) < 1003 {
				t.Fatal("export only contained visible page")
			}
		}
	}
}

func TestExistingCustomerCannotAcquireReferral(t *testing.T) {
	a := setup(t)
	_, member := testStaff(t, a, "salesperson", nil)
	var code string
	if e := a.Pool.QueryRow(context.Background(), "SELECT referral_code FROM staff WHERE id=$1", member).Scan(&code); e != nil {
		t.Fatal(e)
	}
	first := newClient(t, a.Handler())
	first.login(t, "09127778888")
	returning := newClient(t, a.Handler())
	returning.ok(t, "POST", "/referral", map[string]string{"code": code}, nil)
	returning.login(t, "09127778888")
	var count int
	if e := a.Pool.QueryRow(context.Background(), "SELECT count(*) FROM customer_referrals r JOIN users u ON u.id=r.user_id WHERE u.phone='09127778888'").Scan(&count); e != nil {
		t.Fatal(e)
	}
	if count != 0 {
		t.Fatal("existing account acquired referral")
	}
}

func TestPartialPaymentsRefundsAndSessionRevocation(t *testing.T) {
	a := setup(t)
	ctx := context.Background()
	owner := couponOwner(t, a)
	sales, id := testStaff(t, a, "salesperson", nil)
	user := token()
	if _, e := a.Pool.Exec(ctx, "INSERT INTO users(id,phone) VALUES($1,'09123334444')", user); e != nil {
		t.Fatal(e)
	}
	if _, e := a.Pool.Exec(ctx, "INSERT INTO customer_referrals(user_id,staff_id,expires_at) VALUES($1,$2,now()+interval '30 days')", user, id); e != nil {
		t.Fatal(e)
	}
	order, e := fixtureCommission(t, a, id, user, time.Now())
	if e != nil {
		t.Fatal(e)
	}
	owner.ok(t, "POST", "/omnisire/members/"+id+"/payments", map[string]any{"amountRials": 20000, "transactionNumber": "partial-bank-reference", "occurredAt": time.Now().Format(time.RFC3339), "idempotencyKey": "partial-payout"}, nil)
	for i, amount := range []int64{100000, 400000} {
		owner.ok(t, "POST", "/omnisire/members/"+id+"/refunds", map[string]any{"orderId": order, "amountRials": amount, "reason": "استرداد جزئی", "idempotencyKey": fmt.Sprint("partial-refund-", i)}, nil)
	}
	var balance int64
	if e := a.Pool.QueryRow(ctx, "SELECT sum(amount_rials) FROM member_ledger WHERE staff_id=$1", id).Scan(&balance); e != nil {
		t.Fatal(e)
	}
	if balance != 20000 {
		t.Fatal("partial refund rounding/payout balance", balance)
	}
	if code, _ := owner.call("POST", "/omnisire/members/"+id+"/refunds", map[string]any{"orderId": order, "amountRials": 500010, "reason": "بیشتر از مانده", "idempotencyKey": "excess-refund"}); code != 409 {
		t.Fatal("excess cumulative refund", code)
	}
	owner.ok(t, "POST", "/omnisire/members/"+id+"/credentials", map[string]any{"password": "a-new-safe-password-123", "resetTotp": true}, nil)
	if code, _ := sales.call("GET", "/staff/sales", nil); code != 403 {
		t.Fatal("credential reset retained session", code)
	}
	var sessionCount int
	if e := a.Pool.QueryRow(ctx, "SELECT count(*) FROM sessions WHERE staff_id=$1", id).Scan(&sessionCount); e != nil || sessionCount != 0 {
		t.Fatal("session revocation", sessionCount, e)
	}
	var filtered struct {
		Items []domain.Product `json:"items"`
		Total int              `json:"total"`
	}
	owner.ok(t, "GET", "/products?page=1&ids=turmeric,does-not-exist", nil, &filtered)
	if filtered.Total != 1 || len(filtered.Items) != 1 || filtered.Items[0].ID != "turmeric" {
		t.Fatal("product selection pagination", filtered)
	}
}

func TestEditorCanArchiveAndRepublishArticle(t *testing.T) {
	a := setup(t)
	editor, _ := testStaff(t, a, "editor", nil)
	var article domain.Article
	editor.ok(t, "GET", "/articles/spice-guide", nil, &article)
	article.Status = "archived"
	editor.ok(t, "PUT", "/staff/articles/"+article.ID, article, nil)
	if code, _ := editor.call("GET", "/articles/spice-guide", nil); code != 404 {
		t.Fatal("archived article remains public", code)
	}
	article.Status = "published"
	editor.ok(t, "PUT", "/staff/articles/"+article.ID, article, nil)
	editor.ok(t, "GET", "/articles/spice-guide", nil, nil)
}
