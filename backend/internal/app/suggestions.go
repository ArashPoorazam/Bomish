package app

import "net/http"

func (a *App) suggestions(w http.ResponseWriter, r *http.Request) {
	rows, e := queryMaps(r.Context(), a.Pool, `SELECT s.product_id AS id,p.name,p.status,s.position FROM product_suggestions s JOIN products p ON p.id=s.product_id ORDER BY position`)
	if e != nil {
		a.dbError(w, e)
		return
	}
	write(w, 200, rows)
}
func (a *App) saveSuggestions(w http.ResponseWriter, r *http.Request) {
	var in struct {
		IDs []string `json:"productIds"`
	}
	if !decode(w, r, &in) {
		return
	}
	if in.IDs == nil || len(in.IDs) > 12 {
		fail(w, 400, "حداکثر ۱۲ محصول انتخاب کنید")
		return
	}
	seen := map[string]bool{}
	for _, id := range in.IDs {
		if id == "" || seen[id] {
			fail(w, 400, "محصول تکراری یا نامعتبر است")
			return
		}
		seen[id] = true
	}
	tx, e := a.Pool.Begin(r.Context())
	if e != nil {
		a.dbError(w, e)
		return
	}
	defer tx.Rollback(r.Context())
	// Serialize replacements, including empty lists.
	if _, e = tx.Exec(r.Context(), `SELECT id FROM settings WHERE id=true FOR UPDATE`); e != nil {
		a.dbError(w, e)
		return
	}
	var valid int
	if e = tx.QueryRow(r.Context(), `SELECT count(*) FROM products WHERE id=ANY($1::text[]) AND status='published'`, in.IDs).Scan(&valid); e != nil {
		a.dbError(w, e)
		return
	}
	if valid != len(in.IDs) {
		fail(w, 400, "فقط محصولات منتشرشده را انتخاب کنید")
		return
	}
	if _, e = tx.Exec(r.Context(), `DELETE FROM product_suggestions`); e != nil {
		a.dbError(w, e)
		return
	}
	if _, e = tx.Exec(r.Context(), `INSERT INTO product_suggestions(product_id,position) SELECT id,position-1 FROM unnest($1::text[]) WITH ORDINALITY AS selected(id,position)`, in.IDs); e != nil {
		a.dbError(w, e)
		return
	}
	if e = auditDetail(r.Context(), tx, current(r).StaffID, "store.suggestions", "home", in); e == nil {
		e = tx.Commit(r.Context())
	}
	if e != nil {
		a.dbError(w, e)
		return
	}
	write(w, 200, map[string]bool{"ok": true})
}
