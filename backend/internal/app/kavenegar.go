package app

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
)

var smsTemplateSettings = []string{
	"KAVENEGAR_VERIFY_TEMPLATE",
	"KAVENEGAR_PAID_TEMPLATE",
	"KAVENEGAR_PACKED_TEMPLATE",
	"KAVENEGAR_POST_TEMPLATE",
	"KAVENEGAR_SNAPP_TEMPLATE",
	"KAVENEGAR_DELIVERED_TEMPLATE",
}

func smsEnabled() bool { return os.Getenv("SMS_ENABLED") == "true" }

// ValidateSMSConfig checks local settings only; approval is verified with the provider during rollout.
func ValidateSMSConfig(origin string) error {
	if !smsEnabled() {
		return nil
	}
	if strings.TrimSpace(os.Getenv("KAVENEGAR_API_KEY")) == "" {
		return errors.New("KAVENEGAR_API_KEY required when SMS is enabled")
	}
	for _, setting := range smsTemplateSettings {
		if !validSMSTemplate(os.Getenv(setting)) {
			return errors.New(setting + " must name an approved Kavenegar template")
		}
	}
	u, err := url.Parse(origin)
	if err != nil || u.Scheme != "https" || u.Hostname() == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || (u.Path != "" && u.Path != "/") {
		return errors.New("real SMS requires a public HTTPS APP_ORIGIN matching the approved templates")
	}
	return nil
}

func validSMSTemplate(s string) bool {
	return regexp.MustCompile(`^[A-Za-z][A-Za-z0-9-]*$`).MatchString(s)
}

func orderSMSTemplate(stage, method string) string {
	setting := map[string]string{
		"paid": "KAVENEGAR_PAID_TEMPLATE", "packing": "KAVENEGAR_PACKED_TEMPLATE",
		"shipped": "KAVENEGAR_POST_TEMPLATE", "received": "KAVENEGAR_DELIVERED_TEMPLATE",
	}[stage]
	if stage == "shipped" && method == "snapp" {
		setting = "KAVENEGAR_SNAPP_TEMPLATE"
	}
	return os.Getenv(setting)
}

// No provider text, request URL, token or transport error is retained: these can contain secrets.
type smsResult struct {
	Status         string
	MessageID      int64
	ProviderStatus int
	ErrorCode      string
	Retryable      bool
}

func sendSMSTemplate(ctx context.Context, phone, template, value string) smsResult {
	rejected := func(code string) smsResult { return smsResult{Status: "rejected", ErrorCode: code} }
	if !smsEnabled() {
		return rejected("sms_disabled")
	}
	key := os.Getenv("KAVENEGAR_API_KEY")
	if strings.TrimSpace(key) == "" || !validSMSTemplate(template) {
		return rejected("configuration")
	}
	// Tokens are either the six digit OTP or Bomish's opaque order identifier.
	if !regexp.MustCompile(`^[A-Za-z0-9-]{1,100}$`).MatchString(value) {
		return rejected("invalid_token")
	}
	form := url.Values{"receptor": {phone}, "template": {template}, "token": {value}, "type": {"sms"}}
	req, err := http.NewRequestWithContext(ctx, "POST", "https://api.kavenegar.com/v1/"+url.PathEscape(key)+"/verify/lookup.json", strings.NewReader(form.Encode()))
	if err != nil {
		return rejected("configuration")
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	client := &http.Client{Timeout: 12 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	res, err := client.Do(req)
	if err != nil {
		return smsResult{Status: "unknown", ErrorCode: "transport_uncertain"}
	}
	defer res.Body.Close()
	var out struct {
		Return struct {
			Status int `json:"status"`
		} `json:"return"`
		Entries []struct {
			MessageID int64 `json:"messageid"`
			Status    int   `json:"status"`
		} `json:"entries"`
	}
	if json.NewDecoder(io.LimitReader(res.Body, 1<<20)).Decode(&out) != nil || out.Return.Status == 0 {
		return smsResult{Status: "unknown", ErrorCode: "response_uncertain"}
	}
	if out.Return.Status != 200 {
		// Only an explicit Kavenegar temporary rejection is safe to resend.
		return smsResult{Status: "rejected", ProviderStatus: out.Return.Status, ErrorCode: "provider_rejected", Retryable: out.Return.Status == 409}
	}
	if res.StatusCode != http.StatusOK || len(out.Entries) != 1 || out.Entries[0].MessageID <= 0 {
		return smsResult{Status: "unknown", ErrorCode: "response_uncertain"}
	}
	return smsResult{Status: "accepted", MessageID: out.Entries[0].MessageID, ProviderStatus: out.Entries[0].Status}
}

func (a *App) sendLoginSMS(ctx context.Context, phone, code string) error {
	template := os.Getenv("KAVENEGAR_VERIFY_TEMPLATE")
	var attempt int64
	err := a.Pool.QueryRow(ctx, `INSERT INTO sms_attempts(purpose,template,receptor,status) VALUES('login',$1,$2,'sending') RETURNING id`, template, phone).Scan(&attempt)
	if err != nil {
		return errors.New("SMS attempt unavailable")
	}
	result := sendSMSTemplate(ctx, phone, template, code)
	// Persist an observed result even if the browser disconnects after submission.
	finishCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	if err = finishSMSAttempt(finishCtx, a.Pool, attempt, result); err != nil {
		return errors.New("SMS result unavailable")
	}
	if result.Status != "accepted" {
		return errors.New("SMS not accepted")
	}
	return nil
}

func finishSMSAttempt(ctx context.Context, q interface {
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
}, id int64, result smsResult) error {
	_, err := q.Exec(ctx, `UPDATE sms_attempts SET status=$2,provider_message_id=nullif($3,0),provider_status=nullif($4,0),error_code=$5,finished_at=now() WHERE id=$1`, id, result.Status, result.MessageID, result.ProviderStatus, result.ErrorCode)
	return err
}
