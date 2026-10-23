package app

import (
	"bomish/internal/carrier"
	"bomish/internal/domain"
	"context"
	"slices"
	"strings"
	"sync"
	"testing"
)

func createTestCourier(t *testing.T, owner *client, name string, active bool) string {
	t.Helper()
	var result map[string]string
	owner.ok(t, "POST", "/omnisire/members", map[string]any{
		"fullName": name, "username": "courier-" + token()[:12], "phone": "09123456789",
		"bankCard": "5022291002696175", "role": "courier", "active": active,
		"password": "test-courier-password", "restrictions": []string{},
	}, &result)
	return result["id"]
}

func TestOwnCourierLifecycleAndRoster(t *testing.T) {
	a, owner, customer, addr := shippingFixture(t)
	ctx := context.Background()
	courierID := createTestCourier(t, owner, "پیک سفارش", true)
	createTestCourier(t, owner, "پیک غیرفعال", false)
	archived := createTestCourier(t, owner, "پیک بایگانی", true)
	owner.ok(t, "DELETE", "/omnisire/members/"+archived, nil, nil)
	operator := newClient(t, a.Handler())
	operator.staff(t, "operator")
	var couriers []staffCourier
	operator.ok(t, "GET", "/staff/shipping/couriers", nil, &couriers)
	if len(couriers) != 1 || couriers[0].ID != courierID {
		t.Fatalf("wrong courier roster: %+v", couriers)
	}
	if perms := effectivePermissions("courier", nil); slices.Contains(perms, "orders") || slices.Contains(perms, "members") {
		t.Fatal("courier role gained administrative access", perms)
	}
	if code, _ := customer.call("GET", "/staff/shipping/couriers", nil); code != 403 {
		t.Fatal("customer accessed courier roster", code)
	}
	id, quote, _ := quoteAndCheckout(t, customer, addr, "")
	d := prepareShipping(t, customer, operator, id)
	if !slices.Contains(d.AllowedActions, "own_courier_dispatch") || quote.Method != "snapp" {
		t.Fatal("missing dispatch choice or changed quote provider")
	}
	// Internal dispatch must work even when Snapp cannot quote or book now.
	a.ShippingProvider = carrier.Disabled{}
	version := d.Version
	operator.ok(t, "POST", "/staff/orders/"+id+"/own-courier", map[string]any{"version": version, "courierId": courierID}, &d)
	if d.Status != "picked_up" || d.AssignedCourier == nil || d.AssignedCourier.ID != courierID || d.ActualCostRials != nil || d.Method != "snapp" || d.Review != nil || slices.Contains(d.AllowedActions, "refresh") || slices.Contains(d.AllowedActions, "book") {
		t.Fatalf("invalid own courier dispatch: %+v", d)
	}
	if code, _ := operator.call("POST", "/staff/orders/"+id+"/own-courier", map[string]any{"version": version, "courierId": courierID}); code != 409 {
		t.Fatal("duplicate dispatch accepted", code)
	}
	var count int
	if err := a.Pool.QueryRow(ctx, "SELECT count(*) FROM shipment_attempts WHERE order_id=$1", id).Scan(&count); err != nil || count != 0 {
		t.Fatal("internal handoff created a carrier booking", count, err)
	}
	for _, action := range []string{"ready", "dispatch-quote", "shipments"} {
		body := map[string]any{"version": d.Version}
		if action == "shipments" {
			body["idempotencyKey"] = token()
		}
		if code, _ := operator.call("POST", "/staff/orders/"+id+"/"+action, body); code != 409 {
			t.Fatal("internal dispatch allowed", action, code)
		}
	}
	// Preserve assignment even if the member is renamed and archived later.
	if _, err := a.Pool.Exec(ctx, `UPDATE staff SET full_name='نام جدید' WHERE id=$1`, courierID); err != nil {
		t.Fatal(err)
	}
	owner.ok(t, "DELETE", "/omnisire/members/"+courierID, nil, nil)
	operator.ok(t, "GET", "/staff/orders/"+id+"/delivery", nil, &d)
	if d.AssignedCourier.FullName != "پیک سفارش" {
		t.Fatal("courier history changed")
	}
	operator.ok(t, "POST", "/staff/orders/"+id+"/own-courier/delivered", map[string]any{"version": d.Version}, &d)
	if d.Status != "delivered" || slices.Contains(d.AllowedActions, "own_courier_delivered") {
		t.Fatal("delivery confirmation not applied")
	}
	if code, _ := operator.call("POST", "/staff/orders/"+id+"/own-courier/delivered", map[string]any{"version": d.Version}); code != 409 {
		t.Fatal("delivery confirmed twice", code)
	}
	var result struct {
		Order domain.Order `json:"order"`
	}
	customer.ok(t, "GET", "/orders/"+id, nil, &result)
	if result.Order.Status != "received" || result.Order.Shipping.Method != "own_courier" || result.Order.TotalRials != quote.TotalRials || len(result.Order.Shipping.Events) != 2 {
		t.Fatalf("wrong customer projection: %+v", result)
	}
	_, raw := customer.call("GET", "/orders/"+id, nil)
	for _, secret := range []string{courierID, "assignedCourier", "actualCostRials"} {
		if strings.Contains(string(raw), secret) {
			t.Fatal("courier staff data leaked", secret)
		}
	}
	if result.Order.Shipping.Courier == nil || result.Order.Shipping.Courier.Name != "پیک سفارش" || result.Order.Shipping.Courier.Phone != "09123456789" {
		t.Fatal("customer courier contact missing", result.Order.Shipping)
	}
	var orders []domain.Order
	operator.ok(t, "GET", "/staff/orders?provider=own_courier", nil, &orders)
	if len(orders) != 1 || orders[0].ID != id {
		t.Fatal("internal courier filter failed")
	}
	operator.ok(t, "GET", "/staff/orders?provider=snapp", nil, &orders)
	if len(orders) != 0 {
		t.Fatal("internal courier misreported as Snapp")
	}
	if err := a.Pool.QueryRow(ctx, `SELECT count(*) FROM jobs WHERE kind='order_sms' AND payload->>'orderId'=$1`, id).Scan(&count); err != nil || count != 4 {
		t.Fatal("milestone notifications duplicated or missing", count, err)
	}
	if err := a.Pool.QueryRow(ctx, `SELECT count(*) FROM audit_events WHERE entity_id=$1 AND action LIKE 'shipping.own-courier.%'`, id).Scan(&count); err != nil || count != 2 {
		t.Fatal("assignment audit missing", count, err)
	}
}

func TestOwnCourierDispatchGuards(t *testing.T) {
	a, owner, customer, addr := shippingFixture(t)
	ctx := context.Background()
	courierID := createTestCourier(t, owner, "پیک فعال", true)
	inactive := createTestCourier(t, owner, "پیک غیرفعال", false)
	id, _, _ := quoteAndCheckout(t, customer, addr, "")
	var d deliveryRecord
	owner.ok(t, "GET", "/staff/orders/"+id+"/delivery", nil, &d)
	assertConflict := func(path string, body map[string]any) {
		t.Helper()
		if code, raw := owner.call("POST", "/staff/orders/"+id+path, body); code != 409 {
			t.Fatalf("expected conflict %s: %d %s", path, code, raw)
		}
	}
	assertConflict("/own-courier", map[string]any{"version": d.Version, "courierId": courierID})
	d = prepareShipping(t, customer, owner, id)
	assertConflict("/own-courier/delivered", map[string]any{"version": d.Version})
	var nonCourier string
	if err := a.Pool.QueryRow(ctx, `SELECT id FROM staff WHERE role='operator' LIMIT 1`).Scan(&nonCourier); err != nil {
		t.Fatal(err)
	}
	for _, invalid := range []string{"does-not-exist", inactive, nonCourier} {
		assertConflict("/own-courier", map[string]any{"version": d.Version, "courierId": invalid})
	}
	// The role must still be valid when submitted, even if it was in a stale dropdown.
	if _, err := a.Pool.Exec(ctx, `UPDATE staff SET role='salesperson' WHERE id=$1`, courierID); err != nil {
		t.Fatal(err)
	}
	assertConflict("/own-courier", map[string]any{"version": d.Version, "courierId": courierID})
	if _, err := a.Pool.Exec(ctx, `UPDATE staff SET role='courier' WHERE id=$1`, courierID); err != nil {
		t.Fatal(err)
	}
	if _, err := a.Pool.Exec(ctx, `UPDATE order_items SET packed=false WHERE order_id=$1`, id); err != nil {
		t.Fatal(err)
	}
	assertConflict("/own-courier", map[string]any{"version": d.Version, "courierId": courierID})
	if _, err := a.Pool.Exec(ctx, `UPDATE order_items SET packed=true WHERE order_id=$1`, id); err != nil {
		t.Fatal(err)
	}
	owner.ok(t, "POST", "/staff/orders/"+id+"/dispatch-quote", map[string]any{"version": d.Version}, &d)
	owner.ok(t, "POST", "/staff/orders/"+id+"/shipments", map[string]any{"version": d.Version, "dispatchQuoteId": d.Review.ID, "idempotencyKey": token()}, &d)
	assertConflict("/own-courier", map[string]any{"version": d.Version, "courierId": courierID})
	a.ShippingProvider = carrier.Disabled{}
	if err := a.ProcessShipments(ctx); err != nil {
		t.Fatal(err)
	}
	owner.ok(t, "GET", "/staff/orders/"+id+"/delivery", nil, &d)
	if d.Status != "unknown" {
		t.Fatal("expected unresolved Snapp booking")
	}
	assertConflict("/own-courier", map[string]any{"version": d.Version, "courierId": courierID})
}

func TestOwnCourierPostalRejectionAndDispatchRace(t *testing.T) {
	_, owner, customer, addr := shippingFixture(t)
	courierID := createTestCourier(t, owner, "پیک فعال", true)
	postalID, _, _ := quoteAndCheckout(t, customer, addr, "post")
	d := prepareShipping(t, customer, owner, postalID)
	if code, _ := owner.call("POST", "/staff/orders/"+postalID+"/own-courier", map[string]any{"version": d.Version, "courierId": courierID}); code != 409 {
		t.Fatal("postal rerouted without consent", code)
	}
	customer.ok(t, "PUT", "/cart/items/turmeric", map[string]any{"packageId": "test500", "quantity": 1}, nil)
	id, _, _ := quoteAndCheckout(t, customer, addr, "")
	d = prepareShipping(t, customer, owner, id)
	owner.ok(t, "POST", "/staff/orders/"+id+"/dispatch-quote", map[string]any{"version": d.Version}, &d)
	var wg sync.WaitGroup
	codes := make(chan int, 2)
	for path, body := range map[string]map[string]any{
		"own-courier": {"version": d.Version, "courierId": courierID},
		"shipments":   {"version": d.Version, "dispatchQuoteId": d.Review.ID, "idempotencyKey": token()},
	} {
		wg.Go(func() { code, _ := owner.call("POST", "/staff/orders/"+id+"/"+path, body); codes <- code })
	}
	wg.Wait()
	close(codes)
	results := []int{}
	for code := range codes {
		results = append(results, code)
	}
	slices.Sort(results)
	if !slices.Equal(results, []int{200, 409}) {
		t.Fatal("both couriers dispatched", results)
	}
}

func TestOwnCourierAfterConfirmedSnappCancellation(t *testing.T) {
	a, owner, customer, addr := shippingFixture(t)
	ctx := context.Background()
	courierID := createTestCourier(t, owner, "پیک جایگزین", true)
	id, _, _ := quoteAndCheckout(t, customer, addr, "")
	d := prepareShipping(t, customer, owner, id)
	owner.ok(t, "POST", "/staff/orders/"+id+"/dispatch-quote", map[string]any{"version": d.Version}, &d)
	owner.ok(t, "POST", "/staff/orders/"+id+"/shipments", map[string]any{"version": d.Version, "dispatchQuoteId": d.Review.ID, "idempotencyKey": token()}, &d)
	if err := a.ProcessShipments(ctx); err != nil {
		t.Fatal(err)
	}
	owner.ok(t, "GET", "/staff/orders/"+id+"/delivery", nil, &d)
	owner.ok(t, "POST", "/staff/orders/"+id+"/shipments/"+d.AttemptID+"/cancel", map[string]any{"version": d.Version, "confirmed": true}, &d)
	if code, _ := owner.call("POST", "/staff/orders/"+id+"/own-courier", map[string]any{"version": d.Version, "courierId": courierID}); code != 409 {
		t.Fatal("unconfirmed cancellation allowed handoff", code)
	}
	if err := a.ProcessShipments(ctx); err != nil {
		t.Fatal(err)
	}
	owner.ok(t, "GET", "/staff/orders/"+id+"/delivery", nil, &d)
	if d.Status != "cancelled" {
		t.Fatal("expected confirmed cancellation", d.Status)
	}
	owner.ok(t, "POST", "/staff/orders/"+id+"/own-courier", map[string]any{"version": d.Version, "courierId": courierID}, &d)
	if d.AssignedCourier == nil || d.DriverName != "" || d.Status != "picked_up" {
		t.Fatalf("courier replacement failed: %+v", d)
	}
	if err := a.ProcessShipments(ctx); err != nil {
		t.Fatal(err)
	}
	owner.ok(t, "GET", "/staff/orders/"+id+"/delivery", nil, &d)
	if d.Status != "picked_up" || d.AssignedCourier == nil {
		t.Fatal("old Snapp booking overwrote internal courier")
	}
}
