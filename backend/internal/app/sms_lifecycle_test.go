package app

import (
	"bomish/internal/domain"
	"bomish/internal/packing"
	"bomish/migrations"
	"context"
	"net/http"
	"testing"
)

func TestSMSSnappMilestones(t *testing.T) {
	a, staff, c, addr := shippingFixture(t)
	smsTestConfig(t)
	ctx := context.Background()
	var templates []string
	smsTransport(t, func(r *http.Request) (*http.Response, error) {
		_ = r.ParseForm()
		templates = append(templates, r.Form.Get("template"))
		return smsResponse(smsAccepted), nil
	})
	process := func(want int) {
		t.Helper()
		if err := a.ProcessSMS(ctx); err != nil {
			t.Fatal(err)
		}
		if len(templates) != want {
			t.Fatal(templates)
		}
	}
	id, _, _ := quoteAndCheckout(t, c, addr, "")
	process(0) // Unpaid checkout is not a milestone.
	c.ok(t, "POST", "/orders/"+id+"/simulate", map[string]bool{"success": true}, nil)
	process(1)
	var d deliveryRecord
	staff.ok(t, "GET", "/staff/orders/"+id+"/delivery", nil, &d)
	if status, _ := staff.call("POST", "/staff/orders/"+id+"/ready", map[string]any{"version": d.Version}); status != 409 {
		t.Fatal("incomplete packing accepted")
	}
	process(1)
	d = prepareShipping(t, c, staff, id)
	process(2)
	staff.ok(t, "POST", "/staff/orders/"+id+"/ready", map[string]any{"version": d.Version}, &d)
	process(2) // Reconfirming packing never duplicates the notification.
	staff.ok(t, "POST", "/staff/orders/"+id+"/dispatch-quote", map[string]any{"version": d.Version}, &d)
	staff.ok(t, "POST", "/staff/orders/"+id+"/shipments", map[string]any{"version": d.Version, "dispatchQuoteId": d.Review.ID, "idempotencyKey": token()}, &d)
	if err := a.ProcessShipments(ctx); err != nil {
		t.Fatal(err)
	}
	process(2)
	staff.ok(t, "POST", "/staff/orders/"+id+"/shipments/simulate", map[string]string{"status": "accepted"}, &d)
	process(2)
	for _, status := range []string{"picked_up", "delivered"} {
		staff.ok(t, "POST", "/staff/orders/"+id+"/shipments/simulate", map[string]string{"status": status}, &d)
		if err := a.ProcessSMS(ctx); err != nil {
			t.Fatal(err)
		}
	}
	if len(templates) != 4 || templates[0] != "bomish-paid" || templates[1] != "bomish-packed" || templates[2] != "bomish-snapp" || templates[3] != "bomish-delivered" {
		t.Fatal(templates)
	}
	var result struct {
		Order domain.Order `json:"order"`
	}
	c.ok(t, "GET", "/orders/"+id, nil, &result)
	if result.Order.Shipping.Status != "delivered" {
		t.Fatal("customer progress missing")
	}
}

func TestSMSMultiplePostalParcels(t *testing.T) {
	a, staff, c, addr := shippingFixture(t)
	smsTestConfig(t)
	ctx := context.Background()
	var cfg shippingConfig
	staff.ok(t, "GET", "/staff/shipping", nil, &cfg)
	cfg.Boxes[0].Inside = packing.Size{Length: 90, Width: 90, Height: 110}
	cfg.Boxes[0].Outside = packing.Size{Length: 100, Width: 100, Height: 120}
	staff.ok(t, "PUT", "/staff/shipping", cfg, nil)
	id, _, _ := quoteAndCheckout(t, c, addr, "post")
	d := prepareShipping(t, c, staff, id)
	if len(d.Parcels) != 2 {
		t.Fatal("expected two parcels")
	}
	smsTransport(t, func(r *http.Request) (*http.Response, error) {
		_ = r.ParseForm()
		if r.Form.Get("template") != "bomish-post" || r.Form.Get("token") != id {
			t.Fatal("wrong shipment template/token")
		}
		return smsResponse(smsAccepted), nil
	})
	for i, code := range []string{"12345678901", "12345678902"} {
		staff.ok(t, "PATCH", "/staff/orders/"+id+"/parcels/"+d.Parcels[i].ID, map[string]any{"version": d.Version, "tracking": code}, &d)
	}
	staff.ok(t, "PATCH", "/staff/orders/"+id, map[string]string{"status": "shipped"}, nil)
	if err := a.ProcessSMS(ctx); err != nil {
		t.Fatal(err)
	}
	if status, n, _ := smsJobStatus(t, a, id, "shipped"); status != "accepted" || n != 1 {
		t.Fatal(status, n)
	}
	var result struct {
		Order domain.Order `json:"order"`
	}
	c.ok(t, "GET", "/orders/"+id, nil, &result)
	if len(result.Order.Shipping.Parcels) != 2 {
		t.Fatal("missing parcel")
	}
	for _, p := range result.Order.Shipping.Parcels {
		if p.TrackingURL == "" {
			t.Fatal("missing tracking link")
		}
	}
}

func TestSMSMigrationExcludesOldBacklog(t *testing.T) {
	a := setup(t)
	ctx := context.Background()
	tx, err := a.Pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	_, err = tx.Exec(ctx, `DROP TABLE sms_attempts;
 ALTER TABLE jobs DROP COLUMN created_at, DROP COLUMN last_error, DROP COLUMN started_at;
 INSERT INTO jobs(kind,payload,status) VALUES
 ('order_sms','{"orderId":"old-pending","stage":"paid"}','pending'),
 ('order_sms','{"orderId":"old-sent","stage":"paid"}','sent'),
 ('export','{}','pending');`)
	if err != nil {
		t.Fatal(err)
	}
	migration, err := migrations.Files.ReadFile("014_sms_delivery.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = tx.Exec(ctx, string(migration)); err != nil {
		t.Fatal(err)
	}
	var skipped, accepted, exports int
	if err = tx.QueryRow(ctx, `SELECT count(*) FILTER(WHERE kind='order_sms' AND status='skipped' AND last_error='pre_activation'),count(*) FILTER(WHERE kind='order_sms' AND status='accepted'),count(*) FILTER(WHERE kind='export' AND status='pending') FROM jobs`).Scan(&skipped, &accepted, &exports); err != nil {
		t.Fatal(err)
	}
	if skipped != 1 || accepted != 1 || exports != 1 {
		t.Fatal(skipped, accepted, exports)
	}
}
