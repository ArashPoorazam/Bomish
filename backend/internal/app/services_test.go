package app

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func TestKavenegarRequest(t *testing.T) {
	t.Setenv("SMS_ENABLED", "true")
	t.Setenv("KAVENEGAR_API_KEY", "test-key")
	t.Setenv("KAVENEGAR_SENDER", "1000123")
	t.Setenv("KAVENEGAR_VERIFY_TEMPLATE", "verify-bomish")
	previous := http.DefaultTransport
	t.Cleanup(func() { http.DefaultTransport = previous })
	calls := 0
	http.DefaultTransport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
		calls++
		if r.Method != "POST" || r.URL.Host != "api.kavenegar.com" {
			t.Fatalf("bad provider request %s", r.URL)
		}
		if e := r.ParseForm(); e != nil {
			t.Fatal(e)
		}
		if r.Form.Get("receptor") != "09120000000" {
			t.Fatal("missing receptor")
		}
		if calls == 1 {
			if r.URL.Path != "/v1/test-key/verify/lookup.json" || r.Form.Get("token") != "123456" || r.Form.Get("template") != "verify-bomish" {
				t.Fatal("bad OTP parameters")
			}
		} else {
			if r.URL.Path != "/v1/test-key/sms/send.json" || r.Form.Get("sender") != "1000123" || !strings.Contains(r.Form.Get("message"), "barcode=1234567890") {
				t.Fatal("bad status SMS")
			}
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"return":{"status":200}}`))}, nil
	})
	if e := sendSMS(context.Background(), "09120000000", "", "123456"); e != nil {
		t.Fatal(e)
	}
	if e := sendSMS(context.Background(), "09120000000", postalTrackingURL("1234567890"), ""); e != nil {
		t.Fatal(e)
	}
	http.DefaultTransport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"return":{"status":418}}`))}, nil
	})
	if sendSMS(context.Background(), "09120000000", "", "123456") == nil {
		t.Fatal("provider rejection accepted")
	}
	t.Setenv("SMS_ENABLED", "false")
	if sendSMS(context.Background(), "09120000000", "", "123456") == nil {
		t.Fatal("disabled provider called")
	}
}
func TestSMSWorker(t *testing.T) {
	a := setup(t)
	h := a.Handler()
	ctx := context.Background()
	c := newClient(t, h)
	c.login(t, "09128887777")
	c.ok(t, "PUT", "/cart/items/turmeric", map[string]any{"packageId": "test500", "quantity": 1}, nil)
	var q quoteResult
	c.ok(t, "POST", "/checkout/quote", map[string]string{"province": "تهران"}, &q)
	var result map[string]string
	c.ok(t, "POST", "/checkout", map[string]any{"address": map[string]string{"recipient": "تست", "phone": "09128887777", "province": "تهران", "city": "تهران", "street": "خیابان تست، پلاک ۱", "postalCode": "1234567890"}, "expectedTotalRials": q.TotalRials, "idempotencyKey": "sms-worker-test-0001"}, &result)
	c.ok(t, "POST", "/orders/"+result["orderId"]+"/simulate", map[string]bool{"success": true}, nil)
	t.Setenv("SMS_ENABLED", "true")
	t.Setenv("KAVENEGAR_API_KEY", "test-key")
	previous := http.DefaultTransport
	t.Cleanup(func() { http.DefaultTransport = previous })
	success := false
	calls := 0
	http.DefaultTransport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
		calls++
		body := `{"return":{"status":418}}`
		if success {
			body = `{"return":{"status":200}}`
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(body))}, nil
	})
	if e := a.ProcessSMS(ctx); e != nil {
		t.Fatal(e)
	}
	var status string
	var attempts int
	if e := a.Pool.QueryRow(ctx, "SELECT status,attempts FROM jobs WHERE kind='order_sms'").Scan(&status, &attempts); e != nil {
		t.Fatal(e)
	}
	if status != "pending" || attempts != 1 {
		t.Fatal("failed SMS not queued for retry")
	}
	success = true
	a.Pool.Exec(ctx, "UPDATE jobs SET available_at=now() WHERE kind='order_sms'")
	if e := a.ProcessSMS(ctx); e != nil {
		t.Fatal(e)
	}
	if e := a.ProcessSMS(ctx); e != nil {
		t.Fatal(e)
	}
	if calls != 2 {
		t.Fatalf("duplicate worker sends %d", calls)
	}
	a.Pool.QueryRow(ctx, "SELECT status FROM jobs WHERE kind='order_sms'").Scan(&status)
	if status != "sent" {
		t.Fatal("not marked sent")
	}
}
