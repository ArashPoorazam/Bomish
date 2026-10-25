package app

import (
	"context"
	"testing"

	"bomish/internal/domain"
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

func TestPackingConfirmationRequiresCompleteChecklist(t *testing.T) {
	a := setup(t)
	staff := couponOwner(t, a)
	ctx := context.Background()
	smsOrder(t, a, "checklist-sms")
	if _, err := a.Pool.Exec(ctx, `INSERT INTO order_items(order_id,product_id,name,grams,price_rials,total_rials,package_id,package_label,quantity) VALUES('checklist-sms','turmeric','زردچوبه',500,0,0,'test500','۵۰۰ گرم',1)`); err != nil {
		t.Fatal(err)
	}
	if status, _ := staff.call("PATCH", "/staff/orders/checklist-sms", map[string]string{"status": "packing"}); status != 409 {
		t.Fatal("incomplete checklist accepted", status)
	}
	var count int
	if err := a.Pool.QueryRow(ctx, "SELECT count(*) FROM jobs WHERE payload->>'orderId'='checklist-sms'").Scan(&count); err != nil || count != 0 {
		t.Fatal(count, err)
	}
	packAllItems(t, staff, "checklist-sms")
	staff.ok(t, "PATCH", "/staff/orders/checklist-sms", map[string]string{"status": "packing"}, nil)
	if status, _ := staff.call("PATCH", "/staff/orders/checklist-sms", map[string]string{"status": "packing"}); status != 409 {
		t.Fatal("repeated confirmation accepted")
	}
	if err := a.Pool.QueryRow(ctx, "SELECT count(*) FROM jobs WHERE payload->>'orderId'='checklist-sms'").Scan(&count); err != nil || count != 1 {
		t.Fatal(count, err)
	}
	staff.ok(t, "PATCH", "/staff/orders/checklist-sms/packing", map[string]any{"productId": "turmeric", "packageId": "test500", "packed": false}, nil)
	if status, _ := staff.call("PATCH", "/staff/orders/checklist-sms", map[string]string{"status": "shipped", "tracking": "12345678901234567890"}); status != 409 {
		t.Fatal("incomplete repacking allowed handoff")
	}
}

func TestSMSWaitsForReopenedPacking(t *testing.T) {
	a := setup(t)
	smsTestConfig(t)
	ctx := context.Background()
	smsOrder(t, a, "reopened-packing")
	if _, err := a.Pool.Exec(ctx, `INSERT INTO order_items(order_id,product_id,name,grams,price_rials,total_rials,package_id,package_label,quantity,packed) VALUES('reopened-packing','turmeric','زردچوبه',500,0,0,'test500','۵۰۰ گرم',1,true)`); err != nil {
		t.Fatal(err)
	}
	smsQueue(t, a, "reopened-packing", "packing")
	if _, err := a.Pool.Exec(ctx, `UPDATE order_items SET packed=false WHERE order_id='reopened-packing'`); err != nil {
		t.Fatal(err)
	}
	job, err := a.claimSMS(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if job.AttemptID != 0 {
		t.Fatal("announced incomplete packing")
	}
	if status, n, reason := smsJobStatus(t, a, "reopened-packing", "packing"); status != "pending" || n != 0 || reason != "awaiting_packing" {
		t.Fatal(status, n, reason)
	}
	if _, err = a.Pool.Exec(ctx, `UPDATE order_items SET packed=true WHERE order_id='reopened-packing'; UPDATE jobs SET available_at=now() WHERE payload->>'orderId'='reopened-packing'`); err != nil {
		t.Fatal(err)
	}
	job, err = a.claimSMS(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if job.AttemptID == 0 {
		t.Fatal("completed packing not claimed")
	}
}
