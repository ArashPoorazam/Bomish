package app

import (
	"context"
	"testing"

	"bomish/internal/security"
)

func TestCustomerCancelOrder(t *testing.T) {
	a := setup(t)
	ctx := context.Background()
	c := newClient(t, a.Handler())
	c.login(t, "09123334444")
	other := newClient(t, a.Handler())
	other.login(t, "09123334445")
	for _, status := range []string{"pending", "paid", "packing", "review", "shipped", "received", "expired"} {
		_, err := a.Pool.Exec(ctx, `INSERT INTO orders(id,user_id,idempotency_key,status,address,subtotal_rials,shipping_rials,total_rials,reservation_expires_at) SELECT $1,id,$1,$1,'{}',1000,0,1000,now() FROM users WHERE phone='09123334444'`, status)
		if err != nil {
			t.Fatal(err)
		}
		if code, _ := other.call("POST", "/orders/"+status+"/cancel", map[string]any{}); code != 404 {
			t.Fatalf("foreign cancellation: %d", code)
		}
		code, raw := c.call("POST", "/orders/"+status+"/cancel", map[string]any{})
		expected := 200
		if status == "shipped" || status == "received" || status == "expired" {
			expected = 409
		}
		if code != expected {
			t.Fatalf("cancel %s: %d %s", status, code, raw)
		}
		var got string
		if err = a.Pool.QueryRow(ctx, "SELECT status FROM orders WHERE id=$1", status).Scan(&got); err != nil {
			t.Fatal(err)
		}
		if expected == 200 {
			if got != "cancelled" {
				t.Fatal(got)
			}
			c.ok(t, "POST", "/orders/"+status+"/cancel", map[string]any{}, nil)
		} else if got != status {
			t.Fatal(got)
		}
	}
}

func TestStaffChangeOwnPassword(t *testing.T) {
	a := setup(t)
	c := newClient(t, a.Handler())
	c.staff(t, "editor")
	other := newClient(t, a.Handler())
	other.staff(t, "editor")
	for _, body := range []map[string]string{
		{"currentPassword": "wrong", "newPassword": "new-password-long-123"},
		{"currentPassword": DemoPassword, "newPassword": "short"},
		{"currentPassword": DemoPassword, "newPassword": DemoPassword},
	} {
		if code, _ := c.call("POST", "/staff/password", body); code != 400 {
			t.Fatalf("invalid password change: %d", code)
		}
	}
	c.ok(t, "POST", "/staff/password", map[string]string{"currentPassword": DemoPassword, "newPassword": "new-password-long-123"}, nil)
	c.ok(t, "GET", "/staff/products", nil, nil)
	if code, _ := other.call("GET", "/staff/products", nil); code != 401 {
		t.Fatalf("other session survived: %d", code)
	}
	fresh := newClient(t, a.Handler())
	var s struct {
		CSRF string `json:"csrf"`
	}
	fresh.ok(t, "GET", "/session?workspace=staff", nil, &s)
	fresh.csrf = s.CSRF
	if code, _ := fresh.call("POST", "/staff/login", map[string]string{"username": "editor", "password": DemoPassword}); code != 401 {
		t.Fatalf("old password accepted: %d", code)
	}
	fresh.ok(t, "POST", "/staff/login", map[string]string{"username": "editor", "password": "new-password-long-123"}, nil)
}

func TestCustomerCancelAssignedCourier(t *testing.T) {
	a, owner, c, addr := shippingFixture(t)
	id, _, _ := quoteAndCheckout(t, c, addr, "")
	d := prepareShipping(t, c, owner, id)
	owner.ok(t, "POST", "/staff/orders/"+id+"/dispatch-quote", map[string]any{"version": d.Version}, &d)
	owner.ok(t, "POST", "/staff/orders/"+id+"/shipments", map[string]any{"version": d.Version, "dispatchQuoteId": d.Review.ID, "idempotencyKey": security.Token()}, &d)
	if err := a.ProcessShipments(context.Background()); err != nil {
		t.Fatal(err)
	}
	c.ok(t, "POST", "/orders/"+id+"/cancel", map[string]any{}, nil)
	var status string
	if err := a.Pool.QueryRow(context.Background(), "SELECT status FROM orders WHERE id=$1", id).Scan(&status); err != nil || status != "cancelled" {
		t.Fatal(status, err)
	}
	owner.ok(t, "GET", "/staff/orders/"+id+"/delivery", nil, &d)
	if d.Status != "cancelled" || d.Ready {
		t.Fatal("delivery still active", d)
	}
	var carrierStatus string
	if err := a.Pool.QueryRow(context.Background(), "SELECT status FROM simulated_shipments WHERE reference=(SELECT reference FROM shipment_attempts WHERE order_id=$1)", id).Scan(&carrierStatus); err != nil || carrierStatus != "cancelled" {
		t.Fatal(carrierStatus, err)
	}
	if code, _ := owner.call("POST", "/staff/orders/"+id+"/ready", map[string]any{"version": d.Version}); code != 409 {
		t.Fatalf("cancelled order prepared again: %d", code)
	}
}

func TestStaffSessionAccountIdentity(t *testing.T) {
	a := setup(t)
	staff, id := testStaff(t, a, "editor", nil)
	var account map[string]any
	staff.ok(t, "GET", "/session?workspace=staff", nil, &account)
	if account["username"] != id || account["fullName"] != "آزمایش" {
		t.Fatalf("incorrect account identity: %v", account)
	}
	for _, key := range []string{"password", "passwordHash", "password_hash", "totpSecret"} {
		if _, exists := account[key]; exists {
			t.Fatalf("session exposed %s", key)
		}
	}
	var customer map[string]any
	staff.ok(t, "GET", "/session", nil, &customer)
	if customer["username"] != "" || customer["fullName"] != "" {
		t.Fatal("staff identity leaked into customer session")
	}
}
