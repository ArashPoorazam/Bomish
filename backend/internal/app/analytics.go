package app

import (
	"net/http"
	"time"

	"bomish/internal/domain"
	"bomish/internal/httpx"
)

func (a *App) recordEvent(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Kind      string `json:"kind"`
		ProductID string `json:"productId"`
		Query     string `json:"query"`
	}
	if !httpx.Decode(w, r, &in) {
		return
	}
	in.Query = domain.Normalize(in.Query)
	if (in.Kind != "view" && in.Kind != "search" && in.Kind != "click") || (in.Kind == "search" && (len([]rune(in.Query)) < 2 || len([]rune(in.Query)) > 120)) {
		httpx.Error(w, 400, "رویداد معتبر نیست")
		return
	}
	if current(r).StaffID != "" {
		httpx.JSON(w, 200, map[string]bool{"ok": true})
		return
	}
	if !a.limit(r, "analytics-ip:"+httpx.ClientIP(r, a.TrustedProxies), 300, time.Hour) || !a.limit(r, "analytics:"+current(r).Hash+":"+in.Kind+":"+in.ProductID+in.Query, 1, 30*time.Minute) {
		httpx.JSON(w, 200, map[string]bool{"ok": true})
		return
	}
	var product any
	if in.Kind == "view" || in.Kind == "click" {
		var exists bool
		if a.Pool.QueryRow(r.Context(), "SELECT EXISTS(SELECT 1 FROM products WHERE id=$1 AND status='published')", in.ProductID).Scan(&exists) != nil || !exists {
			httpx.Error(w, 404, "محصول پیدا نشد")
			return
		}
		product = in.ProductID
		in.Query = ""
	}
	_, e := a.Pool.Exec(r.Context(), "INSERT INTO analytics_events(kind,product_id,query,session_hash) VALUES($1,$2,$3,$4)", in.Kind, product, in.Query, current(r).Hash)
	if e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	httpx.JSON(w, 200, map[string]bool{"ok": true})
}
