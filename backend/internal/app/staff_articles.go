package app

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"bomish/internal/domain"
	"bomish/internal/httpx"
)

func (a *App) staffArticles(w http.ResponseWriter, r *http.Request) {
	page, size := httpx.PageArgs(r)
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
		httpx.DatabaseError(w, e)
		return
	}
	rows, e := a.Pool.Query(r.Context(), "SELECT a.id,a.slug,a.title,a.status,coalesce(d.content,a.content),coalesce(d.updated_at,a.updated_at),d.article_id IS NOT NULL"+filter+" ORDER BY "+order+" LIMIT $3 OFFSET $4", q.Get("q"), q.Get("status"), size, (page-1)*size)
	if e != nil {
		httpx.DatabaseError(w, e)
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
			httpx.DatabaseError(w, e)
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
		httpx.DatabaseError(w, e)
		return
	}
	httpx.List(w, r, out, total)
}

func (a *App) saveArticle(w http.ResponseWriter, r *http.Request) {
	var v domain.Article
	if !httpx.Decode(w, r, &v) {
		return
	}
	v.ID = r.PathValue("id")
	if v.Status == "archived" {
		a.archiveArticle(w, r)
		return
	}
	if (v.Status != "draft" && v.Status != "published" && v.Status != "archived") || v.Title == "" || v.Slug == "" || strings.ContainsAny(v.Slug, " /?#\\") || (v.Image != "" && !domain.ValidImage(v.Image)) {
		httpx.Error(w, 400, "نام، نشانی و تصویر مقاله را بررسی کنید")
		return
	}
	if v.Status == "published" && !can(r, "articles") {
		httpx.Error(w, 403, "انتشار فقط برای مالک مجاز است")
		return
	}
	if v.Status == "published" && (v.Body == "" || v.Excerpt == "" || v.Image == "") {
		httpx.Error(w, 400, "متن، خلاصه و تصویر لازم است")
		return
	}
	tx, e := a.Pool.Begin(r.Context())
	if e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	defer tx.Rollback(r.Context())
	if !authorizeCatalogSave(w, r, tx, "articles", "articles", v.ID) {
		return
	}
	if _, e = tx.Exec(r.Context(), "SELECT set_config('bomish.actor',$1,true)", current(r).StaffID); e != nil {
		httpx.DatabaseError(w, e)
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
		httpx.DatabaseError(w, e)
		return
	}
	httpx.JSON(w, 200, map[string]bool{"ok": true})
}

// Archiving cannot smuggle content changes through a delete-only grant.
func (a *App) archiveArticle(w http.ResponseWriter, r *http.Request) {
	if !requirePermission(w, r, "articles.delete") {
		return
	}
	tx, err := a.Pool.Begin(r.Context())
	if err != nil {
		httpx.DatabaseError(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	id := r.PathValue("id")
	tag, err := tx.Exec(r.Context(), `UPDATE articles SET status='archived',content=jsonb_set(content,'{status}','"archived"'),updated_at=now() WHERE id=$1`, id)
	if err != nil {
		httpx.DatabaseError(w, err)
		return
	}
	if tag.RowsAffected() == 0 {
		httpx.Error(w, 404, "مقاله پیدا نشد")
		return
	}
	if _, err = tx.Exec(r.Context(), "DELETE FROM article_drafts WHERE article_id=$1", id); err == nil {
		err = auditDetail(r.Context(), tx, current(r).StaffID, "article.save", id, map[string]string{"status": "archived"})
	}
	if err == nil {
		err = tx.Commit(r.Context())
	}
	if err != nil {
		httpx.DatabaseError(w, err)
		return
	}
	httpx.JSON(w, 200, map[string]bool{"ok": true})
}
