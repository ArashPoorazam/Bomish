package app

import (
	"bomish/internal/domain"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
)

func TestRequestsOwnershipRetriesDecisionsAndNotifications(t *testing.T) {
	a := setup(t)
	h := a.Handler()
	c := newClient(t, h)
	c.login(t, "09121110001")
	other := newClient(t, h)
	other.login(t, "09121110002")
	operator, _ := testStaff(t, a, "operator", nil)
	restricted, _ := testStaff(t, a, "operator", []string{"requests"})
	for _, path := range []string{"/staff/requests?kind=support", "/staff/requests?kind=custom"} {
		if code, _ := restricted.call("GET", path, nil); code != 403 {
			t.Fatal("restricted access", code)
		}
	}
	var chat map[string]string
	body := map[string]any{"kind": "support", "description": "آیا ارسال دارید؟", "idempotencyKey": "support-request-00001"}
	c.ok(t, "POST", "/requests", body, &chat)
	c.ok(t, "POST", "/requests", body, nil)
	id := chat["id"]
	for _, method := range []string{"GET", "POST"} {
		if code, _ := other.call(method, "/requests/"+id+"/messages", map[string]string{"body": "bad", "idempotencyKey": "not-owned-message"}); code != 404 {
			t.Fatal("ownership", code)
		}
	}
	var messages []map[string]any
	c.ok(t, "GET", "/requests/"+id+"/messages", nil, &messages)
	if len(messages) != 1 {
		t.Fatal("duplicate initial message", messages)
	}
	var counts map[string]int64
	operator.ok(t, "GET", "/staff/notifications", nil, &counts)
	if counts["support"] != 1 {
		t.Fatal(counts)
	}
	operator.ok(t, "POST", "/staff/requests/"+id+"/read", map[string]any{"lastMessageId": messages[0]["id"]}, nil)
	operator.ok(t, "GET", "/staff/notifications", nil, &counts)
	if counts["support"] != 0 {
		t.Fatal(counts)
	}
	response := map[string]string{"body": "بله، ارسال داریم", "idempotencyKey": "staff-message-00001"}
	operator.ok(t, "POST", "/staff/requests/"+id+"/messages", response, nil)
	operator.ok(t, "POST", "/staff/requests/"+id+"/messages", response, nil)
	c.ok(t, "GET", "/requests/"+id+"/messages", nil, &messages)
	if len(messages) != 2 || messages[1]["fromStaff"] != true {
		t.Fatal(messages)
	}
	c.ok(t, "POST", "/requests/"+id+"/messages", map[string]string{"body": "ممنون", "idempotencyKey": "customer-message-002"}, nil)
	operator.ok(t, "GET", "/staff/notifications", nil, &counts)
	if counts["support"] != 1 {
		t.Fatal("new reply did not notify", counts)
	}
	if code, _ := c.call("POST", "/requests/"+id+"/messages", map[string]string{"body": strings.Repeat("x", 4001), "idempotencyKey": "too-long-message-01"}); code != 400 {
		t.Fatal("unbounded message", code)
	}
	var custom map[string]string
	customBody := map[string]any{"kind": "custom", "description": "ادویه مخصوص", "quantity": "۵ کیلو", "budgetRials": 2000000, "idempotencyKey": "custom-request-0001"}
	c.ok(t, "POST", "/requests", customBody, &custom)
	c.ok(t, "POST", "/requests", customBody, nil)
	customBody["budgetRials"] = 3000000
	if code, _ := c.call("POST", "/requests", customBody); code != 409 {
		t.Fatal("key reused with different payload", code)
	}
	path := "/staff/requests/" + custom["id"]
	decision := map[string]any{"status": "follow_up", "response": "با شما هماهنگ می‌کنیم", "version": 1}
	operator.ok(t, "PATCH", path, decision, nil)
	if code, _ := operator.call("PATCH", path, decision); code != 409 {
		t.Fatal("stale update accepted", code)
	}
	decision["status"] = "accepted"
	decision["version"] = 2
	operator.ok(t, "PATCH", path, decision, nil)
	var list []map[string]any
	c.ok(t, "GET", "/requests?kind=custom", nil, &list)
	if len(list) != 1 || list[0]["status"] != "accepted" || list[0]["response"] != decision["response"] {
		t.Fatal(list)
	}
	other.ok(t, "GET", "/requests?kind=custom", nil, &list)
	if len(list) != 0 {
		t.Fatal("private request leaked")
	}
	anon := newClient(t, h)
	if code, _ := anon.call("POST", "/requests", body); code != 401 {
		t.Fatal(code)
	}
	c.csrf = "wrong"
	if code, _ := c.call("POST", "/requests", body); code != 403 {
		t.Fatal("CSRF bypass", code)
	}
}
func TestCustomerSessionSurvivesStaffLoginAndOrderUpdates(t *testing.T) {
	a := setup(t)
	c := newClient(t, a.Handler())
	c.login(t, "09121110003")
	var customerCookie string
	for _, cookie := range c.cookies {
		if cookie.Name == "bomish_session" {
			customerCookie = cookie.Value
		}
	}
	customerCSRF := c.csrf
	c.staff(t, "operator") // Same browser cookie jar, two independently authenticated workspaces.
	var s map[string]any
	c.ok(t, "GET", "/session", nil, &s)
	if s["authenticated"] != true || s["role"] != "" {
		t.Fatal("customer identity replaced", s)
	}
	for _, cookie := range c.cookies {
		if cookie.Name == "bomish_session" && cookie.Value != customerCookie {
			t.Fatal("customer cookie rotated by staff login")
		}
	}
	var uid string
	a.Pool.QueryRow(context.Background(), `SELECT id FROM users WHERE phone='09121110003'`).Scan(&uid)
	_, e := a.Pool.Exec(context.Background(), `INSERT INTO orders(id,user_id,idempotency_key,status,address,subtotal_rials,shipping_rials,total_rials,reservation_expires_at) VALUES('session-order',$1,'session-order','paid','{"phone":"09121110003"}',0,0,0,now())`, uid)
	if e != nil {
		t.Fatal(e)
	}
	for _, status := range []string{"packing", "shipped", "received"} {
		c.ok(t, "PATCH", "/staff/orders/session-order", map[string]string{"status": status, "tracking": "123456789012345678901234"}, nil)
		var orders []domain.Order
		c.ok(t, "GET", "/orders", nil, &orders)
		if len(orders) != 1 || orders[0].Status != status {
			t.Fatal("customer cannot read updated order", orders)
		}
	}
	c.ok(t, "POST", "/logout?workspace=staff", nil, nil)
	c.csrf = customerCSRF
	c.ok(t, "GET", "/session", nil, &s)
	if s["authenticated"] != true {
		t.Fatal("staff logout removed customer")
	}
}
func TestSessionDatabaseFailureDoesNotReplaceCookie(t *testing.T) {
	a := setup(t)
	c := newClient(t, a.Handler())
	c.login(t, "09121110004")
	a.Pool.Close()
	r := httptest.NewRequest("GET", "http://bomish.test/api/v1/session", nil)
	for _, cookie := range c.cookies {
		r.AddCookie(cookie)
	}
	w := httptest.NewRecorder()
	a.Handler().ServeHTTP(w, r)
	if w.Code != 503 || len(w.Result().Cookies()) != 0 {
		t.Fatalf("temporary failure changed session: %d %v", w.Code, w.Result().Cookies())
	}
}
func TestStaleSessionRequestCannotOverwriteRotatedCookie(t *testing.T) {
	a := setup(t)
	c := newClient(t, a.Handler())
	old := c.cookies[0]
	c.login(t, "09121110005")
	r := httptest.NewRequest(http.MethodGet, "http://bomish.test/api/v1/orders", nil)
	r.AddCookie(old)
	w := httptest.NewRecorder()
	a.Handler().ServeHTTP(w, r)
	if w.Code != 401 || len(w.Result().Cookies()) != 0 {
		t.Fatal("stale request replaced cookie")
	}
}
func TestSuggestionCollections(t *testing.T) {
	a := setup(t)
	ctx := context.Background()
	owner := couponOwner(t, a)
	c := newClient(t, a.Handler())
	var products []domain.Product
	c.ok(t, "GET", "/products?collection=suggestions", nil, &products)
	if len(products) != 0 {
		t.Fatal("automatic suggestions")
	}
	owner.ok(t, "PUT", "/staff/suggestions", map[string]any{"productIds": []string{"mint", "turmeric"}}, nil)
	c.ok(t, "GET", "/products?collection=suggestions", nil, &products)
	if len(products) != 2 || products[0].ID != "mint" {
		t.Fatal(products)
	}
	owner.ok(t, "POST", "/staff/products/mint/availability", map[string]bool{"outOfStock": true}, nil)
	c.ok(t, "GET", "/products?collection=suggestions&available=true", nil, &products)
	if len(products) != 1 {
		t.Fatal("unavailable suggested", products)
	}
	owner.ok(t, "POST", "/staff/products/mint/availability", map[string]bool{"outOfStock": false}, nil)
	c.ok(t, "GET", "/products?collection=arrivals&sort=newest", nil, &products)
	if len(products) != 1 || products[0].ID != "mint" {
		t.Fatal("restock missing", products)
	}
	var before, after string
	a.Pool.QueryRow(ctx, `SELECT restocked_at::text FROM products WHERE id='mint'`).Scan(&before)
	owner.ok(t, "POST", "/staff/products/mint/availability", map[string]bool{"outOfStock": false}, nil)
	a.Pool.QueryRow(ctx, `SELECT restocked_at::text FROM products WHERE id='mint'`).Scan(&after)
	if before != after {
		t.Fatal("no-op restocked")
	}
	c.login(t, "09121110006")
	var uid string
	a.Pool.QueryRow(ctx, `SELECT id FROM users WHERE phone='09121110006'`).Scan(&uid)
	for _, row := range []struct {
		id, product, status, age string
		quantity                 int
	}{{"recent-a", "turmeric", "paid", "1 day", 3}, {"recent-b", "mint", "received", "2 days", 5}, {"old", "turmeric", "paid", "31 days", 100}, {"cancelled", "turmeric", "cancelled", "1 day", 100}, {"unpaid", "turmeric", "pending", "1 day", 100}} {
		_, e := a.Pool.Exec(ctx, `INSERT INTO orders(id,user_id,idempotency_key,status,address,subtotal_rials,shipping_rials,total_rials,reservation_expires_at,paid_at) VALUES($1,$2,$1,$3,'{}',0,0,0,now(),now()-$4::interval)`, row.id, uid, row.status, row.age)
		if e != nil {
			t.Fatal(e)
		}
		_, e = a.Pool.Exec(ctx, `INSERT INTO order_items(order_id,product_id,name,grams,price_rials,total_rials,package_id,quantity) VALUES($1,$2,'test',500,1000,1000,'test', $3)`, row.id, row.product, row.quantity)
		if e != nil {
			t.Fatal(e)
		}
	}
	c.ok(t, "GET", "/products?collection=bestsellers", nil, &products)
	if len(products) != 2 || products[0].ID != "mint" {
		b, _ := json.Marshal(products)
		t.Fatal(string(b))
	}
}

func TestConcurrentSupportCreationAndMessageRetry(t *testing.T) {
	a := setup(t)
	c := newClient(t, a.Handler())
	c.login(t, "09121110007")
	clones := []*client{{h: c.h, cookies: c.cookies, csrf: c.csrf}, {h: c.h, cookies: c.cookies, csrf: c.csrf}}
	type result struct {
		code int
		body []byte
	}
	results := make(chan result, 2)
	for _, clone := range clones {
		go func(c *client) {
			status, body := c.call("POST", "/requests", map[string]string{"kind": "support", "description": "پیام هم‌زمان", "idempotencyKey": "concurrent-support-001"})
			results <- result{status, body}
		}(clone)
	}
	var first map[string]string
	for i := 0; i < 2; i++ {
		r := <-results
		if r.code != 201 {
			t.Fatalf("concurrent creation %d %s", r.code, r.body)
		}
		var v map[string]string
		json.Unmarshal(r.body, &v)
		if first == nil {
			first = v
		} else if first["id"] != v["id"] {
			t.Fatal("two conversations created")
		}
	}
	for _, clone := range clones {
		go func(c *client) {
			status, body := c.call("POST", "/requests/"+first["id"]+"/messages", map[string]string{"body": "ارسال مجدد", "idempotencyKey": "concurrent-message-001"})
			results <- result{status, body}
		}(clone)
	}
	for i := 0; i < 2; i++ {
		r := <-results
		if r.code != 201 {
			t.Fatalf("concurrent message %d %s", r.code, r.body)
		}
	}
	var messages []map[string]any
	c.ok(t, "GET", "/requests/"+first["id"]+"/messages", nil, &messages)
	if len(messages) != 2 {
		t.Fatal("duplicate messages", messages)
	}
	one, _ := testStaff(t, a, "operator", nil)
	two, _ := testStaff(t, a, "operator", nil)
	one.ok(t, "POST", "/staff/requests/"+first["id"]+"/read", map[string]any{"lastMessageId": messages[1]["id"]}, nil)
	var counts map[string]int64
	two.ok(t, "GET", "/staff/notifications", nil, &counts)
	if counts["support"] != 1 {
		t.Fatal("one staff read hid another's notification")
	}
}

func TestRequestValidation(t *testing.T) {
	for _, value := range []string{"", "   ", "hello\x00world", strings.Repeat("ن", 4001)} {
		if validText(value, 4000) {
			t.Fatalf("invalid text accepted: %q", value)
		}
	}
	if !validText(strings.Repeat("ن", 4000), 4000) {
		t.Fatal("valid Unicode boundary rejected")
	}
	for _, key := range []string{"short", "invalid key with spaces", "invalid-key-0000\x00", strings.Repeat("x", 101)} {
		if validRequestKey(key) {
			t.Fatalf("invalid key accepted %q", key)
		}
	}
	if !validRequestKey("a-valid-UUID-key-0123") {
		t.Fatal("valid key rejected")
	}
}

func TestMessagePagesAndEventMarkers(t *testing.T) {
	a := setup(t)
	c := newClient(t, a.Handler())
	c.login(t, "09121110191")
	operator, _ := testStaff(t, a, "operator", nil)
	var chat map[string]string
	c.ok(t, "POST", "/requests", map[string]any{"kind": "support", "description": "first", "idempotencyKey": "pagination-start-001"}, &chat)
	path := "/requests/" + chat["id"] + "/messages"
	_, err := a.Pool.Exec(context.Background(), `INSERT INTO request_messages(request_id,body,idempotency_key) SELECT $1,'history-'||n,'history-'||n FROM generate_series(1,249) n`, chat["id"])
	if err != nil {
		t.Fatal(err)
	}
	var latest, older, first, forward []struct {
		ID int64 `json:"id"`
	}
	c.ok(t, "GET", path+"?latest=true", nil, &latest)
	if len(latest) != 100 {
		t.Fatal(len(latest))
	}
	c.ok(t, "GET", path+"?before="+strconv.FormatInt(latest[0].ID, 10), nil, &older)
	c.ok(t, "GET", path+"?before="+strconv.FormatInt(older[0].ID, 10), nil, &first)
	if len(older) != 100 || len(first) != 50 || first[49].ID >= older[0].ID || older[99].ID >= latest[0].ID {
		t.Fatal("page overlap or missing history")
	}
	c.ok(t, "GET", path+"?after="+strconv.FormatInt(older[99].ID, 10), nil, &forward)
	if len(forward) != 100 || forward[0].ID != latest[0].ID {
		t.Fatal("forward compatibility")
	}
	for _, query := range []string{"?before=0", "?before=-1", "?before=x", "?latest=false", "?latest=true&after=0", "?before=1&after=0", "?latest=true&before=1"} {
		if status, _ := c.call("GET", path+query, nil); status != 400 {
			t.Fatal(query, status)
		}
	}
	other := newClient(t, a.Handler())
	other.login(t, "09121110192")
	if status, _ := other.call("GET", path+"?latest=true", nil); status != 404 {
		t.Fatal("page ownership", status)
	}
	restricted, _ := testStaff(t, a, "operator", []string{"requests"})
	if status, _ := restricted.call("GET", "/staff"+path+"?before=1", nil); status != 403 {
		t.Fatal("page permission", status)
	}
	var before, after map[string]int64
	operator.ok(t, "GET", "/staff/notifications", nil, &before)
	c.ok(t, "POST", path, map[string]string{"body": "new incoming", "idempotencyKey": "pagination-incoming-001"}, nil)
	operator.ok(t, "GET", "/staff/notifications", nil, &after)
	if before["support"] != after["support"] || after["supportEvent"] <= before["supportEvent"] {
		t.Fatal("unchanged count event", before, after)
	}
	operator.ok(t, "GET", "/staff/notifications", nil, &before)
	if before["supportEvent"] != after["supportEvent"] {
		t.Fatal("poll changed event")
	}
}
