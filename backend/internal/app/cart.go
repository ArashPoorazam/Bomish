package app

import (
	"bomish/internal/domain"
	"context"
	"encoding/json"
	"github.com/jackc/pgx/v5"
	"net/http"
)

type querier interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
	QueryRow(context.Context, string, ...any) pgx.Row
}

func loadCart(ctx context.Context, q querier, s string) (domain.Cart, error) {
	out := domain.Cart{Items: []domain.CartItem{}}
	rows, e := q.Query(ctx, `SELECT p.id,p.slug,p.name,p.category_id,p.status,p.price_rials,p.min_grams,p.step_grams,p.max_grams,p.content,i.stock_grams-i.reserved_grams,c.grams FROM carts c JOIN products p ON p.id=c.product_id JOIN inventory i ON i.product_id=p.id WHERE c.session_hash=$1 ORDER BY p.id`, s)
	if e != nil {
		return out, e
	}
	defer rows.Close()
	for rows.Next() {
		var p domain.Product
		var raw []byte
		var g int64
		var id, slug, name, cat, status string
		var price, min, step, max, stock int64
		e = rows.Scan(&id, &slug, &name, &cat, &status, &price, &min, &step, &max, &raw, &stock, &g)
		if e != nil {
			return out, e
		}
		_ = json.Unmarshal(raw, &p)
		p.ID = id
		p.Slug = slug
		p.Name = name
		p.CategoryID = cat
		p.Status = status
		p.PriceRials = price
		p.MinGrams = min
		p.StepGrams = step
		p.MaxGrams = max
		p.AvailableGrams = stock
		total := domain.Total(price, g)
		out.Items = append(out.Items, domain.CartItem{Product: p, Grams: g, TotalRials: total})
		out.SubtotalRials += total
	}
	return out, rows.Err()
}
func (a *App) getCart(w http.ResponseWriter, r *http.Request) {
	v, e := loadCart(r.Context(), a.Pool, current(r).Hash)
	if e != nil {
		a.dbError(w, e)
		return
	}
	write(w, 200, v)
}
func (a *App) setCartItem(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Grams int64 `json:"grams"`
	}
	if !decode(w, r, &in) {
		return
	}
	p, e := a.Queries.GetPublicProduct(r.Context(), r.PathValue("id"))
	if e != nil {
		fail(w, 404, "محصول در دسترس نیست")
		return
	}
	v := domain.Product{MinGrams: p.MinGrams, StepGrams: p.StepGrams, MaxGrams: p.MaxGrams}
	if e = domain.ValidateWeight(v, in.Grams); e != nil {
		fail(w, 400, e.Error())
		return
	}
	if in.Grams > p.AvailableGrams {
		fail(w, 409, "موجودی کافی نیست")
		return
	}
	tx, e := a.Pool.Begin(r.Context())
	if e != nil {
		a.dbError(w, e)
		return
	}
	defer tx.Rollback(r.Context())
	if _, e = tx.Exec(r.Context(), "SELECT token_hash FROM sessions WHERE token_hash=$1 FOR UPDATE", current(r).Hash); e != nil {
		a.dbError(w, e)
		return
	}
	_, e = tx.Exec(r.Context(), "INSERT INTO carts(session_hash,product_id,grams) VALUES($1,$2,$3) ON CONFLICT(session_hash,product_id) DO UPDATE SET grams=excluded.grams", current(r).Hash, p.ID, in.Grams)
	if e != nil {
		a.dbError(w, e)
		return
	}
	if e = tx.Commit(r.Context()); e != nil {
		a.dbError(w, e)
		return
	}
	a.getCart(w, r)
}
func (a *App) removeCartItem(w http.ResponseWriter, r *http.Request) {
	tx, e := a.Pool.Begin(r.Context())
	if e != nil {
		a.dbError(w, e)
		return
	}
	defer tx.Rollback(r.Context())
	_, e = tx.Exec(r.Context(), "SELECT token_hash FROM sessions WHERE token_hash=$1 FOR UPDATE", current(r).Hash)
	if e == nil {
		_, e = tx.Exec(r.Context(), "DELETE FROM carts WHERE session_hash=$1 AND product_id=$2", current(r).Hash, r.PathValue("id"))
	}
	if e == nil {
		e = tx.Commit(r.Context())
	}
	if e != nil {
		a.dbError(w, e)
		return
	}
	a.getCart(w, r)
}
func (a *App) addresses(w http.ResponseWriter, r *http.Request) {
	if !requireCustomer(w, r) {
		return
	}
	rows, e := a.Pool.Query(r.Context(), "SELECT id,recipient,phone,province,city,street,postal_code FROM addresses WHERE user_id=$1", current(r).UserID)
	if e != nil {
		a.dbError(w, e)
		return
	}
	defer rows.Close()
	out := []domain.Address{}
	for rows.Next() {
		var v domain.Address
		if e = rows.Scan(&v.ID, &v.Recipient, &v.Phone, &v.Province, &v.City, &v.Street, &v.PostalCode); e != nil {
			a.dbError(w, e)
			return
		}
		out = append(out, v)
	}
	write(w, 200, out)
}
func (a *App) saveAddress(w http.ResponseWriter, r *http.Request) {
	if !requireCustomer(w, r) {
		return
	}
	var in domain.Address
	if !decode(w, r, &in) {
		return
	}
	in.Phone = domain.Phone(in.Phone)
	in.PostalCode = domain.Normalize(in.PostalCode)
	if e := in.Validate(); e != nil {
		fail(w, 400, e.Error())
		return
	}
	in.ID = token()
	_, e := a.Pool.Exec(r.Context(), "INSERT INTO addresses(id,user_id,recipient,phone,province,city,street,postal_code) VALUES($1,$2,$3,$4,$5,$6,$7,$8)", in.ID, current(r).UserID, in.Recipient, in.Phone, in.Province, in.City, in.Street, in.PostalCode)
	if e != nil {
		a.dbError(w, e)
		return
	}
	write(w, 201, in)
}
