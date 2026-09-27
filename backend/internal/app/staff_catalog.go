package app

import (
	"bomish/internal/domain"
	"encoding/json"
	"github.com/jackc/pgx/v5"
	"net/http"
	"strings"
)

func audit(r *http.Request, tx pgx.Tx, action, id string) error {
	_, e := tx.Exec(r.Context(), "INSERT INTO audit_events(staff_id,action,entity_id) VALUES($1,$2,$3)", current(r).StaffID, action, id)
	return e
}
func (a *App) staffProducts(w http.ResponseWriter, r *http.Request) {
	rows, e := a.Pool.Query(r.Context(), `SELECT p.id,p.slug,p.name,p.category_id,p.status,p.price_rials,p.min_grams,p.step_grams,p.max_grams,coalesce(d.content,p.content),i.stock_grams-i.reserved_grams,d.product_id IS NOT NULL FROM products p JOIN inventory i ON i.product_id=p.id LEFT JOIN product_drafts d ON d.product_id=p.id ORDER BY p.updated_at DESC`)
	if e != nil {
		a.dbError(w, e)
		return
	}
	defer rows.Close()
	out := []domain.Product{}
	for rows.Next() {
		var p domain.Product
		var raw []byte
		var draft bool
		var id, slug, name, cat, status string
		var price, min, step, max, stock int64
		e = rows.Scan(&id, &slug, &name, &cat, &status, &price, &min, &step, &max, &raw, &stock, &draft)
		if e != nil {
			a.dbError(w, e)
			return
		}
		_ = json.Unmarshal(raw, &p)
		p.ID = id
		p.AvailableGrams = stock
		if !draft {
			p.Slug = slug
			p.Name = name
			p.CategoryID = cat
			p.Status = status
			p.PriceRials = price
			p.MinGrams = min
			p.StepGrams = step
			p.MaxGrams = max
		} else {
			p.Status = "draft"
		}

		if current(r).Role == "editor" {
			p.PriceRials = 0
			p.AvailableGrams = 0
		}
		p.EnsurePackages()
		if current(r).Role == "editor" {
			for i := range p.Packages {
				p.Packages[i].PriceRials = 0
			}
		}
		out = append(out, p)
	}
	write(w, 200, out)
}
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
	var price int64
	var oldRaw []byte
	err := tx.QueryRow(r.Context(), "SELECT price_rials,content FROM products WHERE id=$1 FOR UPDATE", p.ID).Scan(&price, &oldRaw)
	if err != nil && err != pgx.ErrNoRows {
		a.dbError(w, err)
		return
	}
	if current(r).Role == "editor" {
		if p.PriceRials != 0 {
			fail(w, 403, "تغییر قیمت فقط برای مالک مجاز است")
			return
		}
		p.PriceRials = price
		// Preserve an owner's staged price when an editor revises copy.
		var draft []byte
		if tx.QueryRow(r.Context(), "SELECT content FROM product_drafts WHERE product_id=$1", p.ID).Scan(&draft) == nil {
			var previous domain.Product
			_ = json.Unmarshal(draft, &previous)
			p.PriceRials = previous.PriceRials
		}
	}
	if current(r).Role == "editor" {
		var previous domain.Product
		_ = json.Unmarshal(oldRaw, &previous)
		var draft []byte
		if tx.QueryRow(r.Context(), "SELECT content FROM product_drafts WHERE product_id=$1", p.ID).Scan(&draft) == nil {
			_ = json.Unmarshal(draft, &previous)
		}
		previous.EnsurePackages()
		p.DiscountPercent = previous.DiscountPercent
		for i := range p.Packages {
			old, ok := previous.Package(p.Packages[i].ID)
			if ok {
				p.Packages[i].PriceRials = old.PriceRials
			} else {
				p.Packages[i].PriceRials = 0
			}
		}
	}
	raw, _ := json.Marshal(p)
	if err == pgx.ErrNoRows {
		_, e = tx.Exec(r.Context(), `INSERT INTO products(id,slug,name,category_id,status,price_rials,min_grams,step_grams,max_grams,content) VALUES($1,$2,$3,$4,'draft',0,$5,$6,$7,$8)`, p.ID, p.Slug, p.Name, p.CategoryID, p.MinGrams, p.StepGrams, p.MaxGrams, raw)
		if e == nil {
			_, e = tx.Exec(r.Context(), "INSERT INTO inventory(product_id) VALUES($1)", p.ID)
		}
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
	p.Status = "published"
	raw, _ = json.Marshal(p)
	_, e = tx.Exec(r.Context(), `UPDATE products SET slug=$1,name=$2,category_id=$3,status='published',price_rials=$4,min_grams=$5,step_grams=$6,max_grams=$7,content=$8,search_text=$9,updated_at=now() WHERE id=$10`, p.Slug, p.Name, p.CategoryID, p.PriceRials, p.MinGrams, p.StepGrams, p.MaxGrams, raw, searchText(p), id)
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
func (a *App) adjustStock(w http.ResponseWriter, r *http.Request) {
	var in struct {
		DeltaGrams int64  `json:"deltaGrams"`
		Reason     string `json:"reason"`
	}
	if !decode(w, r, &in) {
		return
	}
	if in.Reason == "" || in.DeltaGrams == 0 || in.DeltaGrams > 100000000 || in.DeltaGrams < -100000000 {
		fail(w, 400, "مقدار و دلیل تغییر را وارد کنید")
		return
	}
	tx, e := a.Pool.Begin(r.Context())
	if e != nil {
		a.dbError(w, e)
		return
	}
	defer tx.Rollback(r.Context())
	tag, e := tx.Exec(r.Context(), "UPDATE inventory SET stock_grams=stock_grams+$1 WHERE product_id=$2 AND stock_grams+$1>=reserved_grams", in.DeltaGrams, r.PathValue("id"))
	if e != nil || tag.RowsAffected() == 0 {
		fail(w, 409, "موجودی نمی‌تواند از وزن رزروشده کمتر شود")
		return
	}
	_, e = tx.Exec(r.Context(), "INSERT INTO stock_movements(product_id,delta_grams,reason) VALUES($1,$2,$3)", r.PathValue("id"), in.DeltaGrams, in.Reason)
	if e == nil {
		e = audit(r, tx, "inventory.adjust", r.PathValue("id"))
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
	_, e := a.Pool.Exec(r.Context(), "INSERT INTO categories(id,name,description) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET name=excluded.name,description=excluded.description", r.PathValue("id"), in.Name, in.Description)
	if e != nil {
		a.dbError(w, e)
		return
	}
	write(w, 200, map[string]bool{"ok": true})
}
func (a *App) staffArticles(w http.ResponseWriter, r *http.Request) {
	rows, e := a.Pool.Query(r.Context(), "SELECT a.id,a.slug,a.title,a.status,coalesce(d.content,a.content),a.updated_at,d.article_id IS NOT NULL FROM articles a LEFT JOIN article_drafts d ON d.article_id=a.id ORDER BY a.updated_at DESC")
	if e != nil {
		a.dbError(w, e)
		return
	}
	defer rows.Close()
	out := []domain.Article{}
	for rows.Next() {
		var raw []byte
		var id, slug, title, status string
		var updated any
		var draft bool
		if e = rows.Scan(&id, &slug, &title, &status, &raw, &updated, &draft); e != nil {
			a.dbError(w, e)
			return
		}
		var v domain.Article
		_ = json.Unmarshal(raw, &v)
		v.ID = id
		if !draft {
			v.Slug = slug
			v.Title = title
			v.Status = status
		} else {
			v.Status = "draft"
		}
		out = append(out, v)
	}
	write(w, 200, out)
}
func (a *App) saveArticle(w http.ResponseWriter, r *http.Request) {
	var v domain.Article
	if !decode(w, r, &v) {
		return
	}
	v.ID = r.PathValue("id")
	if v.Title == "" || v.Slug == "" || strings.ContainsAny(v.Slug, " /?#\\") || (v.Image != "" && !domain.ValidImage(v.Image)) {
		fail(w, 400, "نام، نشانی و تصویر مقاله را بررسی کنید")
		return
	}
	if v.Status == "published" && current(r).Role != "owner" {
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
	raw, _ := json.Marshal(v)
	_, e = tx.Exec(r.Context(), "INSERT INTO articles(id,slug,title,content) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING", v.ID, v.Slug, v.Title, raw)
	if e == nil {
		if v.Status == "published" {
			_, e = tx.Exec(r.Context(), "UPDATE articles SET slug=$1,title=$2,status='published',content=$3,updated_at=now() WHERE id=$4", v.Slug, v.Title, raw, v.ID)
			if e == nil {
				_, e = tx.Exec(r.Context(), "DELETE FROM article_drafts WHERE article_id=$1", v.ID)
			}
		} else {
			_, e = tx.Exec(r.Context(), "INSERT INTO article_drafts(article_id,content) VALUES($1,$2) ON CONFLICT(article_id) DO UPDATE SET content=excluded.content", v.ID, raw)
		}
	}
	if e == nil {
		e = audit(r, tx, "article.save", v.ID)
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
