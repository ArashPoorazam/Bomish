package app

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"time"

	"bomish/internal/database"
	"bomish/internal/httpx"
	"bomish/internal/reporting"
	"bomish/internal/security"

	"github.com/jackc/pgx/v5"
)

func (a *App) createExport(w http.ResponseWriter, r *http.Request) {
	var params map[string]string
	if !httpx.Decode(w, r, &params) {
		return
	}
	q := url.Values{}
	for k, v := range params {
		q.Set(k, v)
	}
	if _, err := reporting.BuildQuery(q); err != nil {
		httpx.Error(w, 400, "گزارش معتبر نیست")
		return
	}
	if !a.limit(r, "export:"+current(r).StaffID, 10, time.Hour) {
		httpx.Error(w, 429, "تعداد گزارش‌ها زیاد است؛ کمی بعد تلاش کنید")
		return
	}
	b, _ := json.Marshal(params)
	id := security.Token()
	_, e := a.Pool.Exec(r.Context(), "INSERT INTO report_exports(id,owner_id,params) VALUES($1,$2,$3)", id, current(r).StaffID, b)
	if e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	a.logEvent(r.Context(), current(r).StaffID, "export.requested", id, params)
	httpx.JSON(w, 202, map[string]string{"id": id})
}

func (a *App) getExport(w http.ResponseWriter, r *http.Request) {
	out, e := database.QueryMaps(r.Context(), a.Pool, `SELECT id,status,progress,error,created_at AS "createdAt" FROM report_exports WHERE id=$1 AND owner_id=$2`, r.PathValue("id"), current(r).StaffID)
	if e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	if len(out) == 0 {
		httpx.Error(w, 404, "گزارش پیدا نشد")
		return
	}
	httpx.JSON(w, 200, out[0])
}

func (a *App) retryExport(w http.ResponseWriter, r *http.Request) {
	tag, e := a.Pool.Exec(r.Context(), "UPDATE report_exports SET status='pending',progress=0,error='',updated_at=now() WHERE id=$1 AND owner_id=$2 AND status='failed'", r.PathValue("id"), current(r).StaffID)
	if e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	if tag.RowsAffected() == 0 {
		httpx.Error(w, 409, "گزارش قابل تکرار نیست")
		return
	}
	httpx.JSON(w, 200, map[string]bool{"ok": true})
}

func (a *App) downloadExport(w http.ResponseWriter, r *http.Request) {
	var content []byte
	e := a.Pool.QueryRow(r.Context(), "SELECT content FROM report_exports WHERE id=$1 AND owner_id=$2 AND status='ready'", r.PathValue("id"), current(r).StaffID).Scan(&content)
	if e != nil {
		httpx.Error(w, 404, "گزارش هنوز آماده نیست")
		return
	}
	w.Header().Set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
	w.Header().Set("Content-Disposition", `attachment; filename="omnisire.xlsx"`)
	w.Write(content)
}

func (a *App) ProcessExports(ctx context.Context) error {
	// Claim/recover work with a lease. A bounded timeout is shorter than the lease.
	var id, owner string
	var raw []byte
	e := a.Pool.QueryRow(ctx, `UPDATE report_exports SET status='running',attempts=attempts+1,updated_at=now() WHERE id=(SELECT id FROM report_exports WHERE status='pending' OR (status='running' AND updated_at<now()-interval '10 minutes') ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING id,owner_id,params`).Scan(&id, &owner, &raw)
	if e == pgx.ErrNoRows {
		return nil
	}
	if e != nil {
		return e
	}
	jobCtx, cancel := context.WithTimeout(ctx, 8*time.Minute)
	defer cancel()
	data, e := (&reporting.Service{Pool: a.Pool}).BuildWorkbook(jobCtx, id, raw)
	if e != nil {
		_, err := a.Pool.Exec(ctx, "UPDATE report_exports SET status='failed',error='ساخت گزارش انجام نشد؛ دوباره تلاش کنید',updated_at=now() WHERE id=$1", id)
		return errors.Join(e, err)
	}
	_, e = a.Pool.Exec(ctx, "UPDATE report_exports SET status='ready',content=$2,progress=100,updated_at=now() WHERE id=$1", id, data)
	if e == nil {
		a.logEvent(ctx, owner, "export.ready", id, map[string]string{})
	}
	return e
}
