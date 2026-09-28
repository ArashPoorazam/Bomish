package app

import (
	"bomish/internal/domain"
	"context"
	"testing"
)

func TestOrderPackingChecklist(t *testing.T) {
	a := setup(t)
	ctx := context.Background()
	owner := couponOwner(t, a)
	exec := func(sql string) {
		t.Helper()
		if _, e := a.Pool.Exec(ctx, sql); e != nil {
			t.Fatal(e)
		}
	}
	exec(`INSERT INTO users(id,phone) VALUES('packing-customer','09129991111')`)
	exec(`INSERT INTO orders(id,user_id,idempotency_key,status,address,subtotal_rials,shipping_rials,total_rials,reservation_expires_at) VALUES('packing-order','packing-customer','packing-test','paid','{"recipient":"مشتری آزمایشی"}',300000,0,300000,now())`)
	exec(`INSERT INTO order_items(order_id,product_id,name,grams,price_rials,total_rials,package_id,package_label,quantity) VALUES('packing-order','turmeric','زردچوبه',200,100000,200000,'small','۱۰۰ گرم',2),('packing-order','turmeric','زردچوبه',500,100000,100000,'large','۵۰۰ گرم',1)`)
	patch := map[string]any{"productId": "turmeric", "packageId": "small", "packed": true}
	owner.ok(t, "PATCH", "/staff/orders/packing-order/packing", patch, nil)
	var order domain.Order
	owner.ok(t, "GET", "/staff/orders/packing-order", nil, &order)
	for _, item := range order.Items {
		if item.Packed != (item.PackageID == "small") {
			t.Fatal("checkmark leaked between packages")
		}
	}
	patch["packed"] = false
	owner.ok(t, "PATCH", "/staff/orders/packing-order/packing", patch, nil)
	owner.ok(t, "GET", "/staff/orders/packing-order", nil, &order)
	for _, item := range order.Items {
		if item.Packed {
			t.Fatal("checkmark did not clear")
		}
	}
	patch["packageId"] = "missing"
	if status, _ := owner.call("PATCH", "/staff/orders/packing-order/packing", patch); status != 404 {
		t.Fatalf("unknown package status=%d", status)
	}
	exec(`UPDATE orders SET status='shipped' WHERE id='packing-order'`)
	patch["packageId"] = "small"
	patch["packed"] = true
	if status, _ := owner.call("PATCH", "/staff/orders/packing-order/packing", patch); status != 409 {
		t.Fatalf("shipped order was editable: %d", status)
	}
	visitor := newClient(t, a.Handler())
	if status, _ := visitor.call("GET", "/staff/orders/packing-order", nil); status != 403 {
		t.Fatalf("order leaked: %d", status)
	}
}
