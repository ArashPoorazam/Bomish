package app

import (
	"bomish/internal/carrier"
	"bomish/internal/domain"
	"bomish/internal/packing"
	"context"
	"encoding/json"
	"errors"
	"github.com/jackc/pgx/v5"
	"net/http"
	"time"
)

type shippingSnapshot struct {
	Config           calculatedConfig `json:"config"`
	Destination      domain.Address   `json:"destination"`
	Algorithm        string           `json:"algorithm"`
	Method           string           `json:"method"`
	Service          string           `json:"service"`
	Parcels          []packing.Parcel `json:"parcels"`
	CarrierQuote     carrier.Quote    `json:"carrierQuote"`
	Totals           quoteResult      `json:"totals"`
	FallbackReason   string           `json:"fallbackReason"`
	FallbackAccepted bool             `json:"fallbackAccepted"`
}
type shippingQuoteInput struct {
	Province       string         `json:"province"`
	Address        domain.Address `json:"address"`
	DiscountCode   string         `json:"discountCode"`
	Method         string         `json:"method"`
	AcceptFallback bool           `json:"acceptFallback"`
}

func normalizedDestination(v domain.Address) domain.Address {
	v.ID = ""
	v.Phone = domain.Phone(v.Phone)
	v.PostalCode = domain.Normalize(v.PostalCode)
	return v
}
func quoteBinding(c domain.Cart, d domain.Address, code, method string, version int64) string {
	type line struct {
		ProductID       string
		Package         domain.Package
		Quantity, Price int64
		Available       bool
	}
	lines := []line{}
	for _, i := range c.Items {
		lines = append(lines, line{i.Product.ID, i.Package, i.Quantity, i.Product.PackagePrice(i.Package), i.Product.Status == "published" && !i.Product.OutOfStock})
	}
	raw, _ := json.Marshal(struct {
		Lines        []line
		Destination  domain.Address
		Code, Method string
		Version      int64
	}{lines, normalizedDestination(d), domain.Normalize(code), method, version})
	return hash(string(raw))
}
func cartUnits(c domain.Cart) ([]packing.Item, error) {
	out := []packing.Item{}
	for _, i := range c.Items {
		if i.Quantity < 1 || i.Quantity > i.Package.MaxQuantity || i.Product.Status != "published" || i.Product.OutOfStock {
			return nil, errUnavailable
		}
		if _, e := i.Package.GrossWeight(); e != nil {
			return nil, &packing.Failure{Code: "missing_measurements", Detail: e.Error()}
		}
		if int64(len(out))+i.Quantity > packing.MaxUnits {
			return nil, &packing.Failure{Code: "packing_limit", Detail: "تعداد بسته‌ها نیازمند بررسی دستی است"}
		}
		for n := 0; n < int(i.Quantity); n++ {
			out = append(out, i.Package.PackingItem(i.Product.ID, i.Product.Name, n, i.Product.PackagePrice(i.Package)))
		}
	}
	return out, nil
}
func insideArea(lat, lng float64, polygon [][2]float64) bool {
	inside := false
	j := len(polygon) - 1
	for i, p := range polygon {
		q := polygon[j]
		if ((p[0] > lat) != (q[0] > lat)) && (lng < (q[1]-p[1])*(lat-p[0])/(q[0]-p[0])+p[1]) {
			inside = !inside
		}
		j = i
	}
	return inside
}
func snappEligible(c calculatedConfig, d domain.Address, parcels []packing.Parcel) (bool, string) {
	if d.CityID != c.Snapp.CityID {
		return false, "پیک در این شهر فعال نیست"
	}
	if !d.PinConfirmed || d.Latitude == nil || d.Longitude == nil {
		return false, "موقعیت تحویل روی نقشه تأیید نشده است"
	}
	if !insideArea(*d.Latitude, *d.Longitude, c.Snapp.Area) {
		return false, "موقعیت خارج از محدوده پیک است"
	}
	var weight, volume int64
	for _, p := range parcels {
		weight += p.Weight()
		volume += p.Box.Outside.Volume()
		s := p.Box.Outside
		m := c.Snapp.MaxSize
		if s.Length > m.Length || s.Width > m.Width || s.Height > m.Height {
			return false, "ابعاد کارتن بیش از ظرفیت پیک است"
		}
	}
	if weight > c.Snapp.MaxGrams || volume > c.Snapp.MaxVolumeCm3*1000 || len(parcels) > c.Snapp.MaxParcels {
		return false, "حجم یا وزن سفارش بیش از ظرفیت پیک است"
	}
	return true, ""
}
func postalEligible(c calculatedConfig, d domain.Address, parcels []packing.Parcel) error {
	l, ok := findLocality(c, d)
	if !ok || l.TapinCity == "" || l.TapinProvince == "" {
		return &packing.Failure{Code: "unsupported_destination", Detail: "شهر و استان را از فهرست تأیید کنید"}
	}
	for _, p := range parcels {
		s, m := p.Box.Outside, c.Tapin.MaxSize
		if p.Box.PostalSizeID == "" || p.Weight() > c.Tapin.MaxGrams || s.Length > m.Length || s.Width > m.Width || s.Height > m.Height {
			return &packing.Failure{Code: "packing_limit", Detail: "کارتن از ظرفیت پستی تأییدشده خارج است"}
		}
	}
	return nil
}
func shippingRequest(s shippingSnapshot) carrier.Request {
	p := s.Config.Snapp
	if s.Method == "post" {
		p = s.Config.Tapin
	}
	l, _ := findLocality(s.Config, s.Destination)
	return carrier.Request{Origin: s.Config.Origin, Destination: s.Destination, Parcels: s.Parcels, Service: p.Service, ShopID: p.ShopID, ProvinceCode: l.TapinProvince, CityCode: l.TapinCity}
}
func (a *App) shippingProvider(method string) carrier.Quoter {
	if a.ShippingProvider != nil {
		return a.ShippingProvider
	}
	if a.simulatedShipping() {
		return simulation{a: a, method: method}
	}
	return carrier.Disabled{}
}
func (a *App) courier() carrier.Courier {
	if a.ShippingProvider != nil {
		return a.ShippingProvider
	}
	if a.simulatedShipping() {
		return simulation{a: a, method: "snapp"}
	}
	return carrier.Disabled{}
}
func (a *App) calculateShipping(ctx context.Context, c domain.Cart, in shippingQuoteInput, cfg calculatedConfig) (shippingSnapshot, error) {
	s := shippingSnapshot{Config: cfg, Destination: normalizedDestination(in.Address), Algorithm: packing.Version}
	if e := s.Destination.Validate(); e != nil {
		return s, e
	}
	items, e := cartUnits(c)
	if e != nil {
		return s, e
	}
	s.Parcels, e = packing.Plan(items, cfg.Boxes)
	if e != nil {
		return s, e
	}
	if e = postalEligible(cfg, s.Destination, s.Parcels); e != nil {
		return s, e
	}
	eligible, reason := snappEligible(cfg, s.Destination, s.Parcels)
	s.Method = "post"
	s.FallbackReason = reason
	if in.Method != "" && in.Method != "snapp" && in.Method != "post" {
		return s, errors.New("روش ارسال معتبر نیست")
	}
	if eligible && in.Method != "post" {
		s.Method = "snapp"
	}
	if s.Method == "snapp" && (!cfg.Snapp.Enabled || !cfg.Snapp.Verified) {
		eligible = false
		s.Method = "post"
		s.FallbackReason = "سرویس پیک فعال نیست"
	}
	s.CarrierQuote, e = a.shippingProvider(s.Method).Quote(ctx, shippingRequest(s))
	if e != nil && s.Method == "snapp" {
		s.Method = "post"
		s.FallbackReason = "استعلام پیک در دسترس نیست"
		s.CarrierQuote, e = a.shippingProvider("post").Quote(ctx, shippingRequest(s))
	}
	if e != nil {
		return s, &packing.Failure{Code: "provider_unavailable", Detail: e.Error()}
	}
	if s.Method == "post" && (!cfg.Tapin.Enabled || !cfg.Tapin.Verified) {
		return s, &packing.Failure{Code: "provider_unavailable", Detail: "سرویس پستی فعال نیست"}
	}
	s.FallbackAccepted = in.AcceptFallback || s.Destination.CityID != cfg.Snapp.CityID || s.Method == "snapp"
	if s.Method == "post" && in.Method == "post" && s.FallbackReason == "" {
		s.FallbackReason = "پست به انتخاب شما"
	}
	p := cfg.Tapin
	if s.Method == "snapp" {
		p = cfg.Snapp
	}
	s.Service = p.Service
	if s.CarrierQuote.CostRials < 0 || s.CarrierQuote.CostRials > 100000000000 {
		return s, carrier.ErrUnavailable
	}
	s.Totals = quoteResult{SubtotalRials: c.SubtotalRials}
	var threshold int64
	if e = a.Pool.QueryRow(ctx, "SELECT free_shipping_rials FROM settings WHERE id=true").Scan(&threshold); e != nil {
		return s, e
	}
	s.Totals.ShippingRials = carrier.CustomerCharge(s.CarrierQuote.CostRials, c.SubtotalRials, threshold)
	s.Totals.TotalRials = c.SubtotalRials + s.Totals.ShippingRials
	for _, p := range s.Parcels {
		s.Totals.WeightGrams += p.Weight()
	}
	e = applyDiscount(ctx, a.Pool, &s.Totals, in.DiscountCode, false)
	return s, e
}
func (a *App) calculatedQuote(w http.ResponseWriter, r *http.Request, c domain.Cart, in shippingQuoteInput, cfg calculatedConfig) {
	s, e := a.calculateShipping(r.Context(), c, in, cfg)
	if e != nil {
		code := "provider_unavailable"
		var f *packing.Failure
		if errors.As(e, &f) {
			code = f.Code
		}
		shippingError(w, 422, code, e.Error())
		return
	}
	id := token()
	expires := time.Now().Add(5 * time.Minute)
	if !s.CarrierQuote.ExpiresAt.IsZero() && s.CarrierQuote.ExpiresAt.Before(expires) {
		expires = s.CarrierQuote.ExpiresAt
	}
	s.Totals.ShippingQuoteID = id
	s.Totals.ExpiresAt = expires.Format(time.RFC3339)
	s.Totals.Method = s.Method
	s.Totals.Service = s.Service
	s.Totals.ParcelCount = len(s.Parcels)
	s.Totals.Simulated = s.CarrierQuote.Simulated
	s.Totals.FallbackReason = s.FallbackReason
	s.Totals.RequiresAcceptance = !s.FallbackAccepted
	raw, _ := json.Marshal(s)
	_, e = a.Pool.Exec(r.Context(), "INSERT INTO shipping_quotes(id,user_id,binding,config_version,snapshot,expires_at) VALUES($1,$2,$3,$4,$5,$6)", id, current(r).UserID, quoteBinding(c, in.Address, in.DiscountCode, s.Method, cfg.Version), cfg.Version, raw, expires)
	if e != nil {
		a.dbError(w, e)
		return
	}
	write(w, 200, s.Totals)
}
func validateCheckoutQuote(ctx context.Context, tx pgx.Tx, user, id, method string, c domain.Cart, d domain.Address, code string, cfg calculatedConfig) (shippingSnapshot, error) {
	var s shippingSnapshot
	var binding string
	var raw []byte
	var expires time.Time
	var version int64
	var order *string
	e := tx.QueryRow(ctx, "SELECT binding,snapshot,expires_at,config_version,order_id FROM shipping_quotes WHERE id=$1 AND user_id=$2 FOR UPDATE", id, user).Scan(&binding, &raw, &expires, &version, &order)
	if e != nil {
		return s, errors.New("استعلام ارسال پیدا نشد؛ دوباره محاسبه کنید")
	}
	if e = json.Unmarshal(raw, &s); e != nil {
		return s, e
	}
	if order != nil || time.Now().After(expires) || version != cfg.Version || method != s.Method || !s.FallbackAccepted || binding != quoteBinding(c, d, code, method, cfg.Version) {
		return s, errors.New("استعلام ارسال منقضی یا تغییر کرده؛ دوباره بررسی کنید")
	}
	if _, e = cartUnits(c); e != nil {
		return s, e
	}
	return s, nil
}
func (a *App) shippingPreview(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Items []struct {
			ProductID string `json:"productId"`
			PackageID string `json:"packageId"`
			Quantity  int64  `json:"quantity"`
		} `json:"items"`
		Address domain.Address `json:"address"`
	}
	if !decode(w, r, &in) {
		return
	}
	c := domain.Cart{}
	for _, v := range in.Items {
		var raw []byte
		var status string
		e := a.Pool.QueryRow(r.Context(), "SELECT content,status FROM products WHERE id=$1", v.ProductID).Scan(&raw, &status)
		if e != nil {
			fail(w, 400, "محصول پیدا نشد")
			return
		}
		var p domain.Product
		json.Unmarshal(raw, &p)
		p.ID = v.ProductID
		p.Status = status
		pack, ok := p.Package(v.PackageID)
		if !ok {
			fail(w, 400, "بسته پیدا نشد")
			return
		}
		total := p.PackagePrice(pack) * v.Quantity
		c.Items = append(c.Items, domain.CartItem{Product: p, Package: pack, Quantity: v.Quantity, TotalRials: total})
		c.SubtotalRials += total
	}
	cfg, e := readShippingConfig(r.Context(), a.Pool, false)
	if e != nil {
		a.dbError(w, e)
		return
	}
	s, e := a.calculateShipping(r.Context(), c, shippingQuoteInput{Address: in.Address}, cfg)
	if e != nil {
		shippingError(w, 422, "preview_unavailable", e.Error())
		return
	}
	write(w, 200, s)
}
