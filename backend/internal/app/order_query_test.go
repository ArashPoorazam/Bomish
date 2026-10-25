package app

import (
	"context"
	"fmt"
	"testing"

	"github.com/jackc/pgx/v5"

	"bomish/internal/database"
	"bomish/internal/orderquery"
)

type countedQueries struct {
	database.Querier
	count int
}

func (q *countedQueries) Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error) {
	q.count++
	return q.Querier.Query(ctx, sql, args...)
}
func (q *countedQueries) QueryRow(ctx context.Context, sql string, args ...any) pgx.Row {
	q.count++
	return q.Querier.QueryRow(ctx, sql, args...)
}

func TestOrderPageUsesConstantQueriesAndSafeProjection(t *testing.T) {
	a := setup(t)
	ctx := t.Context()
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := a.Pool.Exec(ctx, sql, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec(`INSERT INTO users(id,phone) VALUES('batch-customer','09123334455'),('other-customer','09123334456')`)
	exec(`INSERT INTO staff(id,username,password_hash,totp_secret,role,full_name,phone) VALUES('batch-courier','batch-courier','unused','unused','courier','پیک بومیش','09123334457')`)
	exec(`INSERT INTO orders(id,user_id,idempotency_key,status,address,subtotal_rials,shipping_rials,total_rials,reservation_expires_at)
 SELECT 'batch-'||n,'batch-customer','batch-'||n,CASE n%4 WHEN 0 THEN 'paid' WHEN 3 THEN 'packing' ELSE 'shipped' END,'{}',1000,0,1000,now() FROM generate_series(0,99) n`)
	exec(`INSERT INTO orders(id,user_id,idempotency_key,status,address,subtotal_rials,shipping_rials,total_rials,reservation_expires_at)
 VALUES('other','other-customer','other','paid','{}',1000,0,1000,now())`)
	exec(`INSERT INTO order_shipping(order_id,method,delivery_status,ready,snapshot,parcels,courier_staff_id,courier_name,courier_phone)
 SELECT 'batch-'||n,CASE n%4 WHEN 0 THEN 'post' ELSE 'snapp' END,CASE WHEN n%4=2 THEN 'picked_up' ELSE 'not_requested' END,true,
 '{"service":"test","carrierQuote":{"simulated":true},"config":{"secret":"must-not-be-exposed"}}',
 '[{"id":"parcel","tracking":"123456789012","actualCostRials":9000,"placements":[{"private":"geometry"}]}]',
 CASE WHEN n%4=2 THEN 'batch-courier' END,CASE WHEN n%4=2 THEN 'پیک بومیش' ELSE '' END,CASE WHEN n%4=2 THEN '09123334457' ELSE '' END
 FROM generate_series(1,99) n`)
	for _, version := range []string{"old", "new"} {
		exec(`INSERT INTO shipment_attempts(id,order_id,idempotency_key,reference,status,request,response,created_at)
 SELECT 'attempt-'||$1||'-'||n,'batch-'||n,$1,'reference-'||$1||'-'||n,'cancelled','{}',
 jsonb_build_object('driverName',$1::text,'driverPhone','۰۹۱۲۳۳۳۴۴۵۸'),
 CASE $1 WHEN 'old' THEN '2026-01-01'::timestamptz ELSE '2026-01-02'::timestamptz END
 FROM generate_series(1,99) n`, version)
	}
	exec(`INSERT INTO delivery_events(order_id,event_key,status,occurred_at)
 SELECT 'batch-'||n,'event-'||n,'picked_up','2026-01-03' FROM generate_series(1,99) n`)
	for _, limit := range []int{1, 100} {
		q := &countedQueries{Querier: a.Pool}
		orders, err := orderquery.Load(ctx, q, orderquery.Filter{CustomerID: "batch-customer", Limit: limit})
		if err != nil {
			t.Fatal(err)
		}
		if len(orders) != limit || q.count != 5 {
			t.Fatalf("page size %d: orders=%d queries=%d", limit, len(orders), q.count)
		}
		for _, o := range orders {
			var n int
			if _, err := fmt.Sscanf(o.ID, "batch-%d", &n); err != nil {
				t.Fatal("other customer's order", o.ID)
			}
			if n == 0 {
				if o.Shipping != nil {
					t.Fatal("fabricated historical delivery")
				}
				continue
			}
			d := o.Shipping
			if d == nil || !d.Simulated || len(d.Events) != 1 {
				t.Fatalf("missing projection: %+v", d)
			}
			switch n % 4 {
			case 0:
				if len(d.Parcels) != 1 || d.Parcels[0].TrackingURL == "" || d.Courier != nil {
					t.Fatalf("post: %+v", d)
				}
			case 1:
				if d.Courier == nil || d.Courier.Name != "new" || d.Courier.Phone != "09123334458" || len(d.Parcels) != 0 {
					t.Fatalf("carrier: %+v", d)
				}
			case 2:
				if d.Method != "own_courier" || d.Courier == nil || d.Courier.Name != "پیک بومیش" {
					t.Fatalf("own courier: %+v", d)
				}
			case 3:
				if d.Courier != nil {
					t.Fatal("courier exposed before handoff")
				}
			}
		}
	}
	q := &countedQueries{Querier: a.Pool}
	orders, err := orderquery.Load(ctx, q, orderquery.Filter{CustomerID: "missing"})
	if err != nil || orders == nil || len(orders) != 0 || q.count != 1 {
		t.Fatalf("empty page: %+v %v queries=%d", orders, err, q.count)
	}
	total, err := orderquery.Count(ctx, a.Pool, orderquery.Filter{CustomerID: "batch-customer"})
	if err != nil || total != 100 {
		t.Fatalf("count: %d %v", total, err)
	}
}
