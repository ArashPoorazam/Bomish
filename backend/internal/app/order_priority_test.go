package app

import (
	"bomish/internal/domain"
	"context"
	"testing"
)

func TestStaffOrderPriorityBeforePagination(t *testing.T) {
	a := setup(t)
	ctx := context.Background()
	if _, err := a.Pool.Exec(ctx, `INSERT INTO users(id,phone) VALUES('priority-customer','09127770001')`); err != nil {
		t.Fatal(err)
	}
	for i, status := range []string{"paid", "packing", "review", "pending", "shipped", "received"} {
		if _, err := a.Pool.Exec(ctx, `INSERT INTO orders(id,user_id,idempotency_key,status,address,subtotal_rials,shipping_rials,total_rials,reservation_expires_at,created_at) VALUES($1,'priority-customer',$1,$2,'{}',1000,0,1000,now(), '2026-01-01'::timestamptz + $3 * interval '1 day')`, "priority-"+status, status, i); err != nil {
			t.Fatal(err)
		}
	}
	owner := couponOwner(t, a)
	var result struct {
		Items []domain.Order `json:"items"`
		Total int            `json:"total"`
	}
	owner.ok(t, "GET", "/staff/orders?status=active&page=1&pageSize=2&q=priority-", nil, &result)
	if result.Total != 4 || len(result.Items) != 2 || result.Items[0].Status != "review" || result.Items[1].Status != "packing" {
		t.Fatalf("action orders missing from first page: %+v", result)
	}
	owner.ok(t, "GET", "/staff/orders?status=active&page=2&pageSize=2&q=priority-", nil, &result)
	if len(result.Items) != 2 || result.Items[0].Status != "paid" || result.Items[1].Status != "shipped" {
		t.Fatalf("shipped order did not move below action orders: %+v", result)
	}
	// A just-shipped order must leave the action group immediately.
	if _, err := a.Pool.Exec(ctx, `UPDATE orders SET status='shipped' WHERE id='priority-review'`); err != nil {
		t.Fatal(err)
	}
	owner.ok(t, "GET", "/staff/orders?status=active&page=1&pageSize=2&q=priority-", nil, &result)
	if result.Items[0].Status != "packing" || result.Items[1].Status != "paid" {
		t.Fatalf("shipment did not reorder queue: %+v", result)
	}
	customer, err := loadOrderPage(ctx, a.Pool, "priority-customer", "", "", "", 20, 0)
	if err != nil {
		t.Fatal(err)
	}
	if customer[0].Status != "received" || customer[1].Status != "shipped" {
		t.Fatal("customer chronological history changed")
	}
}
