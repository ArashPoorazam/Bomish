package app

import (
	"bomish/internal/domain"
	"encoding/json"
	"github.com/jackc/pgx/v5"
	"net/http"
	"strings"
	"time"
)

func audit(r *http.Request, tx pgx.Tx, action, id string) error {
	_, e := tx.Exec(r.Context(), "INSERT INTO audit_events(staff_id,action,entity_id) VALUES($1,$2,$3)", current(r).StaffID, action, id)
	return e
}
func (a *App) staffProducts(w http.ResponseWriter, r *http.Request) { a.catalogPage(w, r, true) }
func (a *App) saveProduct(w http.ResponseWriter, r *http.Request) {
	var p domain.Product
	if !decode(w, r, &p) {
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
		fail(w, 400, e.Error())
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
	var price int64
	var oldRaw []byte
	err := tx.QueryRow(r.Context(), "SELECT price_rials,content FROM products WHERE id=$1 FOR UPDATE", p.ID).Scan(&price, &oldRaw)
	if err != nil && err != pgx.ErrNoRows {
		a.dbError(w, err)
		return
	}
	if !can(r, "pricing") {
		var previous domain.Product
		_ = json.Unmarshal(oldRaw, &previous)
		var draft []byte
		e = tx.QueryRow(r.Context(), "SELECT content FROM product_drafts WHERE product_id=$1", p.ID).Scan(&draft)
		if e == nil {
			_ = json.Unmarshal(draft, &previous)
		} else if e != pgx.ErrNoRows {
			a.dbError(w, e)
			return
		}
		if !samePricing(previous, p) {
			fail(w, 403, "دسترسی تغییر قیمت و تخفیف برای این حساب فعال نیست")
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
		a.dbError(w, e)
		return
	}
	write(w, 200, map[string]bool{"ok": true})
}
func (a *App) publishProduct(w http.ResponseWriter, r *http.Request) {
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
	id := r.PathValue("id")
	var raw []byte
	e = tx.QueryRow(r.Context(), "SELECT coalesce(d.content,p.content) FROM products p LEFT JOIN product_drafts d ON d.product_id=p.id WHERE p.id=$1 FOR UPDATE OF p", id).Scan(&raw)
	if e != nil {
		fail(w, 404, "محصول پیدا نشد")
		return
	}
	var p domain.Product
	_ = json.Unmarshal(raw, &p)
	if e = p.Validate(true); e != nil {
		fail(w, 400, e.Error())
		return
	}
	if !can(r, "pricing") {
		var published []byte
		var previous domain.Product
		if e = tx.QueryRow(r.Context(), "SELECT content FROM products WHERE id=$1", id).Scan(&published); e != nil {
			a.dbError(w, e)
			return
		}
		_ = json.Unmarshal(published, &previous)
		if !samePricing(previous, p) {
			fail(w, 403, "انتشار تغییر قیمت نیازمند دسترسی قیمت و تخفیف است")
			return
		}
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
		a.dbError(w, e)
		return
	}
	write(w, 200, map[string]bool{"ok": true})
}
func (a *App) archiveProduct(w http.ResponseWriter, r *http.Request) {
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
	_, e = tx.Exec(r.Context(), "UPDATE products SET status='archived' WHERE id=$1", r.PathValue("id"))
	if e == nil {
		e = audit(r, tx, "product.archive", r.PathValue("id"))
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

// Availability is an immediate operational change, independent of content drafts.
func (a *App) setAvailability(w http.ResponseWriter, r *http.Request) {
	var in struct {
		OutOfStock bool `json:"outOfStock"`
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
	tag, e := tx.Exec(r.Context(), `UPDATE products SET content=jsonb_set(content,'{outOfStock}',to_jsonb($2::boolean)),updated_at=now() WHERE id=$1`, r.PathValue("id"), in.OutOfStock)
	if e != nil {
		a.dbError(w, e)
		return
	}
	if tag.RowsAffected() == 0 {
		fail(w, 404, "محصول پیدا نشد")
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
		a.dbError(w, e)
		return
	}
	write(w, 200, in)
}
func (a *App) saveCategory(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Name        string `json:"name"`
		Description string `json:"description"`
	}
	if !decode(w, r, &in) {
		return
	}
	if strings.TrimSpace(in.Name) == "" {
		fail(w, 400, "نام دسته لازم است")
		return
	}
	tx, e := a.Pool.Begin(r.Context())
	if e != nil {
		a.dbError(w, e)
		return
	}
	defer tx.Rollback(r.Context())
	before, e := queryMaps(r.Context(), tx, "SELECT name,description FROM categories WHERE id=$1", r.PathValue("id"))
	if e != nil {
		a.dbError(w, e)
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
		a.dbError(w, e)
		return
	}
	write(w, 200, map[string]bool{"ok": true})
}
func (a *App) staffArticles(w http.ResponseWriter, r *http.Request) {
	page, size := pageArgs(r)
	q := r.URL.Query()
	order := "coalesce(d.updated_at,a.updated_at) DESC,a.id"
	if q.Get("sort") == "oldest" {
		order = "coalesce(d.updated_at,a.updated_at),a.id"
	}
	if q.Get("sort") == "title" {
		order = "a.title,a.id"
	}
	filter := ` FROM articles a LEFT JOIN article_drafts d ON d.article_id=a.id WHERE ($1='' OR coalesce(d.content,a.content)::text ILIKE '%'||$1||'%') AND ($2='' OR (CASE WHEN d.article_id IS NOT NULL THEN 'draft' ELSE a.status END)=$2)`
	var total int64
	if e := a.Pool.QueryRow(r.Context(), "SELECT count(*)"+filter, q.Get("q"), q.Get("status")).Scan(&total); e != nil {
		a.dbError(w, e)
		return
	}
	rows, e := a.Pool.Query(r.Context(), "SELECT a.id,a.slug,a.title,a.status,coalesce(d.content,a.content),coalesce(d.updated_at,a.updated_at),d.article_id IS NOT NULL"+filter+" ORDER BY "+order+" LIMIT $3 OFFSET $4", q.Get("q"), q.Get("status"), size, (page-1)*size)
	if e != nil {
		a.dbError(w, e)
		return
	}
	defer rows.Close()
	out := []domain.Article{}
	for rows.Next() {
		var raw []byte
		var id, slug, title, status string
		var updated time.Time
		var draft bool
		if e = rows.Scan(&id, &slug, &title, &status, &raw, &updated, &draft); e != nil {
			a.dbError(w, e)
			return
		}
		var v domain.Article
		_ = json.Unmarshal(raw, &v)
		v.ID = id
		v.UpdatedAt = updated.Format(time.RFC3339)
		if !draft {
			v.Slug = slug
			v.Title = title
			v.Status = status
		} else {
			v.Status = "draft"
		}
		out = append(out, v)
	}
	if e = rows.Err(); e != nil {
		a.dbError(w, e)
		return
	}
	listResponse(w, r, out, total)
}
func (a *App) saveArticle(w http.ResponseWriter, r *http.Request) {
	var v domain.Article
	if !decode(w, r, &v) {
		return
	}
	v.ID = r.PathValue("id")
	if (v.Status != "draft" && v.Status != "published" && v.Status != "archived") || v.Title == "" || v.Slug == "" || strings.ContainsAny(v.Slug, " /?#\\") || (v.Image != "" && !domain.ValidImage(v.Image)) {
		fail(w, 400, "نام، نشانی و تصویر مقاله را بررسی کنید")
		return
	}
	if v.Status == "published" && !can(r, "articles") {
		fail(w, 403, "انتشار فقط برای مالک مجاز است")
		return
	}
	if v.Status == "published" && (v.Body == "" || v.Excerpt == "" || v.Image == "") {
		fail(w, 400, "متن، خلاصه و تصویر لازم است")
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
	raw, _ := json.Marshal(v)
	_, e = tx.Exec(r.Context(), "INSERT INTO articles(id,slug,title,content) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING", v.ID, v.Slug, v.Title, raw)
	if e == nil {
		if v.Status == "published" || v.Status == "archived" {
			_, e = tx.Exec(r.Context(), "UPDATE articles SET slug=$1,title=$2,status=$5,content=$3,updated_at=now() WHERE id=$4", v.Slug, v.Title, raw, v.ID, v.Status)
			if e == nil {
				_, e = tx.Exec(r.Context(), "DELETE FROM article_drafts WHERE article_id=$1", v.ID)
			}
		} else {
			_, e = tx.Exec(r.Context(), "INSERT INTO article_drafts(article_id,content) VALUES($1,$2) ON CONFLICT(article_id) DO UPDATE SET content=excluded.content,updated_at=now()", v.ID, raw)
		}
	}
	if e == nil {
		e = auditDetail(r.Context(), tx, current(r).StaffID, "article.save", v.ID, map[string]string{"title": v.Title, "status": v.Status})
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

func samePricing(a, b domain.Product) bool {
	if a.PriceRials != b.PriceRials || a.DiscountPercent != b.DiscountPercent {
		return false
	}
	for _, p := range b.Packages {
		old, ok := a.Package(p.ID)
		if (!ok && p.PriceRials != 0) || (ok && old.PriceRials != p.PriceRials) {
			return false
		}
	}
	return true
}
