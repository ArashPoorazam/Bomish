package app

import (
	"bomish/internal/domain"
	"net/http"
	"time"
)

func (a *App) recordEvent(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Kind      string `json:"kind"`
		ProductID string `json:"productId"`
		Query     string `json:"query"`
	}
	if !decode(w, r, &in) {
		return
	}
	in.Query = domain.Normalize(in.Query)
	if (in.Kind != "view" && in.Kind != "search" && in.Kind != "click") || (in.Kind == "search" && (len([]rune(in.Query)) < 2 || len([]rune(in.Query)) > 120)) {
		fail(w, 400, "رویداد معتبر نیست")
		return
	}
	if current(r).StaffID != "" {
		write(w, 200, map[string]bool{"ok": true})
		return
	}
	if !a.limit(r, "analytics-ip:"+ip(r), 300, time.Hour) || !a.limit(r, "analytics:"+current(r).Hash+":"+in.Kind+":"+in.ProductID+in.Query, 1, 30*time.Minute) {
		write(w, 200, map[string]bool{"ok": true})
		return
	}
	var product any
	if in.Kind == "view" || in.Kind == "click" {
		var exists bool
		if a.Pool.QueryRow(r.Context(), "SELECT EXISTS(SELECT 1 FROM products WHERE id=$1 AND status='published')", in.ProductID).Scan(&exists) != nil || !exists {
			fail(w, 404, "محصول پیدا نشد")
			return
		}
		product = in.ProductID
		in.Query = ""
	}
	_, e := a.Pool.Exec(r.Context(), "INSERT INTO analytics_events(kind,product_id,query,session_hash) VALUES($1,$2,$3,$4)", in.Kind, product, in.Query, current(r).Hash)
	if e != nil {
		a.dbError(w, e)
		return
	}
	write(w, 200, map[string]bool{"ok": true})
}
func (a *App) deleteCategory(w http.ResponseWriter, r *http.Request) {
	tx, e := a.Pool.Begin(r.Context())
	if e != nil {
		a.dbError(w, e)
		return
	}
	defer tx.Rollback(r.Context())
	tag, e := tx.Exec(r.Context(), "DELETE FROM categories WHERE id=$1 AND NOT EXISTS(SELECT 1 FROM products WHERE category_id=$1) AND NOT EXISTS(SELECT 1 FROM product_drafts WHERE content->>'categoryId'=$1)", r.PathValue("id"))
	if e != nil {
		a.dbError(w, e)
		return
	}
	if tag.RowsAffected() == 0 {
		fail(w, 409, "ابتدا محصولات این دسته را به دسته دیگری منتقل کنید")
		return
	}
	if e = auditDetail(r.Context(), tx, current(r).StaffID, "category.delete", r.PathValue("id"), map[string]string{}); e == nil {
		e = tx.Commit(r.Context())
	}
	if e != nil {
		a.dbError(w, e)
		return
	}
	write(w, 200, map[string]bool{"ok": true})
}
