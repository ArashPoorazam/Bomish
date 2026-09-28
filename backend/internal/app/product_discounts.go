package app

import (
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

type productDiscount struct {
	ID         string    `json:"id"`
	Name       string    `json:"name"`
	Percent    int64     `json:"percent"`
	ProductIDs []string  `json:"productIds"`
	Active     bool      `json:"active"`
	CreatedAt  time.Time `json:"createdAt"`
}

func (a *App) listProductDiscounts(w http.ResponseWriter, r *http.Request) {
	rows, e := a.Pool.Query(r.Context(), "SELECT id,name,percent,product_ids,active,created_at FROM product_discounts ORDER BY created_at DESC,id")
	if e != nil {
		a.dbError(w, e)
		return
	}
	defer rows.Close()
	out := []productDiscount{}
	for rows.Next() {
		var v productDiscount
		if e = rows.Scan(&v.ID, &v.Name, &v.Percent, &v.ProductIDs, &v.Active, &v.CreatedAt); e != nil {
			a.dbError(w, e)
			return
		}
		out = append(out, v)
	}
	if e = rows.Err(); e != nil {
		a.dbError(w, e)
		return
	}
	write(w, 200, out)
}

// Serialize group changes, then refresh both live products and their drafts in
// the same transaction. Removing one group leaves other active groups intact.
func refreshDiscountProducts(r *http.Request, tx pgx.Tx) error {
	if _, e := tx.Exec(r.Context(), "SELECT set_config('bomish.actor',$1,true)", current(r).StaffID); e != nil {
		return e
	}
	_, e := tx.Exec(r.Context(), `UPDATE products SET content=jsonb_set(content,'{discountPercent}',to_jsonb(product_discount_percent(id)),true),updated_at=now()
 WHERE coalesce((content->>'discountPercent')::bigint,0)<>product_discount_percent(id)`)
	if e != nil {
		return e
	}
	_, e = tx.Exec(r.Context(), `UPDATE product_drafts SET content=jsonb_set(content,'{discountPercent}',to_jsonb(product_discount_percent(product_id)),true)
 WHERE coalesce((content->>'discountPercent')::bigint,0)<>product_discount_percent(product_id)`)
	return e
}

func (a *App) createProductDiscount(w http.ResponseWriter, r *http.Request) {
	var in struct {
		ID         string   `json:"id"`
		Name       string   `json:"name"`
		Percent    int64    `json:"percent"`
		ProductIDs []string `json:"productIds"`
		All        bool     `json:"all"`
	}
	if !decode(w, r, &in) {
		return
	}
	in.Name = strings.TrimSpace(in.Name)
	if len(in.ID) == 0 || len(in.ID) > 100 || len([]rune(in.Name)) == 0 || len([]rune(in.Name)) > 120 || in.Percent < 1 || in.Percent > 90 || (!in.All && len(in.ProductIDs) == 0) || (in.All && len(in.ProductIDs) > 0) {
		fail(w, 400, "نام، درصد و محصولات تخفیف را بررسی کنید")
		return
	}
	tx, e := a.Pool.Begin(r.Context())
	if e != nil {
		a.dbError(w, e)
		return
	}
	defer tx.Rollback(r.Context())
	if _, e = tx.Exec(r.Context(), "SELECT pg_advisory_xact_lock(62026)"); e != nil {
		a.dbError(w, e)
		return
	}
	if in.ProductIDs == nil {
		in.ProductIDs = []string{}
	}
	rows, e := tx.Query(r.Context(), "SELECT id FROM products WHERE $1 OR id=ANY($2::text[]) ORDER BY id FOR UPDATE", in.All, in.ProductIDs)
	if e != nil {
		a.dbError(w, e)
		return
	}
	ids := []string{}
	for rows.Next() {
		var id string
		if e = rows.Scan(&id); e != nil {
			break
		}
		ids = append(ids, id)
	}
	if e == nil {
		e = rows.Err()
	}
	rows.Close()
	if e != nil {
		a.dbError(w, e)
		return
	}
	if len(ids) == 0 || (!in.All && len(ids) != len(in.ProductIDs)) {
		fail(w, 400, "محصولات انتخاب‌شده معتبر نیستند")
		return
	}
	_, e = tx.Exec(r.Context(), "INSERT INTO product_discounts(id,name,percent,product_ids) VALUES($1,$2,$3,$4)", in.ID, in.Name, in.Percent, ids)
	if e == nil {
		e = refreshDiscountProducts(r, tx)
	}
	if e == nil {
		e = audit(r, tx, "product-discount.create", in.ID)
	}
	if e == nil {
		e = tx.Commit(r.Context())
	}
	if e != nil {
		a.dbError(w, e)
		return
	}
	write(w, 201, map[string]any{"ok": true, "count": len(ids)})
}

func (a *App) changeProductDiscount(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Active *bool `json:"active"`
	}
	if r.Method == "PATCH" {
		if !decode(w, r, &in) {
			return
		}
		if in.Active == nil {
			fail(w, 400, "وضعیت تخفیف را مشخص کنید")
			return
		}
	}
	tx, e := a.Pool.Begin(r.Context())
	if e != nil {
		a.dbError(w, e)
		return
	}
	defer tx.Rollback(r.Context())
	if _, e = tx.Exec(r.Context(), "SELECT pg_advisory_xact_lock(62026)"); e != nil {
		a.dbError(w, e)
		return
	}
	id := r.PathValue("id")
	var ids []string
	e = tx.QueryRow(r.Context(), "SELECT product_ids FROM product_discounts WHERE id=$1 FOR UPDATE", id).Scan(&ids)
	if e == pgx.ErrNoRows {
		fail(w, 404, "تخفیف پیدا نشد")
		return
	}
	if e != nil {
		a.dbError(w, e)
		return
	}
	// Take the same product lock order as batch price changes.
	if _, e = tx.Exec(r.Context(), "SELECT id FROM products WHERE id=ANY($1::text[]) ORDER BY id FOR UPDATE", ids); e != nil {
		a.dbError(w, e)
		return
	}
	action := "product-discount.update"
	if r.Method == "DELETE" {
		_, e = tx.Exec(r.Context(), "DELETE FROM product_discounts WHERE id=$1", id)
		action = "product-discount.delete"
	} else {
		_, e = tx.Exec(r.Context(), "UPDATE product_discounts SET active=$2 WHERE id=$1", id, *in.Active)
	}
	if e == nil {
		e = refreshDiscountProducts(r, tx)
	}
	if e == nil {
		e = audit(r, tx, action, id)
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
