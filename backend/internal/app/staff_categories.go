package app

import (
	"net/http"
	"strings"

	"bomish/internal/database"
	"bomish/internal/httpx"
)

func (a *App) saveCategory(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Name        string `json:"name"`
		Description string `json:"description"`
	}
	if !httpx.Decode(w, r, &in) {
		return
	}
	if strings.TrimSpace(in.Name) == "" {
		httpx.Error(w, 400, "نام دسته لازم است")
		return
	}
	tx, e := a.Pool.Begin(r.Context())
	if e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	defer tx.Rollback(r.Context())
	if !authorizeCatalogSave(w, r, tx, "categories", "categories", r.PathValue("id")) {
		return
	}
	before, e := database.QueryMaps(r.Context(), tx, "SELECT name,description FROM categories WHERE id=$1", r.PathValue("id"))
	if e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	_, e = tx.Exec(r.Context(), "INSERT INTO categories(id,name,description) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET name=excluded.name,description=excluded.description", r.PathValue("id"), in.Name, in.Description)
	if e == nil {
		e = auditDetail(r.Context(), tx, current(r).StaffID, "category.save", r.PathValue("id"), map[string]any{"before": before, "after": in})
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

func (a *App) deleteCategory(w http.ResponseWriter, r *http.Request) {
	switch r.PathValue("id") {
	case "spices", "herbs", "seeds":
		httpx.Error(w, 409, "دسته‌های اصلی صفحه نخست قابل حذف نیستند")
		return
	}

	tx, e := a.Pool.Begin(r.Context())
	if e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	defer tx.Rollback(r.Context())
	tag, e := tx.Exec(r.Context(), "DELETE FROM categories WHERE id=$1 AND NOT EXISTS(SELECT 1 FROM products WHERE category_id=$1) AND NOT EXISTS(SELECT 1 FROM product_drafts WHERE content->>'categoryId'=$1)", r.PathValue("id"))
	if e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	if tag.RowsAffected() == 0 {
		httpx.Error(w, 409, "ابتدا محصولات این دسته را به دسته دیگری منتقل کنید")
		return
	}
	if e = auditDetail(r.Context(), tx, current(r).StaffID, "category.delete", r.PathValue("id"), map[string]string{}); e == nil {
		e = tx.Commit(r.Context())
	}
	if e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	httpx.JSON(w, 200, map[string]bool{"ok": true})
}
