package app

import (
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"bomish/internal/httpx"
)

func (a *App) reverseAddress(w http.ResponseWriter, r *http.Request) {
	if !requireCustomer(w, r) {
		return
	}
	if !a.limit(r, "map:"+current(r).UserID, 60, time.Hour) {
		httpx.Error(w, 429, "کمی صبر کنید و دوباره تلاش کنید")
		return
	}
	lat, e := strconv.ParseFloat(r.URL.Query().Get("lat"), 64)
	lng, e2 := strconv.ParseFloat(r.URL.Query().Get("lng"), 64)
	if e != nil || e2 != nil || math.IsNaN(lat) || math.IsNaN(lng) || math.IsInf(lat, 0) || math.IsInf(lng, 0) || lat < 24 || lat > 40 || lng < 44 || lng > 64 {
		httpx.Error(w, 400, "موقعیت داخل ایران را انتخاب کنید")
		return
	}
	key := os.Getenv("NESHAN_API_KEY")
	if key == "" {
		httpx.Error(w, 503, "تبدیل نشانی فعال نیست؛ نشانی را دستی وارد کنید")
		return
	}
	req, _ := http.NewRequestWithContext(r.Context(), "GET", fmt.Sprintf("https://api.neshan.org/v5/reverse?lat=%f&lng=%f", lat, lng), nil)
	req.Header.Set("Api-Key", key)
	res, e := (&http.Client{Timeout: 10 * time.Second}).Do(req)
	if e != nil {
		httpx.Error(w, 502, "ارتباط با نشان برقرار نشد؛ نشانی را دستی وارد کنید")
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
		httpx.Error(w, 502, "نشانی پیدا نشد؛ محل دیگری انتخاب یا نشانی را دستی وارد کنید")
		return
	}
	httpx.JSON(w, 200, map[string]any{"street": v.Address, "city": v.City, "province": strings.TrimSpace(strings.TrimPrefix(v.State, "استان ")), "latitude": lat, "longitude": lng})
}
