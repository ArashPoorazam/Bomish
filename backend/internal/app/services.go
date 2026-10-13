package app

import (
	"encoding/json"
	"fmt"
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
	cfg, e := readShippingConfig(r.Context(), a.Pool, false)
	if e != nil {
		a.dbError(w, e)
		return
	}
	write(w, 200, map[string]any{"shippingMode": cfg.Mode, "freeShippingRials": threshold, "supportUrl": support, "mapEnabled": os.Getenv("NESHAN_API_KEY") != ""})
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
			trackingURL := ""
			if o.Shipping == nil && validTracking(o.Tracking) {
				trackingURL = postalTrackingURL(o.Tracking)
			}
			write(w, 200, map[string]any{"order": o, "trackingUrl": trackingURL})
			return
		}
	}
	fail(w, 404, "سفارش پیدا نشد")
}
