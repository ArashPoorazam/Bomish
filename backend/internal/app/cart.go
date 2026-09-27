package app

import (
	"bomish/internal/db"
	"bomish/internal/domain"
	"context"
	"github.com/jackc/pgx/v5"
	"net/http"
)

type querier interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
	QueryRow(context.Context, string, ...any) pgx.Row
}

func loadCart(ctx context.Context, q querier, s string) (domain.Cart, error) {
	out := domain.Cart{Items: []domain.CartItem{}}
	rows, e := q.Query(ctx, `SELECT p.id,p.slug,p.name,p.category_id,p.status,p.price_rials,p.min_grams,p.step_grams,p.max_grams,p.content,i.stock_grams-i.reserved_grams,c.package_id,c.quantity FROM carts c JOIN products p ON p.id=c.product_id JOIN inventory i ON i.product_id=p.id WHERE c.session_hash=$1 ORDER BY p.id,c.package_id`, s)
	if e != nil {
		return out, e
	}
	defer rows.Close()
	for rows.Next() {
		var p db.Product
		var stock, quantity int64
		var id string
		if e = rows.Scan(&p.ID, &p.Slug, &p.Name, &p.CategoryID, &p.Status, &p.PriceRials, &p.MinGrams, &p.StepGrams, &p.MaxGrams, &p.Content, &stock, &id, &quantity); e != nil {
			return out, e
		}
		v := productFrom(p, stock)
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
		a.dbError(w, e)
		return
	}
	write(w, 200, v)
}
func (a *App) setCartItem(w http.ResponseWriter, r *http.Request) {
	var in struct {
		PackageID string `json:"packageId"`
		Quantity  int64  `json:"quantity"`
	}
	if !decode(w, r, &in) {
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
	p, e := db.New(tx).GetPublicProduct(r.Context(), r.PathValue("id"))
	if e != nil {
		fail(w, 404, "محصول در دسترس نیست")
		return
	}
	v := productFrom(db.Product{ID: p.ID, Slug: p.Slug, Name: p.Name, CategoryID: p.CategoryID, Status: p.Status, PriceRials: p.PriceRials, MinGrams: p.MinGrams, StepGrams: p.StepGrams, MaxGrams: p.MaxGrams, Content: p.Content}, p.AvailableGrams)
	pack, ok := v.Package(in.PackageID)
	if !ok || in.Quantity < 1 || in.Quantity > pack.MaxQuantity {
		fail(w, 400, "بسته یا تعداد انتخاب‌شده مجاز نیست")
		return
	}
	cart, e := loadCart(r.Context(), tx, current(r).Hash)
	if e != nil {
		a.dbError(w, e)
		return
	}
	grams := pack.Weight() * in.Quantity
	for _, item := range cart.Items {
		if item.Product.ID == v.ID && item.Package.ID != pack.ID {
			grams += item.Grams
		}
	}
	if grams > v.AvailableGrams {
		fail(w, 409, "موجودی کافی نیست")
		return
	}
	_, e = tx.Exec(r.Context(), `INSERT INTO carts(session_hash,product_id,package_id,quantity,grams) VALUES($1,$2,$3,$4,$5) ON CONFLICT(session_hash,product_id,package_id) DO UPDATE SET quantity=excluded.quantity,grams=excluded.grams`, current(r).Hash, v.ID, pack.ID, in.Quantity, pack.Weight()*in.Quantity)
	if e == nil {
		e = tx.Commit(r.Context())
	}
	if e != nil {
		a.dbError(w, e)
		return
	}
	a.getCart(w, r)
}
func (a *App) removeCartItem(w http.ResponseWriter, r *http.Request) {
	if r.URL.Query().Get("packageId") == "" {
		fail(w, 400, "بسته را مشخص کنید")
		return
	}
	tx, e := a.Pool.Begin(r.Context())
	if e != nil {
		a.dbError(w, e)
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
		a.dbError(w, e)
		return
	}
	a.getCart(w, r)
}

func (a *App) addresses(w http.ResponseWriter, r *http.Request) {
	if !requireCustomer(w, r) {
		return
	}
	rows, e := a.Pool.Query(r.Context(), "SELECT id,recipient,phone,province,city,street,postal_code,latitude,longitude FROM addresses WHERE user_id=$1", current(r).UserID)
	if e != nil {
		a.dbError(w, e)
		return
	}
	defer rows.Close()
	out := []domain.Address{}
	for rows.Next() {
		var v domain.Address
		if e = rows.Scan(&v.ID, &v.Recipient, &v.Phone, &v.Province, &v.City, &v.Street, &v.PostalCode, &v.Latitude, &v.Longitude); e != nil {
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
	_, e := a.Pool.Exec(r.Context(), "INSERT INTO addresses(id,user_id,recipient,phone,province,city,street,postal_code,latitude,longitude) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)", in.ID, current(r).UserID, in.Recipient, in.Phone, in.Province, in.City, in.Street, in.PostalCode, in.Latitude, in.Longitude)
	if e != nil {
		a.dbError(w, e)
		return
	}
	write(w, 201, in)
}
