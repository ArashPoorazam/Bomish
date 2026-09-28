package app

import (
	"bomish/internal/db"
	"bomish/internal/domain"
	"bomish/internal/storage"
	"bomish/migrations"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"github.com/jackc/pgx/v5/pgxpool"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"
)

type client struct {
	h       http.Handler
	cookies []*http.Cookie
	csrf    string
}

func (c *client) call(method, path string, body any) (int, []byte) {
	var b []byte
	if body != nil {
		b, _ = json.Marshal(body)
	}
	r := httptest.NewRequest(method, "http://bomish.test/api/v1"+path, bytes.NewReader(b))
	r.Header.Set("Origin", "http://bomish.test")
	r.Header.Set("X-CSRF-Token", c.csrf)
	for _, cookie := range c.cookies {
		r.AddCookie(cookie)
	}
	w := httptest.NewRecorder()
	c.h.ServeHTTP(w, r)
	for _, cookie := range w.Result().Cookies() {
		c.cookies = []*http.Cookie{cookie}
	}
	return w.Code, w.Body.Bytes()
}
func (c *client) ok(t *testing.T, method, path string, body, out any) {
	t.Helper()
	status, raw := c.call(method, path, body)
	if status < 200 || status >= 300 {
		t.Fatalf("%s %s = %d %s", method, path, status, raw)
	}
	if out != nil {
		if e := json.Unmarshal(raw, out); e != nil {
			t.Fatal(e)
		}
	}
}
func newClient(t *testing.T, h http.Handler) *client {
	t.Helper()
	c := &client{h: h}
	var s struct {
		CSRF string `json:"csrf"`
	}
	c.ok(t, "GET", "/session", nil, &s)
	c.csrf = s.CSRF
	return c
}
func (c *client) login(t *testing.T, phone string) {
	t.Helper()
	var code struct {
		DevCode string `json:"devCode"`
	}
	c.ok(t, "POST", "/auth/request", map[string]string{"phone": phone}, &code)
	c.ok(t, "POST", "/auth/verify", map[string]string{"phone": phone, "code": code.DevCode}, nil)
}
func (c *client) staff(t *testing.T, role string) {
	t.Helper()
	c.ok(t, "POST", "/staff/login", map[string]string{"username": role, "password": "Bomish-demo-2026!", "code": TOTP(DemoTOTP, time.Now().Unix()/30)}, nil)
}
func setup(t *testing.T) *App {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("set TEST_DATABASE_URL for isolated PostgreSQL integration tests")
	}
	ctx := context.Background()
	base, e := pgxpool.New(ctx, url)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = base.Exec(ctx, "CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public"); e != nil {
		t.Fatal(e)
	}
	schema := "test_" + token()[:16]
	if _, e = base.Exec(ctx, "CREATE SCHEMA "+schema); e != nil {
		t.Fatal(e)
	}
	cfg, e := pgxpool.ParseConfig(url)
	if e != nil {
		t.Fatal(e)
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = schema + ",public"
	pool, e := pgxpool.NewWithConfig(ctx, cfg)
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { pool.Close(); _, _ = base.Exec(ctx, "DROP SCHEMA "+schema+" CASCADE"); base.Close() })
	entries, _ := migrations.Files.ReadDir(".")
	for _, entry := range entries {
		if strings.HasSuffix(entry.Name(), ".sql") {
			sql, _ := migrations.Files.ReadFile(entry.Name())
			if _, e = pool.Exec(ctx, string(sql)); e != nil {
				t.Fatal(e)
			}
		}
	}
	a := &App{Pool: pool, Queries: db.New(pool), Dev: true, Origin: "http://bomish.test", Uploads: storage.Local{Root: t.TempDir()}}
	if e = a.Seed(ctx); e != nil {
		t.Fatal(e)
	}
	// A 500g package preserves the existing checkout scenarios.
	var raw []byte
	if e = a.Pool.QueryRow(ctx, "SELECT content FROM products WHERE id='turmeric'").Scan(&raw); e != nil {
		t.Fatal(e)
	}
	var p domain.Product
	_ = json.Unmarshal(raw, &p)
	p.Packages = []domain.Package{{ID: "test500", Amount: 500, Unit: "g", PriceRials: domain.Total(p.PriceRials, 500), MaxQuantity: 5}}
	raw, _ = json.Marshal(p)
	if _, e = a.Pool.Exec(ctx, "UPDATE products SET content=$1 WHERE id='turmeric'", raw); e != nil {
		t.Fatal(e)
	}
	return a
}
func TestStoreIntegration(t *testing.T) {
	a := setup(t)
	h := a.Handler()
	ctx := context.Background()
	owner := newClient(t, h)
	owner.staff(t, "owner")
	editor := newClient(t, h)
	editor.staff(t, "editor")
	operator := newClient(t, h)
	operator.staff(t, "operator")
	t.Run("CSRF and role isolation", func(t *testing.T) {
		c := newClient(t, h)
		old := c.csrf
		c.csrf = "wrong"
		if code, _ := c.call("PUT", "/cart/items/turmeric", map[string]int{"grams": 500}); code != 403 {
			t.Fatal(code)
		}
		c.csrf = old
		for _, test := range []struct {
			c    *client
			path string
		}{{c, "/staff/products"}, {editor, "/staff/orders"}, {editor, "/staff/shipping"}, {operator, "/staff/products"}, {operator, "/omnisire/members"}} {
			if code, _ := test.c.call("GET", test.path, nil); code != 403 {
				t.Fatalf("%s %d", test.path, code)
			}
		}
		if code, _ := editor.call("POST", "/staff/products/turmeric/publish", nil); code != 200 {
			t.Fatal(code)
		}
	})
	t.Run("draft publication and search", func(t *testing.T) {
		p := domain.Product{ID: "test-spice", Slug: "test-spice", Name: "ادویه تست", CategoryID: "spices", MinGrams: 100, StepGrams: 100, MaxGrams: 10000, Summary: "خلاصه", Description: "شرح محصول", Images: []string{"/images/spices.png"}, Aliases: []string{"ادويه آزمايشي"}}
		editor.ok(t, "PUT", "/staff/products/test-spice", p, nil)
		if code, _ := editor.call("GET", "/products/test-spice", nil); code != 404 {
			t.Fatal("draft exposed", code)
		}
		p.PriceRials = 1200000
		p.Packages = []domain.Package{{ID: "small", Amount: 100, Unit: "g", PriceRials: 120000, MaxQuantity: 5}}
		if code, _ := editor.call("PUT", "/staff/products/test-spice", p); code != 200 {
			t.Fatal("editor could not set price", code)
		}
		owner.ok(t, "PUT", "/staff/products/test-spice", p, nil)
		owner.ok(t, "POST", "/staff/products/test-spice/publish", nil, nil)
		owner.ok(t, "POST", "/staff/products/test-spice/availability", map[string]any{"outOfStock": false}, nil)
		var result []domain.Product
		owner.ok(t, "GET", "/products?q=ادویه%20آزمایشی", nil, &result)
		if len(result) == 0 || result[0].ID != "test-spice" {
			t.Fatalf("search %+v", result)
		}
		p.Name = "تغییر پیش‌نویس"
		p.PriceRials = 0
		editor.ok(t, "PUT", "/staff/products/test-spice", p, nil)
		var public domain.Product
		editor.ok(t, "GET", "/products/test-spice", nil, &public)
		if public.Name == p.Name {
			t.Fatal("unapproved change visible")
		}
	})
	t.Run("OTP rejection replay and expiry", func(t *testing.T) {
		c := newClient(t, h)
		var response struct {
			DevCode string `json:"devCode"`
		}
		phone := "09120000001"
		c.ok(t, "POST", "/auth/request", map[string]string{"phone": phone}, &response)
		if code, _ := c.call("POST", "/auth/request", map[string]string{"phone": phone}); code != 429 {
			t.Fatal("resend not limited", code)
		}
		for i := 0; i < 5; i++ {
			if code, _ := c.call("POST", "/auth/verify", map[string]string{"phone": phone, "code": "invalid"}); code != 400 {
				t.Fatal(code)
			}
		}
		if code, _ := c.call("POST", "/auth/verify", map[string]string{"phone": phone, "code": response.DevCode}); code != 400 {
			t.Fatal("attempt cap bypass")
		}
		phone = "09120000002"
		c.ok(t, "POST", "/auth/request", map[string]string{"phone": phone}, &response)
		_, _ = a.Pool.Exec(ctx, "UPDATE otp_challenges SET expires_at=now()-interval '1 second' WHERE phone=$1", phone)
		if code, _ := c.call("POST", "/auth/verify", map[string]string{"phone": phone, "code": response.DevCode}); code != 400 {
			t.Fatal("expired accepted")
		}
		phone = "09120000003"
		c.ok(t, "POST", "/auth/request", map[string]string{"phone": phone}, &response)
		old := c.cookies[0].Value
		c.ok(t, "POST", "/auth/verify", map[string]string{"phone": phone, "code": response.DevCode}, nil)
		if c.cookies[0].Value == old {
			t.Fatal("session not rotated")
		}
		if code, _ := c.call("POST", "/auth/verify", map[string]string{"phone": phone, "code": response.DevCode}); code != 400 {
			t.Fatal("code reused")
		}
	})
	address := domain.Address{Recipient: "تست", Phone: "09120000004", Province: "تهران", City: "تهران", Street: "خیابان نمونه پلاک ۱۲ واحد ۱", PostalCode: "1234567890"}
	create := func(c *client, g int, id string) string {
		c.ok(t, "PUT", "/cart/items/turmeric", map[string]any{"packageId": "test500", "quantity": g / 500}, nil)
		var q quoteResult
		c.ok(t, "POST", "/checkout/quote", map[string]string{"province": "تهران"}, &q)
		var result map[string]string
		c.ok(t, "POST", "/checkout", map[string]any{"address": address, "expectedTotalRials": q.TotalRials, "idempotencyKey": id}, &result)
		return result["orderId"]
	}
	t.Run("cart survives auth and payment is idempotent", func(t *testing.T) {
		c := newClient(t, h)
		c.ok(t, "PUT", "/cart/items/turmeric", map[string]any{"packageId": "test500", "quantity": 3}, nil)
		c.login(t, "09120000004")
		var cart domain.Cart
		c.ok(t, "GET", "/cart", nil, &cart)
		if len(cart.Items) != 1 || cart.Items[0].Grams != 1500 {
			t.Fatal("cart lost")
		}
		var q quoteResult
		c.ok(t, "POST", "/checkout/quote", map[string]string{"province": "تهران"}, &q)
		if q.ShippingRials != 650000 {
			t.Fatal(q)
		}
		if code, _ := c.call("POST", "/checkout/quote", map[string]string{"province": "نامعتبر"}); code != 400 {
			t.Fatal("unsupported shipping accepted")
		}
		id := create(c, 1500, "idempotency-check-0001")
		var retry map[string]string
		c.ok(t, "POST", "/checkout", map[string]any{"address": address, "expectedTotalRials": q.TotalRials, "idempotencyKey": "idempotency-check-0001"}, &retry)
		if retry["orderId"] != id {
			t.Fatal("duplicate order")
		}
		for i := 0; i < 2; i++ {
			c.ok(t, "POST", "/orders/"+id+"/simulate", map[string]bool{"success": true}, nil)
		}
		var count int
		_ = a.Pool.QueryRow(ctx, "SELECT count(*) FROM stock_movements WHERE order_id=$1", id).Scan(&count)
		if count != 0 {
			t.Fatal("checkout must not create stock movements")
		}
		c.ok(t, "GET", "/cart", nil, &cart)
		if len(cart.Items) != 0 {
			t.Fatal("paid cart not cleared")
		}
		other := newClient(t, h)
		other.login(t, "09120000005")
		if code, _ := other.call("POST", "/orders/"+id+"/simulate", map[string]bool{"success": true}); code != 409 {
			t.Fatal("other customer's payment accessible")
		}
		operator.ok(t, "PATCH", "/staff/orders/"+id, map[string]string{"status": "packing", "tracking": ""}, nil)
		operator.ok(t, "PATCH", "/staff/orders/"+id, map[string]string{"status": "shipped", "tracking": "123456789012345678901234"}, nil)
	})
	t.Run("failure expiry and late settlement", func(t *testing.T) {
		c := newClient(t, h)
		c.login(t, "09120000006")
		id := create(c, 500, "failed-payment-00001")
		c.ok(t, "POST", "/orders/"+id+"/simulate", map[string]bool{"success": false}, nil)
		id = create(c, 500, "expired-payment-0001")
		_, _ = a.Pool.Exec(ctx, "UPDATE orders SET reservation_expires_at=now()-interval '1 second' WHERE id=$1", id)
		if e := a.ExpireReservations(ctx); e != nil {
			t.Fatal(e)
		}
		var s map[string]string
		c.ok(t, "POST", "/orders/"+id+"/simulate", map[string]bool{"success": true}, &s)
		if s["status"] != "paid" {
			t.Fatal(s)
		}
		id = create(c, 500, "late-available-00001")
		_, _ = a.Pool.Exec(ctx, "UPDATE orders SET reservation_expires_at=now()-interval '1 second' WHERE id=$1", id)
		if e := a.ExpireReservations(ctx); e != nil {
			t.Fatal(e)
		}
		_, _ = a.Pool.Exec(ctx, "UPDATE products SET content=jsonb_set(content,'{outOfStock}','true') WHERE id='turmeric'")
		c.ok(t, "POST", "/orders/"+id+"/simulate", map[string]bool{"success": true}, &s)
		if s["status"] != "paid" {
			t.Fatal(s)
		}
	})
	t.Run("concurrent orders do not reserve stock", func(t *testing.T) {
		_, e := a.Pool.Exec(ctx, "UPDATE products SET content=jsonb_set(content,'{outOfStock}','false') WHERE id='turmeric'")
		if e != nil {
			t.Fatal(e)
		}
		customers := []*client{newClient(t, h), newClient(t, h)}
		bodies := make([]map[string]any, 2)
		for i, c := range customers {
			c.login(t, fmt.Sprintf("0912000001%d", i))
			c.ok(t, "PUT", "/cart/items/turmeric", map[string]any{"packageId": "test500", "quantity": 2}, nil)
			var q quoteResult
			c.ok(t, "POST", "/checkout/quote", map[string]string{"province": "تهران"}, &q)
			bodies[i] = map[string]any{"address": address, "expectedTotalRials": q.TotalRials, "idempotencyKey": fmt.Sprintf("concurrent-key-%016d", i)}
		}
		codes := make([]int, 2)
		var wg sync.WaitGroup
		for i := range customers {
			wg.Add(1)
			go func(i int) { defer wg.Done(); codes[i], _ = customers[i].call("POST", "/checkout", bodies[i]) }(i)
		}
		wg.Wait()
		if codes[0] != 201 || codes[1] != 201 {
			t.Fatal(codes)
		}

	})
	t.Run("draft articles and session permissions", func(t *testing.T) {
		v := domain.Article{ID: "test-article", Slug: "test-article", Title: "مقاله", Excerpt: "خلاصه", Body: "## عنوان\nمتن", Image: "/images/spices.png", Status: "draft"}
		editor.ok(t, "PUT", "/staff/articles/test-article", v, nil)
		if code, _ := editor.call("GET", "/articles/test-article", nil); code != 404 {
			t.Fatal(code)
		}
		v.Status = "published"
		if code, _ := editor.call("PUT", "/staff/articles/test-article", v); code != 200 {
			t.Fatal(code)
		}
		owner.ok(t, "PUT", "/staff/articles/test-article", v, nil)
		var out domain.Article
		owner.ok(t, "GET", "/articles/test-article", nil, &out)
		if !strings.Contains(out.Body, "عنوان") {
			t.Fatal(out)
		}
	})
	t.Run("delivery weight boundaries", func(t *testing.T) {
		for _, c := range []struct{ grams, fee int64 }{{2000, 650000}, {2001, 950000}, {5000, 950000}, {5001, 1800000}, {25000, 1800000}} {
			cart := domain.Cart{Items: []domain.CartItem{{Product: domain.Product{Status: "published", MinGrams: 1, StepGrams: 1, MaxGrams: 100000, OutOfStock: false}, Grams: c.grams, Quantity: 1, Package: domain.Package{MaxQuantity: 5}}}, SubtotalRials: 1000}
			q, e := calculateQuote(ctx, a.Pool, cart, "تهران")
			if e != nil || q.ShippingRials != c.fee || q.WeightGrams != c.grams+200 {
				t.Fatalf("%+v %+v %v", c, q, e)
			}
		}
	})

}
