package app

import (
	"bomish/internal/domain"
	"bomish/internal/packing"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"
)

type locality struct {
	ID            string `json:"id"`
	ProvinceID    string `json:"provinceId"`
	Province      string `json:"province"`
	City          string `json:"city"`
	TapinProvince string `json:"tapinProvince"`
	TapinCity     string `json:"tapinCity"`
	Verified      bool   `json:"verified"`
}
type providerConfig struct {
	Enabled      bool         `json:"enabled"`
	Service      string       `json:"service"`
	ShopID       string       `json:"shopId"`
	Currency     string       `json:"currency"`
	Verified     bool         `json:"verified"`
	CityID       string       `json:"cityId"`
	Area         [][2]float64 `json:"area"`
	MaxGrams     int64        `json:"maxGrams"`
	MaxVolumeCm3 int64        `json:"maxVolumeCm3"`
	MaxParcels   int          `json:"maxParcels"`
	MaxSize      packing.Size `json:"maxSize"`
}
type calculatedConfig struct {
	Version        int64          `json:"version"`
	Mode           string         `json:"mode"`
	OriginRevision int64          `json:"originRevision"`
	Origin         domain.Address `json:"origin"`
	Boxes          []packing.Box  `json:"boxes"`
	Localities     []locality     `json:"localities"`
	Snapp          providerConfig `json:"snapp"`
	Tapin          providerConfig `json:"tapin"`
}
type providerHealth struct {
	State       string `json:"state"`
	Configured  bool   `json:"configured"`
	Simulated   bool   `json:"simulated"`
	LastSuccess string `json:"lastSuccess"`
	Error       string `json:"error"`
}

func shippingError(w http.ResponseWriter, status int, code, msg string) {
	write(w, status, map[string]string{"code": code, "error": msg})
}
func readShippingConfig(ctx context.Context, q querier, lock bool) (calculatedConfig, error) {
	var c calculatedConfig
	var raw []byte
	suffix := ""
	if lock {
		suffix = " FOR SHARE"
	}
	e := q.QueryRow(ctx, "SELECT version,content FROM shipping_configuration WHERE id=true"+suffix).Scan(&c.Version, &raw)
	if e != nil {
		return c, e
	}
	version := c.Version
	e = json.Unmarshal(raw, &c)
	c.Version = version
	if c.Boxes == nil {
		c.Boxes = []packing.Box{}
	}
	if c.Localities == nil {
		c.Localities = []locality{}
	}
	return c, e
}
func (a *App) simulatedShipping() bool { return a.Dev && os.Getenv("SHIPPING_SIMULATED") == "true" }
func (a *App) shippingHealth(c calculatedConfig) map[string]providerHealth {
	out := map[string]providerHealth{}
	for name, p := range map[string]providerConfig{"snapp": c.Snapp, "tapin": c.Tapin} {
		h := providerHealth{State: "disabled", Simulated: a.simulatedShipping(), Configured: os.Getenv(strings.ToUpper(name)+"_API_KEY") != ""}
		if h.Simulated {
			h.Configured = true
		}
		if p.Enabled {
			h.State = "not_configured"
			if h.Configured {
				h.State = "verification_required"
			}
			if h.Simulated && p.Verified && p.Service != "" {
				h.State = "ready"
			}
		}
		out[name] = h
	}
	return out
}

// Checks describe one saved configuration and one environment. A successful
// simulator check must never appear as verification of changed or live settings.
func (a *App) savedShippingHealth(ctx context.Context, c calculatedConfig) (map[string]providerHealth, error) {
	out := a.shippingHealth(c)
	rows, e := a.Pool.Query(ctx, `SELECT DISTINCT ON (entity_id) entity_id,detail,
 (SELECT max(s.created_at) FROM audit_events s WHERE s.action='shipping.check'
 AND s.entity_id=a.entity_id AND s.detail->>'configVersion'=$1
 AND s.detail->>'simulated'=$2 AND s.detail->>'lastSuccess'<>'')
 FROM audit_events a WHERE action='shipping.check' AND detail->>'configVersion'=$1
 AND detail->>'simulated'=$2 ORDER BY entity_id,created_at DESC,id DESC`,
		fmt.Sprint(c.Version), fmt.Sprint(a.simulatedShipping()))
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	for rows.Next() {
		var name string
		var raw []byte
		var last *time.Time
		if e = rows.Scan(&name, &raw, &last); e != nil {
			return nil, e
		}
		h, ok := out[name]
		if !ok {
			continue
		}
		var saved providerHealth
		if e = json.Unmarshal(raw, &saved); e != nil {
			return nil, e
		}
		h.Error = saved.Error
		if last != nil {
			h.LastSuccess = last.UTC().Format(time.RFC3339)
		}
		out[name] = h
	}
	return out, rows.Err()
}
func catalogMeasurementIssues(ctx context.Context, q querier) ([]map[string]any, error) {
	rows, e := q.Query(ctx, "SELECT id,name,content FROM products WHERE status='published' AND NOT coalesce((content->>'outOfStock')::boolean,false)")
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var id, name string
		var raw []byte
		if e = rows.Scan(&id, &name, &raw); e != nil {
			return nil, e
		}
		var p domain.Product
		if e = json.Unmarshal(raw, &p); e != nil {
			return nil, e
		}
		p.EnsurePackages()
		for _, v := range p.Packages {
			if issues := v.MeasurementIssues(); len(issues) > 0 {
				out = append(out, map[string]any{"productId": id, "name": name, "packageId": v.ID, "fields": issues})
			}
		}
	}
	return out, rows.Err()
}
func (a *App) activationBlockers(ctx context.Context, q querier, c calculatedConfig) ([]string, error) {
	out := []string{}
	if c.Origin.Validate() != nil || !c.Origin.PinConfirmed || c.Origin.Latitude == nil {
		out = append(out, "نشانی و موقعیت تأییدشده مبدأ را کامل کنید")
	}
	loc, ok := findLocality(c, c.Origin)
	if !ok || domain.Normalize(loc.City) != "تهران" {
		out = append(out, "مبدأ باید شهر تهران با شناسه محلی تأییدشده باشد")
	}
	active := 0
	for _, b := range c.Boxes {
		if b.Active && b.Verified && b.Validate() == nil && b.PostalSizeID != "" {
			active++
		}
	}
	if active == 0 {
		out = append(out, "حداقل یک کارتن اندازه‌گیری‌شده و نگاشت پستی لازم است")
	}
	for name, p := range map[string]providerConfig{"snapp": c.Snapp, "tapin": c.Tapin} {
		if !p.Enabled || !p.Verified || p.Service == "" || (p.Currency != "rial" && p.Currency != "toman") {
			out = append(out, "تنظیمات و واحد پول "+name+" تأیید نشده است")
		}
	}
	if c.Tapin.ShopID == "" {
		out = append(out, "شناسه فروشگاه پستی لازم است")
	}
	if c.Snapp.CityID == "" || len(c.Snapp.Area) < 3 || c.Snapp.MaxGrams < 1 || c.Snapp.MaxVolumeCm3 < 1 || c.Snapp.MaxParcels < 1 || !c.Snapp.MaxSize.Valid() {
		out = append(out, "محدوده خدمت و ظرفیت پیک را تأیید کنید")
	}
	if c.Tapin.MaxGrams < 1 || !c.Tapin.MaxSize.Valid() {
		out = append(out, "ظرفیت و ابعاد پستی را تأیید کنید")
	}
	if !a.simulatedShipping() {
		out = append(out, "ارسال زنده تا تأیید قرارداد احراز هویت و عملیات ارائه‌دهندگان غیرفعال است")
	}
	missing, e := catalogMeasurementIssues(ctx, q)
	if e != nil {
		return nil, e
	}
	if len(missing) > 0 {
		out = append(out, "اطلاعات ارسال محصولات منتشرشده ناقص است")
	}
	return out, nil
}
func findLocality(c calculatedConfig, a domain.Address) (locality, bool) {
	for _, l := range c.Localities {
		if l.ID == a.CityID && l.ProvinceID == a.ProvinceID && l.City == a.City && l.Province == a.Province {
			return l, l.Verified
		}
	}
	return locality{}, false
}
func (a *App) localities(w http.ResponseWriter, r *http.Request) {
	c, e := readShippingConfig(r.Context(), a.Pool, false)
	if e != nil {
		a.dbError(w, e)
		return
	}
	out := []locality{}
	query := domain.Normalize(r.URL.Query().Get("q"))
	for _, l := range c.Localities {
		if (r.URL.Query().Get("provinceId") == "" || l.ProvinceID == r.URL.Query().Get("provinceId")) && strings.Contains(domain.Normalize(l.Province+" "+l.City), query) {
			l.TapinProvince = ""
			l.TapinCity = ""
			out = append(out, l)
		}
	}
	write(w, 200, out)
}
func validateConfig(c calculatedConfig) error {
	if c.Mode != "legacy" && c.Mode != "calculated" {
		return errors.New("روش محاسبه معتبر نیست")
	}
	if len(c.Boxes) > 100 || len(c.Localities) > 10000 {
		return errors.New("تعداد تنظیمات بیش از حد است")
	}
	ids := map[string]bool{}
	for _, b := range c.Boxes {
		if b.ID == "" || ids[b.ID] {
			return errors.New("شناسه کارتن تکراری است")
		}
		ids[b.ID] = true
		if b.Active || b.Verified {
			if e := b.Validate(); e != nil {
				return e
			}
			if !b.Verified || b.PostalSizeID == "" {
				return errors.New("کارتن فعال به تأیید اندازه و شناسه پستی نیاز دارد")
			}
		}
	}
	ids = map[string]bool{}
	for _, l := range c.Localities {
		if l.ID == "" || l.ProvinceID == "" || l.City == "" || l.Province == "" || ids[l.ID] {
			return errors.New("فهرست شهرها معتبر نیست")
		}
		ids[l.ID] = true
		if l.Verified && (l.TapinCity == "" || l.TapinProvince == "") {
			return errors.New("نگاشت پستی شهر تأیید نشده است")
		}
	}
	for _, p := range []providerConfig{c.Snapp, c.Tapin} {
		if len(p.Area) > 1000 || p.MaxGrams < 0 || p.MaxGrams > 1000000 || p.MaxVolumeCm3 < 0 || p.MaxVolumeCm3 > 27000000000 || p.MaxParcels < 0 || p.MaxParcels > 20 {
			return errors.New("ظرفیت ارائه‌دهنده معتبر نیست")
		}
		for _, v := range p.Area {
			if v[0] < 24 || v[0] > 40 || v[1] < 44 || v[1] > 64 {
				return errors.New("محدوده خدمت داخل ایران باشد")
			}
		}
	}
	return nil
}
func (a *App) checkShippingProvider(w http.ResponseWriter, r *http.Request) {
	c, e := readShippingConfig(r.Context(), a.Pool, false)
	if e != nil {
		a.dbError(w, e)
		return
	}
	name := r.PathValue("provider")
	h, ok := a.shippingHealth(c)[name]
	if !ok {
		fail(w, 404, "ارائه‌دهنده پیدا نشد")
		return
	}
	if h.State == "ready" {
		h.LastSuccess = time.Now().UTC().Format(time.RFC3339)
	} else {
		h.Error = "پیکربندی حساب زنده تأیید نشده؛ هیچ ارسال یا خریدی انجام نشد"
	}
	if e = auditHealth(r, a, h, name, c.Version); e != nil {
		a.dbError(w, e)
		return
	}
	write(w, 200, h)
}
func auditHealth(r *http.Request, a *App, h providerHealth, name string, version int64) error {
	raw, _ := json.Marshal(struct {
		providerHealth
		ConfigVersion int64 `json:"configVersion"`
	}{h, version})
	_, e := a.Pool.Exec(r.Context(), "INSERT INTO audit_events(staff_id,action,entity_id,detail) VALUES($1,'shipping.check',$2,$3)", current(r).StaffID, name, raw)
	return e
}
