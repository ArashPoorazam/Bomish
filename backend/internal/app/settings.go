package app

import (
	"net/http"
	"net/url"
	"os"

	"bomish/internal/httpx"
)

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
		httpx.DatabaseError(w, e)
		return
	}
	if support == "" {
		support = os.Getenv("SUPPORT_URL")
	}
	if !validSupportURL(support) {
		support = ""
	}
	httpx.JSON(w, 200, map[string]any{"freeShippingRials": threshold, "supportUrl": support, "mapEnabled": os.Getenv("NESHAN_API_KEY") != "", "catalogOnly": a.CatalogOnly})
}
