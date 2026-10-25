package app

import (
	"context"
	"encoding/json"
	"net/http"
	"slices"
	"testing"

	"bomish/internal/carrier"
	"bomish/internal/domain"
	"bomish/internal/packing"
	"bomish/internal/security"
)

func TestCourierCheckoutWithoutCartons(t *testing.T) {
	_, owner, customer, address := shippingFixture(t)
	var cfg shippingConfig
	owner.ok(t, "GET", "/staff/shipping", nil, &cfg)
	cfg.Boxes = []packing.Box{}
	cfg.FreeShippingRials = 1
	owner.ok(t, "PUT", "/staff/shipping", cfg, nil)
	id, quote, _ := quoteAndCheckout(t, customer, address, "snapp")
	if quote.Method != "snapp" || quote.ParcelCount != 0 || quote.WeightGrams != 1200 || quote.ShippingRials != 0 {
		t.Fatalf("courier must use package weight and free shipping without cartons: %+v", quote)
	}
	d := prepareShipping(t, customer, owner, id)
	if len(d.Parcels) != 0 || len(d.Snapshot.Items) != 2 || slices.Contains(d.AllowedActions, "edit_parcels") {
		t.Fatal("courier still requires carton handling", d)
	}
	if status, _ := customer.call("POST", "/checkout/quote", shippingQuoteInput{Address: address, Method: "post"}); status != 422 {
		t.Fatal("postal quote without cartons", status)
	}
	// The provider request contains the purchased units but no invented carton.
	req := shippingRequest(d.Snapshot)
	if len(req.Items) != 2 || len(req.Parcels) != 0 {
		t.Fatal("wrong courier request", req)
	}
}

func TestExplicitTehranDeliveryChoice(t *testing.T) {
	a, _, customer, address := shippingFixture(t)
	var post, courier quoteResult
	customer.ok(t, "POST", "/checkout/quote", shippingQuoteInput{Address: address, Method: "post"}, &post)
	customer.ok(t, "POST", "/checkout/quote", shippingQuoteInput{Address: address, Method: "snapp"}, &courier)
	if post.Method != "post" || post.RequiresAcceptance || post.ParcelCount == 0 || post.WeightGrams <= courier.WeightGrams || courier.ParcelCount != 0 {
		t.Fatal(post, courier)
	}
	// A selected courier must never silently become a postal order.
	address.PinConfirmed = false
	if status, _ := customer.call("POST", "/checkout/quote", shippingQuoteInput{Address: address, Method: "snapp"}); status != 422 {
		t.Fatal("courier silently fell back", status)
	}
	customer.ok(t, "POST", "/checkout/quote", shippingQuoteInput{Address: address, Method: "post"}, &post)
	address.PinConfirmed = true
	a.ShippingProvider = carrier.Disabled{}
	if status, _ := customer.call("POST", "/checkout/quote", shippingQuoteInput{Address: address, Method: "snapp"}); status != 422 {
		t.Fatal("missing courier fare accepted", status)
	}
}

func TestCourierCapacityUsesPackages(t *testing.T) {
	a, owner, customer, address := shippingFixture(t)
	var cfg shippingConfig
	owner.ok(t, "GET", "/staff/shipping", nil, &cfg)
	cfg.Snapp.MaxGrams = 1199
	applyTechnicalFixture(t, a, cfg)
	if status, _ := customer.call("POST", "/checkout/quote", shippingQuoteInput{Address: address, Method: "snapp"}); status != 422 {
		t.Fatal("overweight motorcycle allowed", status)
	}
	cfg.Snapp.MaxGrams = 1200
	applyTechnicalFixture(t, a, cfg)
	var q quoteResult
	customer.ok(t, "POST", "/checkout/quote", shippingQuoteInput{Address: address, Method: "snapp"}, &q)
}

func TestOwnCourierSMSContainsContactForPurchaser(t *testing.T) {
	a, owner, customer, address := shippingFixture(t)
	smsTestConfig(t)
	address.Phone = "09129999999" // Recipient differs from the purchaser.
	courierID := createTestCourier(t, owner, "کاوه پیک بومیش", true)
	id, _, _ := quoteAndCheckout(t, customer, address, "snapp")
	d := prepareShipping(t, customer, owner, id)
	owner.ok(t, "POST", "/staff/orders/"+id+"/own-courier", map[string]any{"version": d.Version, "courierId": courierID}, &d)
	// Snapshot must survive later member edits.
	if _, err := a.Pool.Exec(context.Background(), "UPDATE staff SET phone='09120000009',full_name='نام تازه' WHERE id=$1", courierID); err != nil {
		t.Fatal(err)
	}
	calls := 0
	smsTransport(t, func(r *http.Request) (*http.Response, error) {
		_ = r.ParseForm()
		calls++
		if r.Form.Get("receptor") != "09121110001" || r.Form.Get("token") != id || r.Form.Get("token2") != "09123456789" || r.Form.Get("token10") != "کاوه پیک بومیش" || r.Form.Get("template") != "bomish-snapp" {
			t.Fatal("wrong dispatch notification", r.Form)
		}
		return smsResponse(smsAccepted), nil
	})
	for range 2 {
		if err := a.ProcessSMS(context.Background()); err != nil {
			t.Fatal(err)
		}
	}
	if calls != 1 {
		t.Fatal("dispatch SMS duplicated or missing", calls)
	}
}

func TestSnappSMSWaitsForContactAndRetainsIt(t *testing.T) {
	a, owner, customer, address := shippingFixture(t)
	smsTestConfig(t)
	id, _, _ := quoteAndCheckout(t, customer, address, "snapp")
	d := prepareShipping(t, customer, owner, id)
	owner.ok(t, "POST", "/staff/orders/"+id+"/dispatch-quote", map[string]any{"version": d.Version}, &d)
	owner.ok(t, "POST", "/staff/orders/"+id+"/shipments", map[string]any{"version": d.Version, "dispatchQuoteId": d.Review.ID, "idempotencyKey": security.Token()}, &d)
	ctx := context.Background()
	var attempt, ref string
	if err := a.Pool.QueryRow(ctx, "SELECT id,reference FROM shipment_attempts WHERE order_id=$1", id).Scan(&attempt, &ref); err != nil {
		t.Fatal(err)
	}
	booking := carrier.Booking{ID: "test-driver-booking", Reference: ref, Status: "picked_up"}
	if err := a.applyBooking(ctx, attempt, id, "", booking); err != nil {
		t.Fatal(err)
	}
	calls := 0
	smsTransport(t, func(r *http.Request) (*http.Response, error) {
		_ = r.ParseForm()
		calls++
		if r.Form.Get("token2") != "09123450000" || r.Form.Get("token10") != "راننده اسنپ" || r.Form.Get("receptor") != "09121110001" {
			t.Fatal("missing Snapp contact", r.Form)
		}
		return smsResponse(smsAccepted), nil
	})
	if err := a.ProcessSMS(ctx); err != nil {
		t.Fatal(err)
	}
	if calls != 0 {
		t.Fatal("sent before contact arrived")
	}
	booking.DriverName, booking.DriverPhone = "راننده اسنپ", "+989123450000"
	if err := a.applyBooking(ctx, attempt, id, "", booking); err != nil {
		t.Fatal(err)
	}
	booking.DriverName, booking.DriverPhone = "", ""
	if err := a.applyBooking(ctx, attempt, id, "", booking); err != nil {
		t.Fatal(err)
	}
	if _, err := a.Pool.Exec(ctx, "UPDATE jobs SET available_at=now() WHERE payload->>'orderId'=$1", id); err != nil {
		t.Fatal(err)
	}
	if err := a.ProcessSMS(ctx); err != nil {
		t.Fatal(err)
	}
	if calls != 1 {
		t.Fatal("missing pickup notification", calls)
	}
	var result struct {
		Order domain.Order `json:"order"`
	}
	customer.ok(t, "GET", "/orders/"+id, nil, &result)
	if result.Order.Shipping.Courier == nil || result.Order.Shipping.Courier.Phone != "09123450000" {
		t.Fatal("customer contact unavailable", result)
	}
}

func TestCourierToPostPlansCartonsAndRequiresConfirmation(t *testing.T) {
	_, owner, customer, address := shippingFixture(t)
	id, quote, _ := quoteAndCheckout(t, customer, address, "snapp")
	d := prepareShipping(t, customer, owner, id)
	owner.ok(t, "POST", "/staff/orders/"+id+"/dispatch-quote", map[string]any{"version": d.Version, "method": "post"}, &d)
	if d.Review == nil || len(d.Review.Parcels) == 0 {
		t.Fatal("postal change has no carton plan", d.Review)
	}
	owner.ok(t, "POST", "/staff/orders/"+id+"/delivery-method", map[string]any{"version": d.Version, "method": "post", "dispatchQuoteId": d.Review.ID, "customerConsent": true, "reason": "customer requested post"}, &d)
	if d.Ready || len(d.Parcels) == 0 || len(orderUnits(d)) != 2 {
		t.Fatal("invalid postal preparation", d)
	}
	if status, _ := owner.call("POST", "/staff/orders/"+id+"/ready", map[string]any{"version": d.Version}); status != 409 {
		t.Fatal("unconfirmed postal cartons accepted", status)
	}
	d = prepareShipping(t, customer, owner, id)
	var order domain.Order
	owner.ok(t, "GET", "/staff/orders/"+id, nil, &order)
	if order.TotalRials != quote.TotalRials {
		t.Fatal("method change altered customer's invoice")
	}
	owner.ok(t, "POST", "/staff/orders/"+id+"/dispatch-quote", map[string]any{"version": d.Version, "method": "snapp"}, &d)
	owner.ok(t, "POST", "/staff/orders/"+id+"/delivery-method", map[string]any{"version": d.Version, "method": "snapp", "dispatchQuoteId": d.Review.ID, "customerConsent": true, "reason": "customer requested courier"}, &d)
	if len(d.Parcels) != 0 || len(orderUnits(d)) != 2 {
		t.Fatal("courier retained carton dependency")
	}
	owner.ok(t, "POST", "/staff/orders/"+id+"/ready", map[string]any{"version": d.Version}, &d)
}

func TestPostalPackingAppliesCarrierWeightLimitToUnlimitedCartons(t *testing.T) {
	size := packing.Size{Length: 80, Width: 80, Height: 100}
	items := []packing.Item{{ProductID: "p", PackageID: "a", Unit: 0, Size: size, Grams: 600}, {ProductID: "p", PackageID: "a", Unit: 1, Size: size, Grams: 600}}
	box := packing.Box{ID: "b", Name: "postal", Inside: packing.Size{Length: 200, Width: 200, Height: 200}, Outside: packing.Size{Length: 220, Width: 220, Height: 220}, EmptyGrams: 100, PostalSizeID: "1", Active: true, Verified: true}
	cfg := calculatedConfig{Boxes: []packing.Box{box}, Tapin: providerConfig{MaxGrams: 800, MaxSize: box.Outside}}
	parcels, err := postalPacking(items, cfg)
	if err != nil || len(parcels) != 2 {
		t.Fatal("carrier weight must split unlimited cartons", parcels, err)
	}
	for _, p := range parcels {
		if p.Weight() > 800 {
			t.Fatal("overweight postal parcel", p)
		}
	}
}

func TestLegacyCourierBookingRetainsHistoricalPackages(t *testing.T) {
	a, owner, customer, address := shippingFixture(t)
	id, _, _ := quoteAndCheckout(t, customer, address, "post")
	// Before this change, courier orders also stored units inside the carton plan.
	if _, err := a.Pool.Exec(context.Background(), `UPDATE order_shipping SET method='snapp',snapshot=jsonb_set(snapshot-'items','{method}','"snapp"') WHERE order_id=$1`, id); err != nil {
		t.Fatal(err)
	}
	d := prepareShipping(t, customer, owner, id)
	owner.ok(t, "POST", "/staff/orders/"+id+"/dispatch-quote", map[string]any{"version": d.Version}, &d)
	owner.ok(t, "POST", "/staff/orders/"+id+"/shipments", map[string]any{"version": d.Version, "dispatchQuoteId": d.Review.ID, "idempotencyKey": security.Token()}, &d)
	var raw []byte
	if err := a.Pool.QueryRow(context.Background(), "SELECT request FROM shipment_attempts WHERE order_id=$1", id).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	var req carrier.Request
	if err := json.Unmarshal(raw, &req); err != nil {
		t.Fatal(err)
	}
	if len(req.Items) != 2 || len(req.Parcels) != 0 {
		t.Fatal("historical units lost in courier booking", req)
	}
}
