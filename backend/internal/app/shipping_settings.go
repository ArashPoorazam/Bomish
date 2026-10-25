package app

import (
	"encoding/json"
	"net/http"

	"bomish/internal/httpx"
)

type shippingConfig struct {
	BoxDefaults boxDefaults       `json:"boxDefaults"`
	Readiness   []readinessIssue  `json:"readiness"`
	BoxCatalog  []boxCatalogEntry `json:"boxCatalog"`
	Simulated   bool              `json:"simulated"`
	calculatedConfig
	Blockers            []string                  `json:"blockers,omitempty"`
	MissingMeasurements []map[string]any          `json:"missingMeasurements,omitempty"`
	Providers           map[string]providerHealth `json:"providers,omitempty"`
	FreeShippingRials   int64                     `json:"freeShippingRials"`
	SupportURL          string                    `json:"supportUrl"`
}

func (a *App) shippingSettings(w http.ResponseWriter, r *http.Request) {
	v := shippingConfig{}
	e := a.Pool.QueryRow(r.Context(), "SELECT free_shipping_rials,support_url FROM settings WHERE id=true").Scan(&v.FreeShippingRials, &v.SupportURL)
	if e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	v.calculatedConfig, e = readShippingConfig(r.Context(), a.Pool, false)
	if e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	v.BoxDefaults, e = configuredBoxDefaults()
	if e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	v.Readiness, e = a.shippingReadiness(r.Context(), a.Pool, v.calculatedConfig)
	v.BoxCatalog = shippingBoxCatalog()
	v.Simulated = a.simulatedShipping()
	for _, issue := range v.Readiness {
		v.Blockers = append(v.Blockers, issue.Message)
	}
	if e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	v.MissingMeasurements, e = catalogMeasurementIssues(r.Context(), a.Pool)
	if e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	v.Providers, e = a.savedShippingHealth(r.Context(), v.calculatedConfig)
	if e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	httpx.JSON(w, 200, v)
}

func (a *App) saveShipping(w http.ResponseWriter, r *http.Request) {
	var v shippingConfig
	if !httpx.Decode(w, r, &v) {
		return
	}
	for _, box := range v.Boxes {
		if box.Simulated && box.Active && !a.simulatedShipping() {
			httpx.Error(w, 400, "کارتن آزمایشی فقط در شبیه‌سازی قابل استفاده است")
			return
		}
	}
	if v.FreeShippingRials < 0 || v.FreeShippingRials > 100000000000 || !validSupportURL(v.SupportURL) {
		httpx.Error(w, 400, "تنظیمات ارسال معتبر نیست")
		return
	}
	tx, e := a.Pool.Begin(r.Context())
	if e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	defer tx.Rollback(r.Context())
	var previousRaw []byte
	var version int64
	e = tx.QueryRow(r.Context(), "SELECT version,content FROM shipping_configuration WHERE id=true FOR UPDATE").Scan(&version, &previousRaw)
	if e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	if v.Version != version {
		shippingError(w, 409, "stale_version", "تنظیمات توسط همکار تغییر کرده؛ نسخه تازه را دریافت کنید")
		return
	}
	// Technical settings are owned by the configuration file, never by a browser draft.
	var previous calculatedConfig
	if e = json.Unmarshal(previousRaw, &previous); e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	v.Localities, v.Snapp, v.Tapin = previous.Localities, previous.Snapp, previous.Tapin
	// Browser edits can change physical measurements, but never provider mappings.
	savedSizes := postalBoxSizes(previous)
	for i := range v.Boxes {
		size, exists := savedSizes[v.Boxes[i].ID]
		v.Boxes[i].PostalSizeID = size
		if !exists && v.Boxes[i].Simulated && a.simulatedShipping() {
			v.Boxes[i].PostalSizeID = "sim-box"
		}
	}
	if e = applyBoxDefaults(&v.calculatedConfig); e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	if e = validateConfig(v.calculatedConfig); e != nil {
		httpx.Error(w, 400, e.Error())
		return
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
		httpx.DatabaseError(w, e)
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
		httpx.DatabaseError(w, e)
		return
	}
	httpx.JSON(w, 200, map[string]bool{"ok": true})
}
