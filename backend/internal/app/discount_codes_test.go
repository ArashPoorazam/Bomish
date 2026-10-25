package app

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"testing"
	"time"

	"bomish/internal/domain"
)

func couponOwner(t *testing.T, a *App) *client {
	t.Helper()
	c := newClient(t, a.Handler())
	c.staff(t, "owner")
	return c
}
func couponCustomer(t *testing.T, a *App, phone, product string) *client {
	t.Helper()
	c := newClient(t, a.Handler())
	c.login(t, phone)
	var p domain.Product
	c.ok(t, "GET", "/products/"+product, nil, &p)
	c.ok(t, "PUT", "/cart/items/"+product, map[string]any{"packageId": p.Packages[0].ID, "quantity": 1}, nil)
	return c
}
func createCode(t *testing.T, owner *client, code, kind string, value, limit int64) {
	t.Helper()
	owner.ok(t, "POST", "/staff/discount-codes", map[string]any{"code": code, "kind": kind, "value": value, "maxUses": limit}, nil)
}
func couponQuote(t *testing.T, c *client, code string) quoteResult {
	t.Helper()
	var q quoteResult
	c.ok(t, "POST", "/checkout/quote", commerceQuote(code), &q)
	return q
}
func couponOrderBody(code, key string, q quoteResult) map[string]any {
	return map[string]any{"address": commerceAddress(), "shippingQuoteId": q.ShippingQuoteID, "method": q.Method, "expectedTotalRials": q.TotalRials, "idempotencyKey": key, "discountCode": code}
}
func TestDiscountCodeValidationAndQuote(t *testing.T) {
	a := setupCommerce(t)
	owner := couponOwner(t, a)
	c := couponCustomer(t, a, "09120000101", "turmeric")
	editor := newClient(t, a.Handler())
	editor.staff(t, "editor")
	editor.ok(t, "GET", "/staff/discount-codes", nil, nil)
	createCode(t, editor, "EDITOR10", "percent", 10, 0)
	editor.ok(t, "PATCH", "/staff/discount-codes/EDITOR10", map[string]bool{"active": false}, nil)
	createCode(t, owner, " welcome10 ", "percent", 10, 0)
	if status, _ := owner.call("POST", "/staff/discount-codes", map[string]any{"code": "WELCOME10", "kind": "fixed", "value": 100}); status != 409 {
		t.Fatal("duplicate code accepted")
	}
	for _, body := range []map[string]any{
		{"code": "XX", "kind": "percent", "value": 10}, {"code": "TOOMUCH", "kind": "percent", "value": 91}, {"code": "BAD-MONEY", "kind": "fixed", "value": 11}, {"code": "PAST", "kind": "fixed", "value": 100, "expiresAt": time.Now().Add(-time.Hour)}, {"code": "NEGATIVE", "kind": "percent", "value": 10, "maxUses": -1},
	} {
		if status, _ := owner.call("POST", "/staff/discount-codes", body); status != 400 {
			t.Fatalf("invalid accepted %v: %d", body, status)
		}
	}
	owner.ok(t, "POST", "/staff/product-discounts", map[string]any{"id": "single-sale", "name": "Single sale", "productIds": []string{"turmeric"}, "percent": 20}, nil)
	plain := couponQuote(t, c, "")
	q := couponQuote(t, c, "welcome10")
	if q.DiscountRials != (plain.SubtotalRials*10/1000)*10 || q.TotalRials != plain.TotalRials-q.DiscountRials || q.ShippingRials != plain.ShippingRials || q.DiscountCode != "WELCOME10" {
		t.Fatalf("stacked discount incorrect: %+v plain %+v", q, plain)
	}
	owner.ok(t, "POST", "/staff/discount-codes", map[string]any{"code": "CAPPED", "kind": "percent", "value": 90, "maxDiscountRials": 100}, nil)
	if couponQuote(t, c, "CAPPED").DiscountRials != 100 {
		t.Fatal("cap ignored")
	}
	createCode(t, owner, "FIXED", "fixed", 100000000, 0)
	fixed := couponQuote(t, c, "FIXED")
	if fixed.TotalRials != fixed.ShippingRials || fixed.DiscountRials != fixed.SubtotalRials {
		t.Fatal("fixed code discounted shipping or went negative")
	}
	owner.ok(t, "POST", "/staff/discount-codes", map[string]any{"code": "MINIMUM", "kind": "percent", "value": 10, "minSubtotalRials": 1000000000}, nil)
	for _, code := range []string{"MISSING", "MINIMUM"} {
		if status, _ := c.call("POST", "/checkout/quote", commerceQuote(code)); status != 422 {
			t.Fatal("invalid code accepted", code)
		}
	}
	owner.ok(t, "PATCH", "/staff/discount-codes/WELCOME10", map[string]bool{"active": false}, nil)
	if status, _ := c.call("POST", "/checkout/quote", commerceQuote("WELCOME10")); status != 422 {
		t.Fatal("disabled accepted")
	}
	if _, e := a.Pool.Exec(context.Background(), "UPDATE discount_codes SET expires_at=now()-interval '1 second' WHERE code='FIXED'"); e != nil {
		t.Fatal(e)
	}
	if status, _ := c.call("POST", "/checkout/quote", commerceQuote("FIXED")); status != 422 {
		t.Fatal("expired accepted")
	}
}
func TestDiscountOrderSnapshotsAndCapacity(t *testing.T) {
	a := setupCommerce(t)
	owner := couponOwner(t, a)
	createCode(t, owner, "ONEUSE", "percent", 15, 1)
	c := couponCustomer(t, a, "09120000102", "turmeric")
	q := couponQuote(t, c, "ONEUSE")
	body := couponOrderBody("ONEUSE", "coupon-order-00001", q)
	bad := couponOrderBody("ONEUSE", "coupon-wrong-00001", q)
	bad["expectedTotalRials"] = q.TotalRials - 10
	if status, _ := c.call("POST", "/checkout", bad); status != 409 {
		t.Fatal("tampered total accepted")
	}
	var first, repeat map[string]string
	c.ok(t, "POST", "/checkout", body, &first)
	c.ok(t, "POST", "/checkout", body, &repeat)
	if first["orderId"] != repeat["orderId"] {
		t.Fatal("retry made another order")
	}
	if status, _ := c.call("POST", "/checkout/quote", commerceQuote("ONEUSE")); status != 422 {
		t.Fatal("pending order didn't reserve capacity")
	}
	var codes []discountCode
	owner.ok(t, "GET", "/staff/discount-codes", nil, &codes)
	if codes[0].ReservedCount != 1 || codes[0].UsedCount != 0 {
		t.Fatalf("bad counts %+v", codes)
	}
	c.ok(t, "POST", "/orders/"+first["orderId"]+"/simulate", map[string]bool{"success": false}, nil)
	q = couponQuote(t, c, "ONEUSE")
	body = couponOrderBody("ONEUSE", "coupon-order-00002", q)
	c.ok(t, "POST", "/checkout", body, &first)
	owner.ok(t, "PATCH", "/staff/discount-codes/ONEUSE", map[string]bool{"active": false}, nil)
	c.ok(t, "POST", "/orders/"+first["orderId"]+"/simulate", map[string]bool{"success": true}, nil)
	var orders []domain.Order
	c.ok(t, "GET", "/orders", nil, &orders)
	found := false
	for _, o := range orders {
		if o.ID == first["orderId"] {
			found = true
			if o.DiscountCode != "ONEUSE" || o.DiscountRials != q.DiscountRials || o.TotalRials != q.TotalRials || o.Status != "paid" {
				t.Fatalf("lost discount snapshot %+v", o)
			}
		}
	}
	if !found {
		t.Fatal("order missing")
	}
	owner.ok(t, "GET", "/staff/discount-codes", nil, &codes)
	if codes[0].UsedCount != 1 || codes[0].ReservedCount != 0 {
		t.Fatalf("bad final counts %+v", codes)
	}
}
func TestDiscountConcurrentLimitAndLatePayment(t *testing.T) {
	a := setupCommerce(t)
	owner := couponOwner(t, a)
	createCode(t, owner, "LASTONE", "fixed", 100, 1)
	customers := []*client{couponCustomer(t, a, "09120000103", "turmeric"), couponCustomer(t, a, "09120000104", "cumin")}
	quotes := []quoteResult{couponQuote(t, customers[0], "LASTONE"), couponQuote(t, customers[1], "LASTONE")}
	statuses := make([]int, 2)
	raw := make([][]byte, 2)
	var wg sync.WaitGroup
	for i := range customers {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			statuses[i], raw[i] = customers[i].call("POST", "/checkout", couponOrderBody("LASTONE", fmt.Sprintf("concurrent-code-%d", i), quotes[i]))
		}(i)
	}
	wg.Wait()
	winner := 0
	if statuses[1] == 201 {
		winner = 1
	}
	loser := 1 - winner
	if statuses[winner] != 201 || statuses[loser] != 409 {
		t.Fatalf("capacity race: %v %s %s", statuses, raw[0], raw[1])
	}
	var order map[string]string
	json.Unmarshal(raw[winner], &order)
	id := order["orderId"]
	if _, e := a.Pool.Exec(context.Background(), "UPDATE orders SET reservation_expires_at=now()-interval '1 minute' WHERE id=$1", id); e != nil {
		t.Fatal(e)
	}
	if e := a.ExpireReservations(context.Background()); e != nil {
		t.Fatal(e)
	}
	q := couponQuote(t, customers[loser], "LASTONE")
	customers[loser].ok(t, "POST", "/checkout", couponOrderBody("LASTONE", "replacement-code-0001", q), nil)
	status, e := a.settle(context.Background(), id, func() string {
		var user string
		a.Pool.QueryRow(context.Background(), "SELECT user_id FROM orders WHERE id=$1", id).Scan(&user)
		return user
	}(), true)
	if e != nil || status != "review" {
		t.Fatalf("late payment overused code: %s %v", status, e)
	}
}

func TestDiscountPerCustomerLimits(t *testing.T) {
	a := setupCommerce(t)
	owner := couponOwner(t, a)
	for _, limit := range []int64{-1, 1000000001} {
		if status, _ := owner.call("POST", "/staff/discount-codes", map[string]any{"code": "BADLIMIT", "kind": "percent", "value": 10, "maxUsesPerCustomer": limit}); status != 400 {
			t.Fatalf("invalid customer limit accepted: %d", status)
		}
	}
	var created discountCode
	owner.ok(t, "POST", "/staff/discount-codes", map[string]any{"code": "ONCE-EACH", "kind": "percent", "value": 10, "maxUsesPerCustomer": 1}, &created)
	if created.MaxUsesPerCustomer != 1 || created.MaxUses != 0 {
		t.Fatalf("wrong limits: %+v", created)
	}
	var codes []discountCode
	owner.ok(t, "GET", "/staff/discount-codes", nil, &codes)
	if codes[0].MaxUsesPerCustomer != 1 {
		t.Fatal("limit missing from list")
	}
	c := couponCustomer(t, a, "09120000121", "turmeric")
	otherSession := couponCustomer(t, a, "09120000121", "cumin")
	otherCustomer := couponCustomer(t, a, "09120000122", "turmeric")
	q := couponQuote(t, c, "ONCE-EACH")
	var order, retry map[string]string
	body := couponOrderBody("ONCE-EACH", "per-customer-first", q)
	c.ok(t, "POST", "/checkout", body, &order)
	c.ok(t, "POST", "/checkout", body, &retry)
	if order["orderId"] != retry["orderId"] {
		t.Fatal("retry used another allowance")
	}
	if status, raw := otherSession.call("POST", "/checkout/quote", commerceQuote("ONCE-EACH")); status != 422 {
		t.Fatalf("same customer in new session bypassed limit: %d %s", status, raw)
	}
	couponQuote(t, otherCustomer, "ONCE-EACH")
	c.ok(t, "POST", "/orders/"+order["orderId"]+"/simulate", map[string]bool{"success": false}, nil)
	q = couponQuote(t, c, "ONCE-EACH")
	c.ok(t, "POST", "/checkout", couponOrderBody("ONCE-EACH", "per-customer-second", q), &order)
	c.ok(t, "POST", "/orders/"+order["orderId"]+"/simulate", map[string]bool{"success": true}, nil)
	if status, _ := otherSession.call("POST", "/checkout/quote", commerceQuote("ONCE-EACH")); status != 422 {
		t.Fatal("paid use did not consume allowance")
	}
	couponQuote(t, otherCustomer, "ONCE-EACH")
}

func TestDiscountPerCustomerConcurrentAndLatePayment(t *testing.T) {
	a := setupCommerce(t)
	owner := couponOwner(t, a)
	owner.ok(t, "POST", "/staff/discount-codes", map[string]any{"code": "PER-TWO", "kind": "fixed", "value": 100, "maxUsesPerCustomer": 2}, nil)
	// Separate sessions and carts for the same account must share one allowance.
	customers := []*client{couponCustomer(t, a, "09120000123", "turmeric"), couponCustomer(t, a, "09120000123", "cumin")}
	q := []quoteResult{couponQuote(t, customers[0], "PER-TWO"), couponQuote(t, customers[1], "PER-TWO")}
	var initial map[string]string
	customers[0].ok(t, "POST", "/checkout", couponOrderBody("PER-TWO", "per-two-initial-0001", q[0]), &initial)
	q[0] = couponQuote(t, customers[0], "PER-TWO")
	statuses := make([]int, 2)
	var wg sync.WaitGroup
	for i := range customers {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			statuses[i], _ = customers[i].call("POST", "/checkout", couponOrderBody("PER-TWO", fmt.Sprintf("per-two-race-000%d", i), q[i]))
		}(i)
	}
	wg.Wait()
	if !((statuses[0] == 201 && statuses[1] == 409) || (statuses[0] == 409 && statuses[1] == 201)) {
		t.Fatalf("customer allowance race: %v", statuses)
	}
	ctx := context.Background()
	if _, e := a.Pool.Exec(ctx, "UPDATE orders SET reservation_expires_at=now()-interval '1 minute' WHERE id=$1", initial["orderId"]); e != nil {
		t.Fatal(e)
	}
	if e := a.ExpireReservations(ctx); e != nil {
		t.Fatal(e)
	}
	replacement := couponQuote(t, customers[0], "PER-TWO")
	customers[0].ok(t, "POST", "/checkout", couponOrderBody("PER-TWO", "per-two-replacement", replacement), nil)
	var user string
	if e := a.Pool.QueryRow(ctx, "SELECT user_id FROM orders WHERE id=$1", initial["orderId"]).Scan(&user); e != nil {
		t.Fatal(e)
	}
	status, e := a.settle(ctx, initial["orderId"], user, true)
	if e != nil || status != "review" {
		t.Fatalf("late payment bypassed customer limit: %s %v", status, e)
	}
}
