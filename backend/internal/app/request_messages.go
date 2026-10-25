package app

import (
	"context"
	"net/http"
	"strconv"
	"strings"
	"time"

	"bomish/internal/database"
	"bomish/internal/httpx"

	"github.com/jackc/pgx/v5"
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
		httpx.DatabaseError(w, e)
		return false
	}
	if !found {
		httpx.Error(w, 404, "گفتگو پیدا نشد")
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
		httpx.Error(w, 400, "نشانگر معتبر نیست")
		return
	}
	for name, target := range map[string]*int64{"after": &after, "before": &before} {
		if q.Has(name) {
			value, err := strconv.ParseInt(q.Get(name), 10, 64)
			if err != nil || value < 0 || (name == "before" && value == 0) {
				httpx.Error(w, 400, "نشانگر معتبر نیست")
				return
			}
			*target = value
		}
	}
	query := `SELECT id,body,image IS NOT NULL AS "hasImage",staff_id IS NOT NULL AS "fromStaff",created_at AS "createdAt" FROM request_messages WHERE request_id=$1 AND id>$2 ORDER BY id LIMIT 100`
	cursor := after
	if latest || before > 0 {
		condition := ""
		if before > 0 {
			condition = " AND id<$2"
			cursor = before
		}
		query = `SELECT * FROM (SELECT id,body,image IS NOT NULL AS "hasImage",staff_id IS NOT NULL AS "fromStaff",created_at AS "createdAt" FROM request_messages WHERE request_id=$1` + condition + ` ORDER BY id DESC LIMIT 100) page ORDER BY id`
	}
	args := []any{r.PathValue("id")}
	if !latest {
		args = append(args, cursor)
	}
	rows, e := database.QueryMaps(r.Context(), a.Pool, query, args...)
	if e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	httpx.JSON(w, 200, rows)
}
func (a *App) sendMessage(w http.ResponseWriter, r *http.Request, staff bool) {
	if !a.requestAccess(w, r, staff) {
		return
	}
	var in struct {
		Body string `json:"body"`
		Key  string `json:"idempotencyKey"`
	}
	picture, ok := decodeChat(w, r, &in)
	if !ok {
		return
	}
	in.Body = strings.TrimSpace(in.Body)
	if in.Body == "" && len(picture) > 0 {
		in.Body = "تصویر"
	}
	if !validText(in.Body, 4000) || !validRequestKey(in.Key) {
		httpx.Error(w, 400, "پیام باید بین ۱ و ۴۰۰۰ نویسه باشد")
		return
	}
	identity := current(r).UserID
	var staffID any
	if staff {
		identity = current(r).StaffID
		staffID = identity
	}
	if !a.limit(r, "chat:"+identity, 60, time.Minute) {
		httpx.Error(w, 429, "پیام‌ها زیاد است؛ کمی صبر کنید")
		return
	}
	tx, e := a.Pool.Begin(r.Context())
	if e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	defer tx.Rollback(r.Context())
	// Thread lock gives message IDs commit order, so incremental polling never skips a message.
	if _, e = tx.Exec(r.Context(), `SELECT id FROM customer_requests WHERE id=$1 FOR UPDATE`, r.PathValue("id")); e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	id, e := saveRequestMessage(r.Context(), tx, r.PathValue("id"), staffID, in.Body, in.Key, picture)
	if e == pgx.ErrNoRows {
		httpx.Error(w, 409, "شناسه پیام قبلاً استفاده شده است")
		return
	}
	if e == nil {
		e = tx.Commit(r.Context())
	}
	if e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	httpx.JSON(w, 201, map[string]int64{"id": id})
}

// The caller holds the thread lock. Retries must match both sender and body;
// ErrNoRows identifies an idempotency key already used for a different message.
func saveRequestMessage(ctx context.Context, tx pgx.Tx, requestID string, staffID any, body, key string, image []byte) (int64, error) {
	var id int64
	err := tx.QueryRow(ctx, `INSERT INTO request_messages(request_id,staff_id,body,idempotency_key,image) VALUES($1,$2,$3,$4,$5) ON CONFLICT(request_id,idempotency_key) DO NOTHING RETURNING id`, requestID, staffID, body, key, image).Scan(&id)
	if err == pgx.ErrNoRows {
		err = tx.QueryRow(ctx, `SELECT id FROM request_messages WHERE request_id=$1 AND idempotency_key=$2 AND staff_id IS NOT DISTINCT FROM $3 AND body=$4 AND image IS NOT DISTINCT FROM $5`, requestID, key, staffID, body, image).Scan(&id)
	}
	if err == nil {
		_, err = tx.Exec(ctx, `UPDATE customer_requests SET updated_at=now() WHERE id=$1`, requestID)
	}
	return id, err
}
