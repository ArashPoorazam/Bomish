package app

import (
	"bomish/internal/domain"
	"encoding/json"
	"github.com/jackc/pgx/v5"
	"net/http"
)

func (a *App) adjustPrices(w http.ResponseWriter, r *http.Request) {
	var in struct {
		ProductIDs []string `json:"productIds"`
		All        bool     `json:"all"`
		Amount     int64    `json:"amount"`
	}
	if !decode(w, r, &in) {
		return
	}
	if in.Amount == 0 || in.Amount < -100000000000 || in.Amount > 100000000000 || in.Amount%10 != 0 {
		fail(w, 400, "مقدار معتبر نیست")
		return
	}
	if (!in.All && len(in.ProductIDs) == 0) || (in.All && len(in.ProductIDs) > 0) {
		fail(w, 400, "یک یا چند محصول، یا همه محصولات را انتخاب کنید")
		return
	}
	tx, e := a.Pool.Begin(r.Context())
	if e != nil {
		a.dbError(w, e)
		return
	}
	defer tx.Rollback(r.Context())
	if _, e = tx.Exec(r.Context(), "SELECT set_config('bomish.actor',$1,true)", current(r).StaffID); e != nil {
		a.dbError(w, e)
		return
	}
	selected := in.ProductIDs
	if selected == nil {
		selected = []string{}
	}
	rows, e := tx.Query(r.Context(), "SELECT id,content,price_rials,min_grams FROM products WHERE $1 OR id=ANY($2::text[]) ORDER BY id FOR UPDATE", in.All, selected)
	if e != nil {
		a.dbError(w, e)
		return
	}
	type item struct {
		id string
		p  domain.Product
	}
	items := []item{}
	for rows.Next() {
		var it item
		var raw []byte
		var price, min int64
		if e = rows.Scan(&it.id, &raw, &price, &min); e != nil {
			rows.Close()
			a.dbError(w, e)
			return
		}
		_ = json.Unmarshal(raw, &it.p)
		it.p.PriceRials = price
		it.p.MinGrams = min
		it.p.EnsurePackages()
		items = append(items, it)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		a.dbError(w, e)
		return
	}
	if len(items) == 0 {
		fail(w, 404, "محصول پیدا نشد")
		return
	}
	if !in.All && len(items) != len(in.ProductIDs) {
		fail(w, 400, "محصولات انتخاب‌شده معتبر نیستند")
		return
	}
	apply := func(p *domain.Product) bool {
		for i := range p.Packages {
			n := p.Packages[i].PriceRials + in.Amount
			if n <= 0 || n > 100000000000 {
				return false
			}
			p.Packages[i].PriceRials = n
		}
		return true
	}
	for _, it := range items {
		if !apply(&it.p) {
			fail(w, 400, "این تغییر قیمت یکی از بسته‌ها را نامعتبر می‌کند؛ هیچ تغییری ذخیره نشد")
			return
		}
		raw, _ := json.Marshal(it.p)
		if _, e = tx.Exec(r.Context(), "UPDATE products SET content=$2,updated_at=now() WHERE id=$1", it.id, raw); e != nil {
			a.dbError(w, e)
			return
		}
		var draft []byte
		e = tx.QueryRow(r.Context(), "SELECT content FROM product_drafts WHERE product_id=$1", it.id).Scan(&draft)
		if e != nil && e != pgx.ErrNoRows {
			a.dbError(w, e)
			return
		}
		if e == nil {
			var p domain.Product
			_ = json.Unmarshal(draft, &p)
			p.EnsurePackages()
			if !apply(&p) {
				fail(w, 400, "قیمت پیش‌نویس معتبر نیست؛ هیچ تغییری ذخیره نشد")
				return
			}
			raw, _ = json.Marshal(p)
			if _, e = tx.Exec(r.Context(), "UPDATE product_drafts SET content=$2 WHERE product_id=$1", it.id, raw); e != nil {
				a.dbError(w, e)
				return
			}
		}
	}
	if e = auditDetail(r.Context(), tx, current(r).StaffID, "pricing.adjust", "", map[string]any{"amount": in.Amount, "products": len(items), "productIds": selected, "all": in.All}); e == nil {
		e = tx.Commit(r.Context())
	}
	if e != nil {
		a.dbError(w, e)
		return
	}
	write(w, 200, map[string]any{"ok": true, "count": len(items)})
}
