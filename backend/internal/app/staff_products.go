package app

import (
	"encoding/json"
	"net/http"

	"bomish/internal/domain"
	"bomish/internal/httpx"

	"github.com/jackc/pgx/v5"
)

func (a *App) staffProducts(w http.ResponseWriter, r *http.Request) { a.catalogPage(w, r, true) }

func (a *App) saveProduct(w http.ResponseWriter, r *http.Request) {
	var in struct {
		domain.Product
		ConfirmMeasurements []string `json:"confirmMeasurements"`
	}
	if !httpx.Decode(w, r, &in) {
		return
	}
	p := in.Product
	tx, e := a.Pool.Begin(r.Context())
	if e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	defer tx.Rollback(r.Context())
	if _, e = tx.Exec(r.Context(), "SELECT pg_advisory_xact_lock_shared(hashtextextended('product-packaging-sync',0))"); e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	if !authorizeCatalogSave(w, r, tx, "products", "products", r.PathValue("id")) {
		return
	}
	if message, err := resolveProductPackaging(r, tx, &p); err != nil {
		httpx.DatabaseError(w, err)
		return
	} else if message != "" {
		httpx.Error(w, 400, message)
		return
	}
	p.ID = r.PathValue("id")
	p.Status = "draft"
	for i := range p.Packages {
		if p.Packages[i].MaxQuantity == 0 {
			p.Packages[i].MaxQuantity = 5
		}
	}
	p.MinGrams = 1
	p.StepGrams = 1
	p.MaxGrams = 1000000

	if e := p.Validate(false); e != nil {
		httpx.Error(w, 400, e.Error())
		return
	}
	if _, e = tx.Exec(r.Context(), "SELECT set_config('bomish.actor',$1,true)", current(r).StaffID); e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	var price int64
	var oldRaw []byte
	err := tx.QueryRow(r.Context(), "SELECT price_rials,content FROM products WHERE id=$1 FOR UPDATE", p.ID).Scan(&price, &oldRaw)
	if err != nil && err != pgx.ErrNoRows {
		httpx.DatabaseError(w, err)
		return
	}
	if !can(r, "pricing.edit") {
		var previous domain.Product
		_ = json.Unmarshal(oldRaw, &previous)
		var draft []byte
		e = tx.QueryRow(r.Context(), "SELECT content FROM product_drafts WHERE product_id=$1", p.ID).Scan(&draft)
		if e == nil {
			_ = json.Unmarshal(draft, &previous)
		} else if e != pgx.ErrNoRows {
			httpx.DatabaseError(w, e)
			return
		}
		if !samePricing(previous, p) {
			httpx.Error(w, 403, "دسترسی تغییر قیمت و تخفیف برای این حساب فعال نیست")
			return
		}
	}
	var live domain.Product
	_ = json.Unmarshal(oldRaw, &live)
	p.OutOfStock = live.OutOfStock
	raw, _ := json.Marshal(p)
	if err == pgx.ErrNoRows {
		_, e = tx.Exec(r.Context(), `INSERT INTO products(id,slug,name,category_id,status,price_rials,min_grams,step_grams,max_grams,content) VALUES($1,$2,$3,$4,'draft',0,$5,$6,$7,$8)`, p.ID, p.Slug, p.Name, p.CategoryID, p.MinGrams, p.StepGrams, p.MaxGrams, raw)
	}
	if e == nil {
		_, e = tx.Exec(r.Context(), "INSERT INTO product_drafts(product_id,content) VALUES($1,$2) ON CONFLICT(product_id) DO UPDATE SET content=excluded.content,updated_at=now()", p.ID, raw)
	}
	if e == nil {
		e = audit(r, tx, "product.draft", p.ID)
	}
	if e == nil {
		e = tx.Commit(r.Context())
	}
	if e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	httpx.JSON(w, 200, map[string]any{"ok": true, "product": p})
}

func (a *App) publishProduct(w http.ResponseWriter, r *http.Request) {
	tx, e := a.Pool.Begin(r.Context())
	if e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	defer tx.Rollback(r.Context())
	if _, e = tx.Exec(r.Context(), "SELECT pg_advisory_xact_lock_shared(hashtextextended('product-packaging-sync',0))"); e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	if _, e = tx.Exec(r.Context(), "SELECT set_config('bomish.actor',$1,true)", current(r).StaffID); e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	_, err := readShippingConfig(r.Context(), tx, true)
	if err != nil {
		httpx.DatabaseError(w, err)
		return
	}
	id := r.PathValue("id")
	var raw []byte
	e = tx.QueryRow(r.Context(), "SELECT coalesce(d.content,p.content) FROM products p LEFT JOIN product_drafts d ON d.product_id=p.id WHERE p.id=$1 FOR UPDATE OF p", id).Scan(&raw)
	if e != nil {
		httpx.Error(w, 404, "محصول پیدا نشد")
		return
	}
	var p domain.Product
	_ = json.Unmarshal(raw, &p)

	if !can(r, "pricing.edit") {
		var published []byte
		var previous domain.Product
		if e = tx.QueryRow(r.Context(), "SELECT content FROM products WHERE id=$1", id).Scan(&published); e != nil {
			httpx.DatabaseError(w, e)
			return
		}
		_ = json.Unmarshal(published, &previous)
		if !samePricing(previous, p) {
			httpx.Error(w, 403, "انتشار تغییر قیمت نیازمند دسترسی قیمت و تخفیف است")
			return
		}
	}

	for _, v := range p.Packages {
		if v.PackagingID == "" {
			shippingError(w, 422, "missing_measurements", "بسته‌بندی محصول را برای همه بسته‌ها انتخاب کنید")
			return
		}
		if err = v.ValidateMeasurements(true); err != nil {
			shippingError(w, 422, "missing_measurements", err.Error())
			return
		}
	}

	if e = p.Validate(true); e != nil {
		httpx.Error(w, 400, e.Error())
		return
	}

	p.Status = "published"
	raw, _ = json.Marshal(p)
	_, e = tx.Exec(r.Context(), `UPDATE products SET slug=$1,name=$2,category_id=$3,first_published_at=CASE WHEN status='draft' THEN coalesce(first_published_at,now()) ELSE first_published_at END,status='published',price_rials=$4,min_grams=$5,step_grams=$6,max_grams=$7,content=$8,search_text=$9,updated_at=now() WHERE id=$10`, p.Slug, p.Name, p.CategoryID, p.PriceRials, p.MinGrams, p.StepGrams, p.MaxGrams, raw, searchText(p), id)
	if e == nil {
		_, e = tx.Exec(r.Context(), "DELETE FROM product_drafts WHERE product_id=$1", id)
	}
	if e == nil {
		e = audit(r, tx, "product.publish", id)
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

func (a *App) archiveProduct(w http.ResponseWriter, r *http.Request) {
	tx, e := a.Pool.Begin(r.Context())
	if e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	defer tx.Rollback(r.Context())
	if _, e = tx.Exec(r.Context(), "SELECT set_config('bomish.actor',$1,true)", current(r).StaffID); e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	_, e = tx.Exec(r.Context(), "UPDATE products SET status='archived' WHERE id=$1", r.PathValue("id"))
	if e == nil {
		e = audit(r, tx, "product.archive", r.PathValue("id"))
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

// Availability is an immediate operational change, independent of content drafts.
func (a *App) setAvailability(w http.ResponseWriter, r *http.Request) {
	var in struct {
		OutOfStock bool `json:"outOfStock"`
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
	if !in.OutOfStock {
		_, err := readShippingConfig(r.Context(), tx, true)
		if err != nil {
			httpx.DatabaseError(w, err)
			return
		}

		var raw []byte
		err = tx.QueryRow(r.Context(), "SELECT content FROM products WHERE id=$1 FOR UPDATE", r.PathValue("id")).Scan(&raw)
		if err != nil {
			httpx.Error(w, 404, "محصول پیدا نشد")
			return
		}
		var p domain.Product
		if err = json.Unmarshal(raw, &p); err != nil {
			httpx.DatabaseError(w, err)
			return
		}
		p.EnsurePackages()
		for _, pack := range p.Packages {
			if err = pack.ValidateMeasurements(true); err != nil {
				shippingError(w, 422, "missing_measurements", err.Error())
				return
			}
		}

	}
	tag, e := tx.Exec(r.Context(), `UPDATE products SET content=jsonb_set(content,'{outOfStock}',to_jsonb($2::boolean)),updated_at=now() WHERE id=$1`, r.PathValue("id"), in.OutOfStock)
	if e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	if tag.RowsAffected() == 0 {
		httpx.Error(w, 404, "محصول پیدا نشد")
		return
	}
	_, e = tx.Exec(r.Context(), `UPDATE product_drafts SET content=jsonb_set(content,'{outOfStock}',to_jsonb($2::boolean)) WHERE product_id=$1`, r.PathValue("id"), in.OutOfStock)
	if e == nil {
		e = auditDetail(r.Context(), tx, current(r).StaffID, "product.availability", r.PathValue("id"), in)
	}
	if e == nil {
		e = tx.Commit(r.Context())
	}
	if e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	httpx.JSON(w, 200, in)
}
