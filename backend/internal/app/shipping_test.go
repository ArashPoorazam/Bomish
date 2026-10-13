package app

import (
	"bomish/internal/carrier"
	"bomish/internal/domain"
	"bomish/internal/packing"
	"context"
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func shippingFixture(t *testing.T) (*App, *client, *client, domain.Address) {
	t.Helper()
	t.Setenv("SHIPPING_SIMULATED", "true")
	a := setup(t)
	owner := couponOwner(t, a)
	c := newClient(t, a.Handler())
	c.login(t, "09121110001")
	ctx := context.Background()
	_, e := a.Pool.Exec(ctx, `UPDATE products SET content=jsonb_set(content,'{packages}',(SELECT jsonb_agg(p || jsonb_build_object('lengthMm',80,'widthMm',80,'heightMm',100,'shippingGrams',CASE WHEN p->>'unit'='kg' THEN ceil((p->>'amount')::numeric*1000)+100 WHEN p->>'unit'='g' THEN ceil((p->>'amount')::numeric)+100 ELSE 1500 END,'shippingVerified',true)) FROM jsonb_array_elements(content->'packages') p))`)
	if e != nil {
		t.Fatal(e)
	}
	lat, lng := 35.7, 51.4
	addr := domain.Address{Recipient: "آزمایش ارسال", Phone: "09121110001", Province: "تهران", City: "تهران", ProvinceID: "tehran-province", CityID: "tehran-city", Street: "خیابان آزمایشی، پلاک یک", PostalCode: "1234567890", Latitude: &lat, Longitude: &lng, PinConfirmed: true}
	var cfg shippingConfig
	owner.ok(t, "GET", "/staff/shipping", nil, &cfg)
	cfg.Mode = "calculated"
	cfg.Origin = addr
	cfg.Localities = []locality{{ID: addr.CityID, ProvinceID: addr.ProvinceID, Province: addr.Province, City: addr.City, TapinCity: "1", TapinProvince: "1", Verified: true}, {ID: "karaj-city", ProvinceID: "alborz-province", Province: "البرز", City: "کرج", TapinCity: "2", TapinProvince: "2", Verified: true}}
	cfg.Boxes = []packing.Box{{ID: "box-1", Name: "کارتن آزمایش", Inside: packing.Size{Length: 200, Width: 200, Height: 200}, Outside: packing.Size{Length: 210, Width: 210, Height: 210}, EmptyGrams: 100, FillerGrams: 20, MaxGrams: 10000, InsetMm: 5, PostalSizeID: "1", Active: true, Verified: true}}
	cfg.Snapp = providerConfig{Enabled: true, Service: "sim-bike", Currency: "rial", Verified: true, CityID: addr.CityID, Area: [][2]float64{{35, 51}, {36, 51}, {36, 52}, {35, 52}}, MaxGrams: 10000, MaxVolumeCm3: 100000, MaxParcels: 4, MaxSize: packing.Size{Length: 500, Width: 500, Height: 500}}
	cfg.Tapin = providerConfig{Enabled: true, Service: "0", ShopID: "sim-shop", Currency: "rial", Verified: true, MaxGrams: 10000, MaxSize: packing.Size{Length: 1000, Width: 1000, Height: 1000}}
	// Save merchant fields first, then activate the file-owned technical setup.
	owner.ok(t, "PUT", "/staff/shipping", cfg, nil)
	applyTechnicalFixture(t, a, cfg)

	c.ok(t, "PUT", "/cart/items/turmeric", map[string]any{"packageId": "test500", "quantity": 2}, nil)
	return a, owner, c, addr
}
func quoteAndCheckout(t *testing.T, c *client, addr domain.Address, method string) (string, quoteResult, map[string]any) {
	t.Helper()
	var q quoteResult
	c.ok(t, "POST", "/checkout/quote", shippingQuoteInput{Address: addr, Method: method}, &q)
	if q.RequiresAcceptance {
		c.ok(t, "POST", "/checkout/quote", shippingQuoteInput{Address: addr, Method: "post", AcceptFallback: true, AcceptedQuoteID: q.ShippingQuoteID}, &q)
	}
	body := map[string]any{"address": addr, "shippingQuoteId": q.ShippingQuoteID, "method": q.Method, "expectedTotalRials": q.TotalRials, "idempotencyKey": token()}
	var result map[string]string
	c.ok(t, "POST", "/checkout", body, &result)
	return result["orderId"], q, body
}
func prepareShipping(t *testing.T, c, staff *client, id string) deliveryRecord {
	t.Helper()
	c.ok(t, "POST", "/orders/"+id+"/simulate", map[string]bool{"success": true}, nil)
	var order domain.Order
	staff.ok(t, "GET", "/staff/orders/"+id, nil, &order)
	for _, item := range order.Items {
		staff.ok(t, "PATCH", "/staff/orders/"+id+"/packing", map[string]any{"productId": item.ProductID, "packageId": item.PackageID, "packed": true}, nil)
	}
	var d deliveryRecord
	staff.ok(t, "GET", "/staff/orders/"+id+"/delivery", nil, &d)
	for i := range d.Parcels {
		d.Parcels[i].Confirmed = true
		d.Parcels[i].MeasuredGrams = d.Parcels[i].GrossGrams
	}
	staff.ok(t, "PUT", "/staff/orders/"+id+"/parcels", map[string]any{"version": d.Version, "parcels": d.Parcels, "reason": "physical packing verified"}, &d)
	staff.ok(t, "POST", "/staff/orders/"+id+"/ready", map[string]any{"version": d.Version}, &d)
	return d
}
func TestCalculatedShippingLifecycle(t *testing.T) {
	a, owner, c, addr := shippingFixture(t)
	ctx := context.Background()
	id, q, body := quoteAndCheckout(t, c, addr, "")
	var d deliveryRecord
	owner.ok(t, "GET", "/staff/orders/"+id+"/delivery", nil, &d)
	if code, _ := owner.call("POST", "/staff/orders/"+id+"/ready", map[string]any{"version": d.Version}); code != 409 {
		t.Fatal("unpaid readiness", code)
	}
	d = prepareShipping(t, c, owner, id)
	owner.ok(t, "POST", "/staff/orders/"+id+"/dispatch-quote", map[string]any{"version": d.Version}, &d)
	book := map[string]any{"version": d.Version, "dispatchQuoteId": d.Review.ID, "idempotencyKey": token()}
	owner.ok(t, "POST", "/staff/orders/"+id+"/shipments", book, &d)
	owner.ok(t, "POST", "/staff/orders/"+id+"/shipments", book, &d)
	var count int
	if e := a.ProcessShipments(ctx); e != nil {
		t.Fatal(e)
	}
	a.Pool.QueryRow(ctx, "SELECT count(*) FROM simulated_shipments").Scan(&count)
	if count != 1 {
		t.Fatal("duplicate booking", count)
	}
	owner.ok(t, "GET", "/staff/orders/"+id+"/delivery", nil, &d)
	if d.Status != "awaiting_courier" {
		t.Fatal(d.Status)
	}
	if code, _ := owner.call("PUT", "/staff/orders/"+id+"/parcels", map[string]any{"version": d.Version, "parcels": d.Parcels, "reason": "illegal"}); code != 409 {
		t.Fatal("active packing editable")
	}
	owner.ok(t, "POST", "/staff/orders/"+id+"/shipments/simulate", map[string]string{"status": "delivered"}, &d)
	if d.Status != "delivered" {
		t.Fatal("delivery not applied", d.Status)
	}
	if _, e := a.Pool.Exec(ctx, `UPDATE shipment_attempts SET response=response || '{"driverName":"پیک آزمایشی","driverPhone":"09121110002"}'::jsonb WHERE order_id=$1`, id); e != nil {
		t.Fatal(e)
	}
	owner.ok(t, "GET", "/staff/orders/"+id+"/delivery", nil, &d)
	if d.DriverName != "پیک آزمایشی" || d.DriverPhone != "09121110002" {
		t.Fatal("provider driver details missing from staff view")
	}
	a.Pool.Exec(ctx, "UPDATE shipping_quotes SET expires_at=now()-interval '1 hour' WHERE id=$1", q.ShippingQuoteID)
	var retry map[string]string
	c.ok(t, "POST", "/checkout", body, &retry)
	if retry["orderId"] != id {
		t.Fatal("expired idempotent retry")
	}
	var result struct {
		Order       domain.Order `json:"order"`
		TrackingURL string       `json:"trackingUrl"`
	}
	c.ok(t, "GET", "/orders/"+id, nil, &result)
	if result.Order.Status != "received" || result.TrackingURL != "" || result.Order.TotalRials != q.TotalRials {
		t.Fatal("customer status/total/tracking", result)
	}
	_, raw := c.call("GET", "/orders/"+id, nil)
	for _, secret := range []string{"actualCostRials", "carrierQuote", "driverPhone", "origin", "allowedActions"} {
		if strings.Contains(string(raw), secret) {
			t.Fatal("staff data leaked", secret)
		}
	}
	a.Pool.QueryRow(ctx, "SELECT count(*) FROM jobs WHERE kind='order_sms' AND payload->>'orderId'=$1", id).Scan(&count)
	if count != 4 {
		t.Fatal("milestone duplication", count)
	}
}
func TestCalculatedQuoteBindingsAndFallback(t *testing.T) {
	a, owner, c, addr := shippingFixture(t)
	var q quoteResult
	addr.PinConfirmed = false
	c.ok(t, "POST", "/checkout/quote", shippingQuoteInput{Address: addr}, &q)
	if q.Method != "post" || !q.RequiresAcceptance {
		t.Fatal("missing pin did not require fallback", q)
	}
	body := map[string]any{"address": addr, "shippingQuoteId": q.ShippingQuoteID, "method": "post", "expectedTotalRials": q.TotalRials, "idempotencyKey": token()}
	if code, _ := c.call("POST", "/checkout", body); code != 409 {
		t.Fatal("fallback not accepted", code)
	}
	addr.PinConfirmed = true
	c.ok(t, "POST", "/checkout/quote", shippingQuoteInput{Address: addr}, &q)
	body["address"] = addr
	body["shippingQuoteId"] = q.ShippingQuoteID
	body["method"] = q.Method
	body["expectedTotalRials"] = q.TotalRials
	other := newClient(t, a.Handler())
	other.login(t, "09121110002")
	if code, _ := other.call("POST", "/checkout", body); code != 409 {
		t.Fatal("quote ownership", code)
	}
	changed := addr
	changed.Street += " واحد دو"
	body["address"] = changed
	if code, _ := c.call("POST", "/checkout", body); code != 409 {
		t.Fatal("changed destination", code)
	}
	body["address"] = addr
	body["expectedTotalRials"] = q.TotalRials - 10
	if code, _ := c.call("POST", "/checkout", body); code != 409 {
		t.Fatal("forged fee", code)
	}
	body["expectedTotalRials"] = q.TotalRials
	var cfg shippingConfig
	owner.ok(t, "GET", "/staff/shipping", nil, &cfg)
	owner.ok(t, "PUT", "/staff/shipping", cfg, nil)
	if code, _ := owner.call("PUT", "/staff/shipping", cfg); code != 409 {
		t.Fatal("config lost update")
	}
	if code, _ := c.call("POST", "/checkout", body); code != 409 {
		t.Fatal("config stale quote", code)
	}
	c.ok(t, "POST", "/checkout/quote", shippingQuoteInput{Address: addr}, &q)
	a.Pool.Exec(context.Background(), "UPDATE shipping_quotes SET expires_at=now()-interval '1 second' WHERE id=$1", q.ShippingQuoteID)
	body["shippingQuoteId"] = q.ShippingQuoteID
	if code, _ := c.call("POST", "/checkout", body); code != 409 {
		t.Fatal("expired quote", code)
	}
}

type uncertainCourier struct {
	base    carrier.Courier
	creates atomic.Int32
}

func (f *uncertainCourier) Quote(c context.Context, r carrier.Request) (carrier.Quote, error) {
	return f.base.Quote(c, r)
}
func (f *uncertainCourier) Create(c context.Context, r carrier.Request) (carrier.Booking, error) {
	f.creates.Add(1)
	b, e := f.base.Create(c, r)
	if e != nil {
		return b, e
	}
	return b, carrier.ErrUnknown
}
func (f *uncertainCourier) Lookup(c context.Context, r string) (carrier.Booking, error) {
	return f.base.Lookup(c, r)
}
func (f *uncertainCourier) Cancel(c context.Context, r string) (carrier.Booking, error) {
	return f.base.Cancel(c, r)
}
func TestShippingUnknownReconciliationAndCancellation(t *testing.T) {
	a, owner, c, addr := shippingFixture(t)
	fake := &uncertainCourier{base: simulation{a: a, method: "snapp"}}
	a.ShippingProvider = fake
	id, _, _ := quoteAndCheckout(t, c, addr, "")
	d := prepareShipping(t, c, owner, id)
	owner.ok(t, "POST", "/staff/orders/"+id+"/dispatch-quote", map[string]any{"version": d.Version}, &d)
	owner.ok(t, "POST", "/staff/orders/"+id+"/shipments", map[string]any{"version": d.Version, "dispatchQuoteId": d.Review.ID, "idempotencyKey": token()}, &d)
	ctx := context.Background()
	var wg sync.WaitGroup
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if e := a.ProcessShipments(ctx); e != nil {
				t.Error(e)
			}
		}()
	}
	wg.Wait()
	owner.ok(t, "GET", "/staff/orders/"+id+"/delivery", nil, &d)
	if d.Status != "unknown" || fake.creates.Load() != 1 {
		t.Fatal("unknown creation", d.Status, fake.creates.Load())
	}
	owner.ok(t, "POST", "/staff/orders/"+id+"/shipments/refresh", map[string]any{}, &d)
	if d.Status != "awaiting_courier" || fake.creates.Load() != 1 {
		t.Fatal("lookup retried creation")
	}
	owner.ok(t, "POST", "/staff/orders/"+id+"/shipments/"+d.AttemptID+"/cancel", map[string]any{"version": d.Version, "confirmed": true}, &d)
	if e := a.ProcessShipments(ctx); e != nil {
		t.Fatal(e)
	}
	owner.ok(t, "GET", "/staff/orders/"+id+"/delivery", nil, &d)
	if d.Status != "cancelled" {
		t.Fatal("cancellation", d.Status)
	}
	owner.ok(t, "POST", "/staff/orders/"+id+"/dispatch-quote", map[string]any{"version": d.Version}, &d)
	owner.ok(t, "POST", "/staff/orders/"+id+"/shipments", map[string]any{"version": d.Version, "dispatchQuoteId": d.Review.ID, "idempotencyKey": token()}, &d)
	if e := a.ProcessShipments(ctx); e != nil {
		t.Fatal(e)
	}
	var count int
	a.Pool.QueryRow(ctx, "SELECT count(DISTINCT reference) FROM shipment_attempts WHERE order_id=$1", id).Scan(&count)
	if count != 2 {
		t.Fatal("reference reused")
	}
}
func TestShippingWebhookHintsAndStateOrdering(t *testing.T) {
	if nextDeliveryState("delivered", "picked_up") != "delivered" || nextDeliveryState("picked_up", "accepted") != "picked_up" || nextDeliveryState("accepted", "allocation_cancelled") != "accepted" {
		t.Fatal("status regression")
	}
	a, owner, c, addr := shippingFixture(t)
	id, _, _ := quoteAndCheckout(t, c, addr, "")
	d := prepareShipping(t, c, owner, id)
	owner.ok(t, "POST", "/staff/orders/"+id+"/dispatch-quote", map[string]any{"version": d.Version}, &d)
	owner.ok(t, "POST", "/staff/orders/"+id+"/shipments", map[string]any{"version": d.Version, "dispatchQuoteId": d.Review.ID, "idempotencyKey": token()}, &d)
	if e := a.ProcessShipments(context.Background()); e != nil {
		t.Fatal(e)
	}
	var ref string
	a.Pool.QueryRow(context.Background(), "SELECT reference FROM shipment_attempts WHERE order_id=$1", id).Scan(&ref)
	payload, _ := json.Marshal(map[string]any{"reference": ref, "eventId": "event-1", "occurredAt": time.Now()})
	for i := 0; i < 2; i++ {
		w := httptest.NewRecorder()
		r := httptest.NewRequest("POST", "/api/v1/webhooks/snapp", strings.NewReader(string(payload)))
		a.Handler().ServeHTTP(w, r)
		if w.Code != 202 {
			t.Fatal(w.Code, w.Body.String())
		}
	}
	var count int
	a.Pool.QueryRow(context.Background(), "SELECT count(*) FROM shipping_webhooks").Scan(&count)
	if count != 1 {
		t.Fatal("duplicate webhook")
	}
	owner.ok(t, "GET", "/staff/orders/"+id+"/delivery", nil, &d)
	if d.Status != "awaiting_courier" {
		t.Fatal("callback changed status without lookup")
	}
}

func TestPostalParcelsAndMethodPermissions(t *testing.T) {
	a, owner, c, addr := shippingFixture(t)
	ctx := context.Background()
	var cfg shippingConfig
	owner.ok(t, "GET", "/staff/shipping", nil, &cfg)
	cfg.Boxes[0].Inside = packing.Size{Length: 90, Width: 90, Height: 110}
	cfg.Boxes[0].Outside = packing.Size{Length: 100, Width: 100, Height: 120}
	owner.ok(t, "PUT", "/staff/shipping", cfg, nil)
	id, quote, _ := quoteAndCheckout(t, c, addr, "post")
	d := prepareShipping(t, c, owner, id)
	if len(d.Parcels) != 2 {
		t.Fatal("multi-parcel expected")
	}
	if code, _ := owner.call("PATCH", "/staff/orders/"+id, map[string]string{"status": "shipped"}); code != 409 {
		t.Fatal("missing barcodes allowed", code)
	}
	zero := int64(0)
	owner.ok(t, "PATCH", "/staff/orders/"+id+"/parcels/"+d.Parcels[0].ID, map[string]any{"version": d.Version, "tracking": "12345678901", "actualCostRials": &zero}, &d)
	if d.ActualCostRials != nil {
		t.Fatal("unknown cost became zero")
	}
	if code, _ := owner.call("PATCH", "/staff/orders/"+id+"/parcels/"+d.Parcels[1].ID, map[string]any{"version": d.Version, "tracking": "12345678901"}); code != 409 {
		t.Fatal("duplicate barcode accepted")
	}
	owner.ok(t, "PATCH", "/staff/orders/"+id+"/parcels/"+d.Parcels[1].ID, map[string]any{"version": d.Version, "tracking": "12345678902", "actualCostRials": &zero}, &d)
	if d.ActualCostRials == nil || *d.ActualCostRials != 0 {
		t.Fatal("genuine zero lost")
	}
	owner.ok(t, "PATCH", "/staff/orders/"+id, map[string]string{"status": "shipped"}, nil)
	owner.ok(t, "PATCH", "/staff/orders/"+id, map[string]string{"status": "received"}, nil)
	var total int64
	a.Pool.QueryRow(ctx, "SELECT total_rials FROM orders WHERE id=$1", id).Scan(&total)
	if total != quote.TotalRials {
		t.Fatal("invoice changed")
	}
	operator := newClient(t, a.Handler())
	operator.staff(t, "operator")
	if code, _ := operator.call("PUT", "/staff/shipping", cfg); code != 403 {
		t.Fatal("operator configured shipping")
	}
	if code, _ := operator.call("POST", "/staff/orders/"+id+"/delivery-method", map[string]any{}); code != 403 {
		t.Fatal("operator changed method")
	}
	var customer struct {
		Order domain.Order `json:"order"`
	}
	c.ok(t, "GET", "/orders/"+id, nil, &customer)
	if len(customer.Order.Shipping.Parcels) != 2 || customer.Order.Shipping.Parcels[1].TrackingURL == "" {
		t.Fatal("postal links absent")
	}
}
func TestShippingFreeStillRequiresServiceAndMeasurements(t *testing.T) {
	a, owner, c, addr := shippingFixture(t)
	var cfg shippingConfig
	owner.ok(t, "GET", "/staff/shipping", nil, &cfg)
	cfg.FreeShippingRials = 1
	owner.ok(t, "PUT", "/staff/shipping", cfg, nil)
	var q quoteResult
	c.ok(t, "POST", "/checkout/quote", shippingQuoteInput{Address: addr}, &q)
	if q.ShippingRials != 0 || q.ShippingQuoteID == "" {
		t.Fatal("free shipping lost quote")
	}
	a.ShippingProvider = carrier.Disabled{}
	if code, _ := c.call("POST", "/checkout/quote", shippingQuoteInput{Address: addr}); code != 422 {
		t.Fatal("outage became free shipping", code)
	}
	a.ShippingProvider = nil
	_, e := a.Pool.Exec(context.Background(), `UPDATE products SET content=jsonb_set(content,'{packages,0,lengthMm}','0') WHERE id='turmeric'`)
	if e != nil {
		t.Fatal(e)
	}
	if code, _ := c.call("POST", "/checkout/quote", shippingQuoteInput{Address: addr}); code != 422 {
		t.Fatal("missing dimensions silently used legacy", code)
	}
	var list struct {
		Total int `json:"total"`
	}
	owner.ok(t, "GET", "/staff/products?page=1&shippingIncomplete=true", nil, &list)
	if list.Total != 1 {
		t.Fatal("published completeness filter", list.Total)
	}
}

func TestShippingMeasurementDraftPublicationAndRollback(t *testing.T) {
	a, owner, c, addr := shippingFixture(t)
	var p domain.Product
	c.ok(t, "GET", "/products/turmeric", nil, &p)
	p.Packages[0].HeightMm = 0
	owner.ok(t, "PUT", "/staff/products/turmeric", p, nil)
	var drafts []domain.Product
	owner.ok(t, "GET", "/staff/products?q=turmeric", nil, &drafts)
	if len(drafts) != 1 || drafts[0].Packages[0].HeightMm != 0 || !drafts[0].PublishedShippingReady {
		t.Fatal("draft or published readiness lost", drafts)
	}
	if code, _ := owner.call("POST", "/staff/products/turmeric/publish", nil); code != 422 {
		t.Fatal("incomplete calculated publication", code)
	}
	var q quoteResult
	c.ok(t, "POST", "/checkout/quote", shippingQuoteInput{Address: addr}, &q)
	id, _, body := quoteAndCheckout(t, c, addr, "")
	var cfg shippingConfig
	owner.ok(t, "GET", "/staff/shipping", nil, &cfg)
	cfg.Mode = "legacy"
	applyTechnicalFixture(t, a, cfg)
	owner.ok(t, "POST", "/staff/products/turmeric/publish", nil, nil)
	var retry map[string]string
	c.ok(t, "POST", "/checkout", body, &retry)
	if retry["orderId"] != id {
		t.Fatal("rollback changed pending order")
	}
	c.ok(t, "PUT", "/cart/items/turmeric", map[string]any{"packageId": "test500", "quantity": 1}, nil)
	if code, raw := c.call("POST", "/checkout", map[string]any{"address": addr, "shippingQuoteId": q.ShippingQuoteID, "expectedTotalRials": q.TotalRials, "idempotencyKey": token()}); code != 409 || !strings.Contains(string(raw), "stale_quote") {
		t.Fatalf("rollback reused calculated quote: %d %s", code, raw)
	}
	var d deliveryRecord
	owner.ok(t, "GET", "/staff/orders/"+id+"/delivery", nil, &d)
	if d.Method != "snapp" {
		t.Fatal("rollback changed historical method")
	}
	_ = a
}

func TestShippingCheckPersistenceAndEnvironmentIsolation(t *testing.T) {
	a, owner, _, _ := shippingFixture(t)
	var health providerHealth
	owner.ok(t, "POST", "/staff/shipping/providers/snapp/check", nil, &health)
	if health.LastSuccess == "" || !health.Simulated {
		t.Fatal("missing simulated check result", health)
	}
	var cfg shippingConfig
	owner.ok(t, "GET", "/staff/shipping", nil, &cfg)
	if cfg.Providers["snapp"].LastSuccess == "" {
		t.Fatal("check lost on reload")
	}
	t.Setenv("SHIPPING_SIMULATED", "false")
	owner.ok(t, "GET", "/staff/shipping", nil, &cfg)
	if cfg.Providers["snapp"].LastSuccess != "" || cfg.Providers["snapp"].State == "ready" {
		t.Fatal("simulation certified live account")
	}
	t.Setenv("SHIPPING_SIMULATED", "true")
	owner.ok(t, "PUT", "/staff/shipping", cfg, nil)
	owner.ok(t, "GET", "/staff/shipping", nil, &cfg)
	if cfg.Providers["snapp"].LastSuccess != "" {
		t.Fatal("old check certified changed settings")
	}
	var count int
	if e := a.Pool.QueryRow(context.Background(), "SELECT count(*) FROM shipment_attempts").Scan(&count); e != nil || count != 0 {
		t.Fatal("check created shipment", count, e)
	}
}

func TestShippingUnknownDoesNotForgetPickup(t *testing.T) {
	a, owner, c, addr := shippingFixture(t)
	id, _, _ := quoteAndCheckout(t, c, addr, "")
	d := prepareShipping(t, c, owner, id)
	owner.ok(t, "POST", "/staff/orders/"+id+"/dispatch-quote", map[string]any{"version": d.Version}, &d)
	owner.ok(t, "POST", "/staff/orders/"+id+"/shipments", map[string]any{"version": d.Version, "dispatchQuoteId": d.Review.ID, "idempotencyKey": token()}, &d)
	ctx := context.Background()
	if e := a.ProcessShipments(ctx); e != nil {
		t.Fatal(e)
	}
	owner.ok(t, "POST", "/staff/orders/"+id+"/shipments/simulate", map[string]string{"status": "picked_up"}, &d)
	a.ShippingProvider = carrier.Disabled{}
	owner.ok(t, "POST", "/staff/orders/"+id+"/shipments/refresh", nil, &d)
	if d.Status != "unknown" {
		t.Fatal("expected transient unknown", d.Status)
	}
	a.ShippingProvider = nil
	owner.ok(t, "POST", "/staff/orders/"+id+"/shipments/simulate", map[string]string{"status": "accepted"}, &d)
	if d.Status != "picked_up" {
		t.Fatal("older lookup regressed pickup", d.Status)
	}
	var order domain.Order
	owner.ok(t, "GET", "/staff/orders/"+id, nil, &order)
	if order.Status != "shipped" {
		t.Fatal("lost shipped milestone", order.Status)
	}
}

func applyTechnicalFixture(t *testing.T, a *App, cfg shippingConfig) {
	t.Helper()
	raw, err := json.Marshal(shippingTechnical{Mode: cfg.Mode, Localities: cfg.Localities, Snapp: cfg.Snapp, Tapin: cfg.Tapin, PackagingGrams: cfg.PackagingGrams, Rules: cfg.Rules, PostalBoxSizes: postalBoxSizes(cfg.calculatedConfig)})
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "shipping.json")
	if err = os.WriteFile(path, raw, 0600); err != nil {
		t.Fatal(err)
	}
	if err = a.ApplyShippingConfig(context.Background(), path); err != nil {
		t.Fatal(err)
	}
}
