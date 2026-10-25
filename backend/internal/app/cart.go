package app

import (
	"context"
	"errors"
	"net/http"

	"bomish/internal/database"
	"bomish/internal/db"
	"bomish/internal/domain"
	"bomish/internal/httpx"
)

func loadCart(ctx context.Context, q database.Querier, s string) (domain.Cart, error) {
	out := domain.Cart{Items: []domain.CartItem{}}
	rows, e := q.Query(ctx, `SELECT p.id,p.slug,p.name,p.category_id,p.status,p.price_rials,p.min_grams,p.step_grams,p.max_grams,p.content,coalesce((p.content->>'outOfStock')::boolean,false),c.package_id,c.quantity FROM carts c JOIN products p ON p.id=c.product_id WHERE c.session_hash=$1 ORDER BY p.id,c.package_id`, s)
	if e != nil {
		return out, e
	}
	defer rows.Close()
	for rows.Next() {
		var p db.Product
		var quantity int64
		var outOfStock bool
		var id string
		if e = rows.Scan(&p.ID, &p.Slug, &p.Name, &p.CategoryID, &p.Status, &p.PriceRials, &p.MinGrams, &p.StepGrams, &p.MaxGrams, &p.Content, &outOfStock, &id, &quantity); e != nil {
			return out, e
		}
		v := productFrom(p, outOfStock)
		pack, ok := v.Package(id)
		if !ok {
			pack = domain.Package{ID: id, Unit: "g", MaxQuantity: 0}
		}
		total := v.PackagePrice(pack) * quantity
		out.Items = append(out.Items, domain.CartItem{Product: v, Package: pack, Quantity: quantity, Grams: pack.Weight() * quantity, TotalRials: total})
		out.SubtotalRials += total
	}
	return out, rows.Err()
}

func (a *App) getCart(w http.ResponseWriter, r *http.Request) {
	v, e := loadCart(r.Context(), a.Pool, current(r).Hash)
	if e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	httpx.JSON(w, 200, v)
}

func (a *App) setCartItem(w http.ResponseWriter, r *http.Request) {
	var in struct {
		PackageID string `json:"packageId"`
		Quantity  int64  `json:"quantity"`
	}
	if !httpx.Decode(w, r, &in) {
		return
	}
	tx, e := a.Pool.Begin(r.Context())
	if e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	defer tx.Rollback(r.Context())
	if _, e = tx.Exec(r.Context(), "SELECT token_hash FROM sessions WHERE token_hash=$1 FOR UPDATE", current(r).Hash); e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	p, e := db.New(tx).GetPublicProduct(r.Context(), r.PathValue("id"))
	if e != nil {
		httpx.Error(w, 404, "محصول در دسترس نیست")
		return
	}
	v := productFrom(p.Product, p.OutOfStock)
	pack, ok := v.Package(in.PackageID)
	if !ok || in.Quantity < 1 || in.Quantity > pack.MaxQuantity {
		httpx.Error(w, 400, "بسته یا تعداد انتخاب‌شده مجاز نیست")
		return
	}
	if v.OutOfStock {
		httpx.Error(w, 409, "این محصول ناموجود است")
		return
	}
	_, e = tx.Exec(r.Context(), `INSERT INTO carts(session_hash,product_id,package_id,quantity,grams) VALUES($1,$2,$3,$4,$5) ON CONFLICT(session_hash,product_id,package_id) DO UPDATE SET quantity=excluded.quantity,grams=excluded.grams`, current(r).Hash, v.ID, pack.ID, in.Quantity, pack.Weight()*in.Quantity)
	if e == nil {
		e = tx.Commit(r.Context())
	}
	if e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	a.getCart(w, r)
}

func (a *App) removeCartItem(w http.ResponseWriter, r *http.Request) {
	if r.URL.Query().Get("packageId") == "" {
		httpx.Error(w, 400, "بسته را مشخص کنید")
		return
	}
	tx, e := a.Pool.Begin(r.Context())
	if e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	defer tx.Rollback(r.Context())
	_, e = tx.Exec(r.Context(), "SELECT token_hash FROM sessions WHERE token_hash=$1 FOR UPDATE", current(r).Hash)
	if e == nil {
		_, e = tx.Exec(r.Context(), "DELETE FROM carts WHERE session_hash=$1 AND product_id=$2 AND package_id=$3", current(r).Hash, r.PathValue("id"), r.URL.Query().Get("packageId"))
	}
	if e == nil {
		e = tx.Commit(r.Context())
	}
	if e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	a.getCart(w, r)
}

var errUnavailable = errors.New("وضعیت محصول، بسته یا سقف خرید تغییر کرده است؛ سبد را بررسی کنید")
