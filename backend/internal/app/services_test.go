package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func smsTestConfig(t *testing.T) {
	t.Helper()
	t.Setenv("SMS_ENABLED", "true")
	t.Setenv("KAVENEGAR_API_KEY", "test-key")
	for _, key := range smsTemplateSettings {
		t.Setenv(key, "bomish-"+strings.ToLower(strings.TrimSuffix(strings.TrimPrefix(key, "KAVENEGAR_"), "_TEMPLATE")))
	}
}
func smsTransport(t *testing.T, f roundTripFunc) {
	t.Helper()
	previous := http.DefaultTransport
	http.DefaultTransport = f
	t.Cleanup(func() { http.DefaultTransport = previous })
}
func smsResponse(body string) *http.Response {
	return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(body))}
}

const smsAccepted = `{"return":{"status":200},"entries":[{"messageid":1234,"status":1}]}`

func TestKavenegarTemplates(t *testing.T) {
	smsTestConfig(t)
	smsTransport(t, func(r *http.Request) (*http.Response, error) {
		if r.Method != "POST" || r.URL.String() != "https://api.kavenegar.com/v1/test-key/verify/lookup.json" {
			t.Fatal("unexpected request")
		}
		if err := r.ParseForm(); err != nil {
			t.Fatal(err)
		}
		if r.Form.Get("receptor") != "09120000000" || r.Form.Get("type") != "sms" || r.Form.Get("sender") != "" || r.Form.Get("message") != "" {
			t.Fatal("unexpected form")
		}
		if r.Form.Get("token") == "" || r.Form.Get("template") == "" {
			t.Fatal("missing template token")
		}
		return smsResponse(smsAccepted), nil
	})
	for _, tc := range []struct{ stage, method, template string }{
		{"paid", "post", "bomish-paid"}, {"packing", "post", "bomish-packed"},
		{"shipped", "legacy_postal", "bomish-post"}, {"shipped", "post", "bomish-post"},
		{"shipped", "snapp", "bomish-snapp"}, {"received", "snapp", "bomish-delivered"},
	} {
		template := orderSMSTemplate(tc.stage, tc.method)
		if template != tc.template {
			t.Fatal(template)
		}
		if got := sendSMSTemplate(context.Background(), "09120000000", template, "abcdef1234"); got.Status != "accepted" || got.MessageID != 1234 {
			t.Fatal(got)
		}
	}
	if got := sendSMSTemplate(context.Background(), "09120000000", "bomish-verify", "123456"); got.Status != "accepted" {
		t.Fatal(got)
	}
}
func TestKavenegarFailureClassification(t *testing.T) {
	smsTestConfig(t)
	for _, tc := range []struct {
		name, body, status string
		retry              bool
		transport          bool
	}{
		{"temporary", `{"return":{"status":409}}`, "rejected", true, false},
		{"credit", `{"return":{"status":418}}`, "rejected", false, false},
		{"approval", `{"return":{"status":424}}`, "rejected", false, false},
		{"malformed", `{`, "unknown", false, false},
		{"missing-id", `{"return":{"status":200}}`, "unknown", false, false},
		{"timeout", "", "unknown", false, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			smsTransport(t, func(*http.Request) (*http.Response, error) {
				if tc.transport {
					return nil, errors.New("secret-key OTP 123456")
				}
				return smsResponse(tc.body), nil
			})
			got := sendSMSTemplate(context.Background(), "09120000000", "bomish-verify", "123456")
			if got.Status != tc.status || got.Retryable != tc.retry || strings.Contains(got.ErrorCode, "secret") {
				t.Fatal(got)
			}
		})
	}
	t.Run("redirect", func(t *testing.T) {
		calls := 0
		smsTransport(t, func(*http.Request) (*http.Response, error) {
			calls++
			return &http.Response{StatusCode: 307, Header: http.Header{"Location": {"https://untrusted.test"}}, Body: io.NopCloser(strings.NewReader(""))}, nil
		})
		got := sendSMSTemplate(context.Background(), "09120000000", "bomish-verify", "123456")
		if got.Status != "unknown" || calls != 1 {
			t.Fatal(got, calls)
		}
	})
	t.Setenv("SMS_ENABLED", "false")
	if got := sendSMSTemplate(context.Background(), "09120000000", "bomish-verify", "123456"); got.ErrorCode != "sms_disabled" {
		t.Fatal(got)
	}
}
func TestSMSConfig(t *testing.T) {
	smsTestConfig(t)
	if err := ValidateSMSConfig("https://bomish.test"); err != nil {
		t.Fatal(err)
	}
	for _, origin := range []string{"http://localhost:3000", "https://user:pass@bomish.test", "https://bomish.test/path", "https://bomish.test?query=x"} {
		if ValidateSMSConfig(origin) == nil {
			t.Fatal("invalid origin accepted", origin)
		}
	}
	t.Setenv("KAVENEGAR_PACKED_TEMPLATE", "")
	if ValidateSMSConfig("https://bomish.test") == nil {
		t.Fatal("missing template accepted")
	}
	t.Setenv("SMS_ENABLED", "false")
	if err := ValidateSMSConfig("http://localhost:3000"); err != nil {
		t.Fatal(err)
	}
}
func smsOrder(t *testing.T, a *App, id string) {
	t.Helper()
	_, err := a.Pool.Exec(context.Background(), `INSERT INTO users(id,phone) VALUES('sms-user','09120000000') ON CONFLICT DO NOTHING;
 `)
	if err != nil {
		t.Fatal(err)
	}
	_, err = a.Pool.Exec(context.Background(), `INSERT INTO orders(id,user_id,idempotency_key,status,address,subtotal_rials,shipping_rials,total_rials,reservation_expires_at) VALUES($1,'sms-user',$1,'paid','{"phone":"09129999999"}',0,0,0,now())`, id)
	if err != nil {
		t.Fatal(err)
	}
}
func smsQueue(t *testing.T, a *App, id, stage string) {
	t.Helper()
	ctx := context.Background()
	tx, err := a.Pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, "UPDATE orders SET status=$2 WHERE id=$1", id, stage); err != nil {
		t.Fatal(err)
	}
	if err = queueOrderSMS(ctx, tx, id, stage); err != nil {
		t.Fatal(err)
	}
	if err = tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
}
func smsJobStatus(t *testing.T, a *App, id, stage string) (string, int, string) {
	t.Helper()
	var status, reason string
	var attempts int
	if err := a.Pool.QueryRow(context.Background(), `SELECT status,attempts,last_error FROM jobs WHERE kind='order_sms' AND payload->>'orderId'=$1 AND payload->>'stage'=$2`, id, stage).Scan(&status, &attempts, &reason); err != nil {
		t.Fatal(err)
	}
	return status, attempts, reason
}
func TestSMSWorker(t *testing.T) {
	a := setup(t)
	smsTestConfig(t)
	ctx := context.Background()
	smsOrder(t, a, "sms-order")
	smsQueue(t, a, "sms-order", "paid")
	smsQueue(t, a, "sms-order", "paid")
	success := false
	calls := 0
	smsTransport(t, func(r *http.Request) (*http.Response, error) {
		calls++
		_ = r.ParseForm()
		if r.Form.Get("receptor") != "09120000000" {
			t.Fatal("used delivery address instead of purchaser")
		}
		if success {
			return smsResponse(smsAccepted), nil
		}
		return smsResponse(`{"return":{"status":409}}`), nil
	})
	if err := a.ProcessSMS(ctx); err != nil {
		t.Fatal(err)
	}
	if status, n, _ := smsJobStatus(t, a, "sms-order", "paid"); status != "pending" || n != 1 {
		t.Fatal(status, n)
	}
	if err := a.ProcessSMS(ctx); err != nil {
		t.Fatal(err)
	}
	if calls != 1 {
		t.Fatal("backoff ignored")
	}
	success = true
	if _, err := a.Pool.Exec(ctx, "UPDATE jobs SET available_at=now() WHERE kind='order_sms'"); err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if err := a.ProcessSMS(ctx); err != nil {
			t.Fatal(err)
		}
	}
	if status, n, _ := smsJobStatus(t, a, "sms-order", "paid"); status != "accepted" || n != 2 || calls != 2 {
		t.Fatal(status, n, calls)
	}
	var count int
	if err := a.Pool.QueryRow(ctx, "SELECT count(*) FROM sms_attempts WHERE provider_message_id=1234 AND status='accepted'").Scan(&count); err != nil || count != 1 {
		t.Fatal(count, err)
	}
}
func TestSMSUnknownPermanentAndRetryCap(t *testing.T) {
	a := setup(t)
	smsTestConfig(t)
	ctx := context.Background()
	for _, tc := range []struct {
		id, body, want string
		uncertain      bool
		previous       int
	}{
		{"ambiguous", "", "unknown", true, 0}, {"bad-template", `{"return":{"status":424}}`, "failed", false, 0},
		{"retry-cap", `{"return":{"status":409}}`, "failed", false, 7},
	} {
		t.Run(tc.id, func(t *testing.T) {
			smsOrder(t, a, tc.id)
			smsQueue(t, a, tc.id, "paid")
			if _, err := a.Pool.Exec(ctx, "UPDATE jobs SET attempts=$2 WHERE payload->>'orderId'=$1", tc.id, tc.previous); err != nil {
				t.Fatal(err)
			}
			calls := 0
			smsTransport(t, func(*http.Request) (*http.Response, error) {
				calls++
				if tc.uncertain {
					return nil, context.DeadlineExceeded
				}
				return smsResponse(tc.body), nil
			})
			for range 2 {
				if err := a.ProcessSMS(ctx); err != nil {
					t.Fatal(err)
				}
			}
			if status, _, _ := smsJobStatus(t, a, tc.id, "paid"); status != tc.want || calls != 1 {
				t.Fatal(status, calls)
			}
		})
	}
}
func TestSMSConcurrentWorkersAndCrash(t *testing.T) {
	a := setup(t)
	smsTestConfig(t)
	ctx := context.Background()
	smsOrder(t, a, "concurrent")
	smsQueue(t, a, "concurrent", "paid")
	var calls atomic.Int32
	smsTransport(t, func(*http.Request) (*http.Response, error) {
		calls.Add(1)
		time.Sleep(25 * time.Millisecond)
		return smsResponse(smsAccepted), nil
	})
	var wg sync.WaitGroup
	errs := make(chan error, 4)
	for range 4 {
		wg.Go(func() { errs <- a.ProcessSMS(ctx) })
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	if calls.Load() != 1 {
		t.Fatal("duplicate send", calls.Load())
	}
	smsOrder(t, a, "crash")
	smsQueue(t, a, "crash", "paid")
	job, err := a.claimSMS(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = a.Pool.Exec(ctx, "UPDATE jobs SET started_at=now()-interval '3 minutes' WHERE id=$1", job.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = a.Pool.Exec(ctx, "UPDATE sms_attempts SET created_at=now()-interval '3 minutes' WHERE id=$1", job.AttemptID); err != nil {
		t.Fatal(err)
	}
	if err = a.ProcessSMS(ctx); err != nil {
		t.Fatal(err)
	}
	if status, _, reason := smsJobStatus(t, a, "crash", "paid"); status != "unknown" || reason != "worker_interrupted" || calls.Load() != 1 {
		t.Fatal(status, reason, calls.Load())
	}
}
func TestSMSSupersededDisabledAndRollback(t *testing.T) {
	a := setup(t)
	smsTestConfig(t)
	ctx := context.Background()
	smsOrder(t, a, "later")
	for _, stage := range []string{"paid", "packing", "shipped", "received"} {
		smsQueue(t, a, "later", stage)
	}
	t.Setenv("SMS_ENABLED", "false")
	smsOrder(t, a, "disabled")
	smsQueue(t, a, "disabled", "paid")
	t.Setenv("SMS_ENABLED", "true")
	calls := 0
	smsTransport(t, func(r *http.Request) (*http.Response, error) {
		calls++
		_ = r.ParseForm()
		if r.Form.Get("template") != "bomish-delivered" {
			t.Fatal("stale notification")
		}
		return smsResponse(smsAccepted), nil
	})
	if err := a.ProcessSMS(ctx); err != nil {
		t.Fatal(err)
	}
	if calls != 1 {
		t.Fatal(calls)
	}
	for _, stage := range []string{"paid", "packing", "shipped"} {
		if status, n, reason := smsJobStatus(t, a, "later", stage); status != "skipped" || n != 0 || reason != "superseded" {
			t.Fatal(status, n, reason)
		}
	}
	if status, _, reason := smsJobStatus(t, a, "disabled", "paid"); status != "skipped" || reason != "sms_disabled" {
		t.Fatal(status, reason)
	}
	smsOrder(t, a, "rollback")
	tx, err := a.Pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err = queueOrderSMS(ctx, tx, "rollback", "paid"); err != nil {
		t.Fatal(err)
	}
	if err = tx.Rollback(ctx); err != nil {
		t.Fatal(err)
	}
	var count int
	if err = a.Pool.QueryRow(ctx, "SELECT count(*) FROM jobs WHERE payload->>'orderId'='rollback'").Scan(&count); err != nil || count != 0 {
		t.Fatal(count, err)
	}
}
func TestRealOTPNoCodeLeakAndSingleUse(t *testing.T) {
	a := setup(t)
	smsTestConfig(t)
	var code string
	smsTransport(t, func(r *http.Request) (*http.Response, error) {
		_ = r.ParseForm()
		code = r.Form.Get("token")
		return smsResponse(smsAccepted), nil
	})
	c := newClient(t, a.Handler())
	phone := "09124445555"
	status, raw := c.call("POST", "/auth/request", map[string]string{"phone": phone})
	if status != 200 || len(code) != 6 || strings.Contains(string(raw), "devCode") || strings.Contains(string(raw), code) {
		t.Fatal("OTP response leaked or failed")
	}
	var response map[string]any
	if err := json.Unmarshal(raw, &response); err != nil {
		t.Fatal(err)
	}
	if response["expiresIn"] != float64(300) || response["resendAfter"] != float64(60) {
		t.Fatal(response)
	}
	if status, _ = c.call("POST", "/auth/request", map[string]string{"phone": phone}); status != 429 {
		t.Fatal(status)
	}
	c.ok(t, "POST", "/auth/verify", map[string]string{"phone": phone, "code": code}, nil)
	if status, _ = c.call("POST", "/auth/verify", map[string]string{"phone": phone, "code": code}); status != 400 {
		t.Fatal("OTP replay")
	}
	var attempts string
	if err := a.Pool.QueryRow(context.Background(), "SELECT row_to_json(s)::text FROM sms_attempts s WHERE purpose='login'").Scan(&attempts); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(attempts, fmt.Sprintf(`"token":"%s"`, code)) || strings.Contains(attempts, "test-key") {
		t.Fatal("secrets stored")
	}
}

func TestRejectedOTPInvalidatesChallenge(t *testing.T) {
	a := setup(t)
	smsTestConfig(t)
	for i, uncertain := range []bool{false, true} {
		t.Run(fmt.Sprint(uncertain), func(t *testing.T) {
			smsTransport(t, func(*http.Request) (*http.Response, error) {
				if uncertain {
					return nil, context.DeadlineExceeded
				}
				return smsResponse(`{"return":{"status":424,"message":"secret provider text"}}`), nil
			})
			c := newClient(t, a.Handler())
			phone := fmt.Sprintf("0912000111%d", i)
			status, raw := c.call("POST", "/auth/request", map[string]string{"phone": phone})
			if status != 502 || strings.Contains(string(raw), "secret") || strings.Contains(string(raw), "devCode") {
				t.Fatal(status, string(raw))
			}
			var count int
			if err := a.Pool.QueryRow(context.Background(), "SELECT count(*) FROM otp_challenges WHERE phone=$1", phone).Scan(&count); err != nil || count != 0 {
				t.Fatal("challenge retained", count, err)
			}
		})
	}
}
