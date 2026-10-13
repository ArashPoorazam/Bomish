package app

import (
	"bomish/internal/domain"
	"encoding/json"
	"github.com/jackc/pgx/v5"
	"io"
	"net/http"
	"strings"
)

func (a *App) staffOrders(w http.ResponseWriter, r *http.Request) {
	page, size := pageArgs(r)
	q := r.URL.Query()
	status, search := q.Get("status"), q.Get("q")
	v, e := loadOrderPage(r.Context(), a.Pool, "", "", status, search, size, (page-1)*size, q.Get("provider"), q.Get("attention"))
	if e != nil {
		a.dbError(w, e)
		return
	}
	var total int64
	e = a.Pool.QueryRow(r.Context(), `SELECT count(*) FROM orders WHERE ($1='' OR status=$1 OR ($1='active' AND status IN ('paid','packing','shipped','review'))) AND ($2='' OR id||' '||address::text||' '||tracking ILIKE '%'||$2||'%')`+deliveryFilterSQL(3, 4), status, search, q.Get("provider"), q.Get("attention")).Scan(&total)
	if e != nil {
		a.dbError(w, e)
		return
	}
	listResponse(w, r, v, total)
}
func (a *App) updateOrder(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Status   string `json:"status"`
		Tracking string `json:"tracking"`
	}
	if !decode(w, r, &in) {
		return
	}
	if in.Status != "packing" && in.Status != "shipped" && in.Status != "received" {
		fail(w, 400, "وضعیت مجاز نیست")
		return
	}
	in.Tracking = domain.Normalize(strings.TrimSpace(in.Tracking))
	var calculated bool
	if e := a.Pool.QueryRow(r.Context(), "SELECT EXISTS(SELECT 1 FROM order_shipping WHERE order_id=$1)", r.PathValue("id")).Scan(&calculated); e != nil {
		a.dbError(w, e)
		return
	}
	if !calculated && in.Status == "shipped" && !validTracking(in.Tracking) {
		fail(w, 400, "کد رهگیری لازم است")
		return
	}
	tx, e := a.Pool.Begin(r.Context())
	if e != nil {
		a.dbError(w, e)
		return
	}
	defer tx.Rollback(r.Context())
	// Checklist edits lock the same order, making validation and confirmation atomic.
	var currentStatus string
	if e = tx.QueryRow(r.Context(), "SELECT status FROM orders WHERE id=$1 FOR UPDATE", r.PathValue("id")).Scan(&currentStatus); e != nil {
		if e == pgx.ErrNoRows {
			fail(w, 404, "سفارش پیدا نشد")
			return
		}
		a.dbError(w, e)
		return
	}
	if !calculated && (in.Status == "packing" || in.Status == "shipped") {
		var complete bool
		if e = tx.QueryRow(r.Context(), "SELECT count(*)>0 AND coalesce(bool_and(packed),false) FROM order_items WHERE order_id=$1", r.PathValue("id")).Scan(&complete); e != nil {
			a.dbError(w, e)
			return
		}
		if !complete {
			fail(w, 409, "همه ردیف‌های سفارش را در چک‌لیست بسته‌بندی تأیید کنید")
			return
		}
	}
	if calculated {
		d, err := loadDelivery(r.Context(), tx, r.PathValue("id"), true)
		if err != nil {
			a.dbError(w, err)
			return
		}
		if in.Status == "packing" || d.Method != "post" {
			fail(w, 409, "از پنل ارسال و تأیید آمادگی استفاده کنید")
			return
		}
		if in.Status == "shipped" {
			if !d.Ready || currentStatus != "packing" {
				fail(w, 409, "آمادگی ارسال کامل نیست")
				return
			}
			if err = readyValidation(r.Context(), tx, d); err != nil {
				fail(w, 409, err.Error())
				return
			}
			for _, p := range d.Parcels {
				if !validTracking(p.Tracking) {
					fail(w, 409, "بارکد همه کارتن‌ها لازم است")
					return
				}
			}
			in.Tracking = d.Parcels[0].Tracking
			d.Status = "picked_up"
		}
		if in.Status == "received" {
			if currentStatus != "shipped" {
				fail(w, 409, "ابتدا همه کارتن‌ها را ارسال کنید")
				return
			}
			d.Status = "delivered"
		}
		if e = saveDelivery(r.Context(), tx, d); e != nil {
			a.dbError(w, e)
			return
		}
		if _, e = tx.Exec(r.Context(), "INSERT INTO delivery_events(order_id,event_key,status,actor) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING", d.OrderID, d.OrderID+":postal:"+d.Status, d.Status, current(r).StaffID); e != nil {
			a.dbError(w, e)
			return
		}
	}
	previous := "paid"
	if in.Status == "shipped" {
		previous = "packing"
	}
	if in.Status == "received" {
		previous = "shipped"
	}
	tag, e := tx.Exec(r.Context(), "UPDATE orders SET status=$1,tracking=CASE WHEN $1='shipped' THEN $2 ELSE tracking END WHERE id=$3 AND status=$4", in.Status, in.Tracking, r.PathValue("id"), previous)
	if e != nil || tag.RowsAffected() == 0 {
		fail(w, 409, "تغییر وضعیت سفارش مجاز نیست")
		return
	}
	if e = queueOrderSMS(r.Context(), tx, r.PathValue("id"), in.Status); e != nil {
		a.dbError(w, e)
		return
	}
	if e = auditDetail(r.Context(), tx, current(r).StaffID, "order."+in.Status, r.PathValue("id"), map[string]string{"before": previous, "after": in.Status, "tracking": in.Tracking}); e == nil {
		e = tx.Commit(r.Context())
	}
	if e != nil {
		a.dbError(w, e)
		return
	}
	write(w, 200, map[string]bool{"ok": true})
}

type shippingRule struct {
	ID       string `json:"id,omitempty"`
	Province string `json:"province"`
	MaxGrams int64  `json:"maxGrams"`
	FeeRials int64  `json:"feeRials"`
}
type shippingConfig struct {
	Readiness  []readinessIssue  `json:"readiness"`
	BoxCatalog []boxCatalogEntry `json:"boxCatalog"`
	Simulated  bool              `json:"simulated"`
	calculatedConfig
	Blockers            []string                  `json:"blockers,omitempty"`
	MissingMeasurements []map[string]any          `json:"missingMeasurements,omitempty"`
	Providers           map[string]providerHealth `json:"providers,omitempty"`
	FreeShippingRials   int64                     `json:"freeShippingRials"`
	SupportURL          string                    `json:"supportUrl"`
	PackagingGrams      int64                     `json:"packagingGrams"`
	Rules               []shippingRule            `json:"rules"`
}

func (a *App) shippingSettings(w http.ResponseWriter, r *http.Request) {
	v := shippingConfig{Rules: []shippingRule{}}
	e := a.Pool.QueryRow(r.Context(), "SELECT packaging_grams,free_shipping_rials,support_url FROM settings WHERE id=true").Scan(&v.PackagingGrams, &v.FreeShippingRials, &v.SupportURL)
	if e != nil {
		a.dbError(w, e)
		return
	}
	rows, e := a.Pool.Query(r.Context(), "SELECT id,province,max_grams,fee_rials FROM shipping_rules ORDER BY province,max_grams")
	if e != nil {
		a.dbError(w, e)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var x shippingRule
		if e = rows.Scan(&x.ID, &x.Province, &x.MaxGrams, &x.FeeRials); e != nil {
			a.dbError(w, e)
			return
		}
		v.Rules = append(v.Rules, x)
	}
	if e = rows.Err(); e != nil {
		a.dbError(w, e)
		return
	}
	rows.Close()
	v.calculatedConfig, e = readShippingConfig(r.Context(), a.Pool, false)
	if e != nil {
		a.dbError(w, e)
		return
	}
	v.Readiness, e = a.shippingReadiness(r.Context(), a.Pool, v.calculatedConfig)
	v.BoxCatalog = shippingBoxCatalog()
	v.Simulated = a.simulatedShipping()
	for _, issue := range v.Readiness {
		v.Blockers = append(v.Blockers, issue.Message)
	}
	if e != nil {
		a.dbError(w, e)
		return
	}
	v.MissingMeasurements, e = catalogMeasurementIssues(r.Context(), a.Pool)
	if e != nil {
		a.dbError(w, e)
		return
	}
	v.Providers, e = a.savedShippingHealth(r.Context(), v.calculatedConfig)
	if e != nil {
		a.dbError(w, e)
		return
	}
	write(w, 200, v)
}
func (a *App) saveShipping(w http.ResponseWriter, r *http.Request) {
	var v shippingConfig
	if !decode(w, r, &v) {
		return
	}
	for _, box := range v.Boxes {
		if box.Simulated && box.Active && !a.simulatedShipping() {
			fail(w, 400, "کارتن آزمایشی فقط در شبیه‌سازی قابل استفاده است")
			return
		}
	}
	if v.FreeShippingRials < 0 || v.FreeShippingRials > 100000000000 || !validSupportURL(v.SupportURL) {
		fail(w, 400, "تنظیمات ارسال معتبر نیست")
		return
	}
	tx, e := a.Pool.Begin(r.Context())
	if e != nil {
		a.dbError(w, e)
		return
	}
	defer tx.Rollback(r.Context())
	var previousRaw []byte
	var version int64
	e = tx.QueryRow(r.Context(), "SELECT version,content FROM shipping_configuration WHERE id=true FOR UPDATE").Scan(&version, &previousRaw)
	if e != nil {
		a.dbError(w, e)
		return
	}
	if v.Version != version {
		shippingError(w, 409, "stale_version", "تنظیمات توسط همکار تغییر کرده؛ نسخه تازه را دریافت کنید")
		return
	}
	// Technical settings are owned by the configuration file, never by a browser draft.
	var previous calculatedConfig
	if e = json.Unmarshal(previousRaw, &previous); e != nil {
		a.dbError(w, e)
		return
	}
	v.Mode, v.Localities, v.Snapp, v.Tapin = previous.Mode, previous.Localities, previous.Snapp, previous.Tapin
	// Browser edits can change physical measurements, but never provider mappings.
	savedSizes := postalBoxSizes(previous)
	for i := range v.Boxes {
		size, exists := savedSizes[v.Boxes[i].ID]
		v.Boxes[i].PostalSizeID = size
		if !exists && v.Boxes[i].Simulated && a.simulatedShipping() {
			v.Boxes[i].PostalSizeID = "sim-box"
		}
	}
	if e = validateConfig(v.calculatedConfig); e != nil {
		fail(w, 400, e.Error())
		return
	}
	if v.Mode == "calculated" {
		blockers, err := a.activationBlockers(r.Context(), tx, v.calculatedConfig)
		if err != nil {
			a.dbError(w, err)
			return
		}
		if len(blockers) > 0 {
			write(w, 422, map[string]any{"code": "activation_blocked", "error": "پیش‌نیازهای فعال‌سازی کامل نیست", "blockers": blockers})
			return
		}
	}
	before, _ := json.Marshal(previous.Origin)
	after, _ := json.Marshal(v.Origin)
	v.OriginRevision = previous.OriginRevision
	if string(before) != string(after) {
		v.OriginRevision++
	}
	v.Version = version + 1
	raw, _ := json.Marshal(v.calculatedConfig)
	_, e = tx.Exec(r.Context(), "INSERT INTO shipping_configuration_history(version,content,actor) VALUES($1,$2,$3)", v.Version, raw, current(r).StaffID)
	if e == nil {
		_, e = tx.Exec(r.Context(), "UPDATE shipping_configuration SET version=$1,content=$2,updated_at=now() WHERE id=true", v.Version, raw)
	}
	if e != nil {
		a.dbError(w, e)
		return
	}
	_, e = tx.Exec(r.Context(), "UPDATE settings SET free_shipping_rials=$1,support_url=$2 WHERE id=true", v.FreeShippingRials, v.SupportURL)
	if e == nil {
		e = audit(r, tx, "shipping.update", "settings")
	}
	if e == nil {
		e = tx.Commit(r.Context())
	}
	if e != nil {
		a.dbError(w, e)
		return
	}
	write(w, 200, map[string]bool{"ok": true})
}
func (a *App) upload(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 8<<20)
	if e := r.ParseMultipartForm(8 << 20); e != nil {
		fail(w, 400, "حجم تصویر باید کمتر از ۸ مگابایت باشد")
		return
	}
	defer r.MultipartForm.RemoveAll()
	file, _, e := r.FormFile("image")
	if e != nil {
		fail(w, 400, "تصویر انتخاب نشده است")
		return
	}
	defer file.Close()
	data, e := io.ReadAll(file)
	if e != nil {
		fail(w, 400, "تصویر قابل خواندن نیست")
		return
	}
	mime := http.DetectContentType(data)
	ext := ""
	switch mime {
	case "image/jpeg":
		ext = ".jpg"
	case "image/png":
		ext = ".png"
	case "image/webp":
		ext = ".webp"
	default:
		fail(w, 400, "فقط تصویر JPEG، PNG یا WebP پذیرفته می‌شود")
		return
	}
	url, e := a.Uploads.Put(r.Context(), token()+ext, data, mime)
	if e != nil {
		a.dbError(w, e)
		return
	}
	if !domain.ValidImage(url) {
		fail(w, 500, "نشانی تصویر معتبر نیست")
		return
	}
	write(w, 201, map[string]string{"url": url})
}
