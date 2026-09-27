package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/jackc/pgx/v5"
	"io"
	"math"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"
)

func validTracking(s string) bool { return regexp.MustCompile(`^[0-9]{10,30}$`).MatchString(s) }
func validSupportURL(s string) bool {
	if s == "" {
		return true
	}
	u, e := url.Parse(s)
	return e == nil && u.Scheme == "https" && (u.Host == "wa.me" || u.Host == "t.me") && u.User == nil
}
func (a *App) publicSettings(w http.ResponseWriter, r *http.Request) {
	var threshold int64
	var support string
	if e := a.Pool.QueryRow(r.Context(), "SELECT free_shipping_rials,support_url FROM settings WHERE id=true").Scan(&threshold, &support); e != nil {
		a.dbError(w, e)
		return
	}
	if support == "" {
		support = os.Getenv("SUPPORT_URL")
	}
	if !validSupportURL(support) {
		support = ""
	}
	write(w, 200, map[string]any{"freeShippingRials": threshold, "supportUrl": support, "mapEnabled": os.Getenv("NESHAN_API_KEY") != ""})
}
func (a *App) reverseAddress(w http.ResponseWriter, r *http.Request) {
	if !requireCustomer(w, r) {
		return
	}
	if !a.limit(r, "map:"+current(r).UserID, 60, time.Hour) {
		fail(w, 429, "کمی صبر کنید و دوباره تلاش کنید")
		return
	}
	lat, e := strconv.ParseFloat(r.URL.Query().Get("lat"), 64)
	lng, e2 := strconv.ParseFloat(r.URL.Query().Get("lng"), 64)
	if e != nil || e2 != nil || math.IsNaN(lat) || math.IsNaN(lng) || math.IsInf(lat, 0) || math.IsInf(lng, 0) || lat < 24 || lat > 40 || lng < 44 || lng > 64 {
		fail(w, 400, "موقعیت داخل ایران را انتخاب کنید")
		return
	}
	key := os.Getenv("NESHAN_API_KEY")
	if key == "" {
		fail(w, 503, "تبدیل نشانی فعال نیست؛ نشانی را دستی وارد کنید")
		return
	}
	req, _ := http.NewRequestWithContext(r.Context(), "GET", fmt.Sprintf("https://api.neshan.org/v5/reverse?lat=%f&lng=%f", lat, lng), nil)
	req.Header.Set("Api-Key", key)
	res, e := (&http.Client{Timeout: 10 * time.Second}).Do(req)
	if e != nil {
		fail(w, 502, "ارتباط با نشان برقرار نشد؛ نشانی را دستی وارد کنید")
		return
	}
	defer res.Body.Close()
	var v struct {
		Status  string `json:"status"`
		Address string `json:"formatted_address"`
		City    string `json:"city"`
		State   string `json:"state"`
	}
	if res.StatusCode != 200 || json.NewDecoder(io.LimitReader(res.Body, 1<<20)).Decode(&v) != nil || v.Status != "OK" || v.Address == "" {
		fail(w, 502, "نشانی پیدا نشد؛ محل دیگری انتخاب یا نشانی را دستی وارد کنید")
		return
	}
	write(w, 200, map[string]any{"street": v.Address, "city": v.City, "province": strings.TrimSpace(strings.TrimPrefix(v.State, "استان ")), "latitude": lat, "longitude": lng})
}
func smsEnabled() bool { return os.Getenv("SMS_ENABLED") == "true" }
func sendSMS(ctx context.Context, phone, message, code string) error {
	if !smsEnabled() {
		return errors.New("SMS disabled")
	}
	key := os.Getenv("KAVENEGAR_API_KEY")
	if key == "" {
		return errors.New("SMS key missing")
	}
	scope := "sms/send"
	v := url.Values{"receptor": {phone}, "message": {message}, "sender": {os.Getenv("KAVENEGAR_SENDER")}}
	if code != "" {
		scope = "verify/lookup"
		v = url.Values{"receptor": {phone}, "token": {code}, "template": {os.Getenv("KAVENEGAR_VERIFY_TEMPLATE")}}
	}
	req, _ := http.NewRequestWithContext(ctx, "POST", "https://api.kavenegar.com/v1/"+url.PathEscape(key)+"/"+scope+".json", strings.NewReader(v.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	res, e := (&http.Client{Timeout: 12 * time.Second}).Do(req)
	if e != nil {
		return errors.New("SMS provider unavailable")
	}
	defer res.Body.Close()
	var out struct {
		Return struct {
			Status int `json:"status"`
		} `json:"return"`
	}
	if res.StatusCode != 200 || json.NewDecoder(io.LimitReader(res.Body, 1<<20)).Decode(&out) != nil || out.Return.Status != 200 {
		return errors.New("SMS provider rejected request")
	}
	return nil
}

// Persist status history and a deduplicated notification in the same transaction as the order change.
func queueOrderSMS(ctx context.Context, tx pgx.Tx, id, stage string) error {
	if _, e := tx.Exec(ctx, "INSERT INTO order_events(order_id,status) VALUES($1,$2) ON CONFLICT DO NOTHING", id, stage); e != nil {
		return e
	}
	raw, _ := json.Marshal(map[string]string{"orderId": id, "stage": stage})
	_, e := tx.Exec(ctx, "INSERT INTO jobs(kind,payload) VALUES('order_sms',$1) ON CONFLICT DO NOTHING", raw)
	return e
}

// A locked row prevents concurrent workers from sending the same job. Retry delivery failures with backoff.
// Provider timeouts can be ambiguous: at-least-once delivery may occasionally duplicate a text.
func (a *App) ProcessSMS(ctx context.Context) error {
	if !smsEnabled() {
		return nil
	}
	for n := 0; n < 10; n++ {
		tx, e := a.Pool.Begin(ctx)
		if e != nil {
			return e
		}
		var job int64
		var attempts int
		var raw []byte
		e = tx.QueryRow(ctx, "SELECT id,payload,attempts FROM jobs WHERE kind='order_sms' AND status='pending' AND available_at<=now() ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1").Scan(&job, &raw, &attempts)
		if e == pgx.ErrNoRows {
			tx.Rollback(ctx)
			return nil
		}
		if e != nil {
			tx.Rollback(ctx)
			return e
		}
		var p struct {
			OrderID string `json:"orderId"`
			Stage   string `json:"stage"`
		}
		_ = json.Unmarshal(raw, &p)
		var phone, tracking string
		e = tx.QueryRow(ctx, "SELECT u.phone,o.tracking FROM orders o JOIN users u ON u.id=o.user_id WHERE o.id=$1", p.OrderID).Scan(&phone, &tracking)
		if e != nil {
			tx.Rollback(ctx)
			return e
		}
		title := map[string]string{"paid": "خرید شما ثبت شد", "packing": "سفارش شما بسته‌بندی شد", "shipped": "سفارش شما ارسال شد", "received": "سفارش شما تحویل شد"}[p.Stage]
		message := "بومیش: " + title + "\n" + strings.TrimRight(a.Origin, "/") + "/account/orders/" + p.OrderID
		if p.Stage == "shipped" {
			message += "\nکد رهگیری: " + tracking + "\n" + postalTrackingURL(tracking)
		}
		e = sendSMS(ctx, phone, message, "")
		if e == nil {
			_, e = tx.Exec(ctx, "UPDATE jobs SET status='sent',attempts=attempts+1 WHERE id=$1", job)
		} else {
			status := "pending"
			if attempts >= 7 {
				status = "failed"
			}
			_, e = tx.Exec(ctx, "UPDATE jobs SET status=$2,attempts=attempts+1,available_at=now()+($3 * interval '1 minute') WHERE id=$1", job, status, 1<<min(attempts, 8))
		}
		if e != nil {
			tx.Rollback(ctx)
			return e
		}
		if e = tx.Commit(ctx); e != nil {
			return e
		}
	}
	return nil
}
func postalTrackingURL(code string) string {
	template := os.Getenv("POST_TRACKING_URL_TEMPLATE")
	if template == "" {
		return "https://pishkhan24.com/posttracking/?barcode=" + url.QueryEscape(code)
	}
	if !strings.HasPrefix(template, "https://pishkhan24.com/") {
		return "https://pishkhan24.com/posttracking/?barcode=" + url.QueryEscape(code)
	}
	return strings.ReplaceAll(template, "{tracking}", url.QueryEscape(code))
}
func (a *App) getOrder(w http.ResponseWriter, r *http.Request) {
	if !requireCustomer(w, r) {
		return
	}
	orders, e := loadOrders(r.Context(), a.Pool, current(r).UserID, r.PathValue("id"))
	if e != nil {
		a.dbError(w, e)
		return
	}
	for _, o := range orders {
		if o.ID == r.PathValue("id") {
			write(w, 200, map[string]any{"order": o, "trackingUrl": postalTrackingURL(o.Tracking)})
			return
		}
	}
	fail(w, 404, "سفارش پیدا نشد")
}
