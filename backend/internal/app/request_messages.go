package app

import (
	"context"
	"github.com/jackc/pgx/v5"
	"net/http"
	"strconv"
	"strings"
	"time"
)

func (a *App) customerMessages(w http.ResponseWriter, r *http.Request) {
	if requireCustomer(w, r) {
		a.messages(w, r, false)
	}
}
func (a *App) staffMessages(w http.ResponseWriter, r *http.Request) { a.messages(w, r, true) }
func (a *App) customerMessage(w http.ResponseWriter, r *http.Request) {
	if requireCustomer(w, r) {
		a.sendMessage(w, r, false)
	}
}
func (a *App) staffMessage(w http.ResponseWriter, r *http.Request) { a.sendMessage(w, r, true) }
func (a *App) requestAccess(w http.ResponseWriter, r *http.Request, staff bool) bool {
	uid := current(r).UserID
	if staff {
		uid = ""
	}
	var found bool
	e := a.Pool.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM customer_requests WHERE id=$1 AND kind='support' AND ($2='' OR user_id=$2))`, r.PathValue("id"), uid).Scan(&found)
	if e != nil {
		a.dbError(w, e)
		return false
	}
	if !found {
		fail(w, 404, "گفتگو پیدا نشد")
		return false
	}
	return true
}
func (a *App) messages(w http.ResponseWriter, r *http.Request, staff bool) {
	if !a.requestAccess(w, r, staff) {
		return
	}
	after, before := int64(0), int64(0)
	q := r.URL.Query()
	latest := q.Get("latest") == "true"
	if (q.Has("latest") && !latest) || (q.Has("after") && (q.Has("before") || q.Has("latest"))) || (q.Has("before") && q.Has("latest")) {
		fail(w, 400, "نشانگر معتبر نیست")
		return
	}
	for name, target := range map[string]*int64{"after": &after, "before": &before} {
		if q.Has(name) {
			value, err := strconv.ParseInt(q.Get(name), 10, 64)
			if err != nil || value < 0 || (name == "before" && value == 0) {
				fail(w, 400, "نشانگر معتبر نیست")
				return
			}
			*target = value
		}
	}
	query := `SELECT id,body,staff_id IS NOT NULL AS "fromStaff",created_at AS "createdAt" FROM request_messages WHERE request_id=$1 AND id>$2 ORDER BY id LIMIT 100`
	cursor := after
	if latest || before > 0 {
		condition := ""
		if before > 0 {
			condition = " AND id<$2"
			cursor = before
		}
		query = `SELECT * FROM (SELECT id,body,staff_id IS NOT NULL AS "fromStaff",created_at AS "createdAt" FROM request_messages WHERE request_id=$1` + condition + ` ORDER BY id DESC LIMIT 100) page ORDER BY id`
	}
	args := []any{r.PathValue("id")}
	if !latest {
		args = append(args, cursor)
	}
	rows, e := queryMaps(r.Context(), a.Pool, query, args...)
	if e != nil {
		a.dbError(w, e)
		return
	}
	write(w, 200, rows)
}
func (a *App) sendMessage(w http.ResponseWriter, r *http.Request, staff bool) {
	if !a.requestAccess(w, r, staff) {
		return
	}
	var in struct {
		Body string `json:"body"`
		Key  string `json:"idempotencyKey"`
	}
	if !decode(w, r, &in) {
		return
	}
	in.Body = strings.TrimSpace(in.Body)
	if !validText(in.Body, 4000) || !validRequestKey(in.Key) {
		fail(w, 400, "پیام باید بین ۱ و ۴۰۰۰ نویسه باشد")
		return
	}
	identity := current(r).UserID
	var staffID any
	if staff {
		identity = current(r).StaffID
		staffID = identity
	}
	if !a.limit(r, "chat:"+identity, 60, time.Minute) {
		fail(w, 429, "پیام‌ها زیاد است؛ کمی صبر کنید")
		return
	}
	tx, e := a.Pool.Begin(r.Context())
	if e != nil {
		a.dbError(w, e)
		return
	}
	defer tx.Rollback(r.Context())
	// Thread lock gives message IDs commit order, so incremental polling never skips a message.
	if _, e = tx.Exec(r.Context(), `SELECT id FROM customer_requests WHERE id=$1 FOR UPDATE`, r.PathValue("id")); e != nil {
		a.dbError(w, e)
		return
	}
	id, e := saveRequestMessage(r.Context(), tx, r.PathValue("id"), staffID, in.Body, in.Key)
	if e == pgx.ErrNoRows {
		fail(w, 409, "شناسه پیام قبلاً استفاده شده است")
		return
	}
	if e == nil {
		e = tx.Commit(r.Context())
	}
	if e != nil {
		a.dbError(w, e)
		return
	}
	write(w, 201, map[string]int64{"id": id})
}

// The caller holds the thread lock. Retries must match both sender and body;
// ErrNoRows identifies an idempotency key already used for a different message.
func saveRequestMessage(ctx context.Context, tx pgx.Tx, requestID string, staffID any, body, key string) (int64, error) {
	var id int64
	err := tx.QueryRow(ctx, `INSERT INTO request_messages(request_id,staff_id,body,idempotency_key) VALUES($1,$2,$3,$4) ON CONFLICT(request_id,idempotency_key) DO NOTHING RETURNING id`, requestID, staffID, body, key).Scan(&id)
	if err == pgx.ErrNoRows {
		err = tx.QueryRow(ctx, `SELECT id FROM request_messages WHERE request_id=$1 AND idempotency_key=$2 AND staff_id IS NOT DISTINCT FROM $3 AND body=$4`, requestID, key, staffID, body).Scan(&id)
	}
	if err == nil {
		_, err = tx.Exec(ctx, `UPDATE customer_requests SET updated_at=now() WHERE id=$1`, requestID)
	}
	return id, err
}
