package app

import (
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"bomish/internal/database"
	"bomish/internal/httpx"
	"bomish/internal/security"

	"github.com/jackc/pgx/v5"
)

const requestColumns = `q.id,q.kind,q.description,q.quantity,q.budget_rials AS "budgetRials",q.status,q.response,q.version,q.created_at AS "createdAt",q.updated_at AS "updatedAt"`

func validText(s string, max int) bool {
	return strings.TrimSpace(s) != "" && !strings.ContainsRune(s, 0) && utf8.RuneCountInString(s) <= max
}
func validRequestKey(s string) bool {
	if len(s) < 16 || len(s) > 100 {
		return false
	}
	for _, c := range s {
		if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '-' || c == '_') {
			return false
		}
	}
	return true
}
func (a *App) customerRequests(w http.ResponseWriter, r *http.Request) {
	if !requireCustomer(w, r) {
		return
	}
	a.listRequests(w, r, false)
}
func (a *App) staffRequests(w http.ResponseWriter, r *http.Request) { a.listRequests(w, r, true) }
func (a *App) listRequests(w http.ResponseWriter, r *http.Request, staff bool) {
	kind := r.URL.Query().Get("kind")
	if kind != "support" && kind != "custom" {
		httpx.Error(w, 400, "نوع درخواست معتبر نیست")
		return
	}
	if staff {
		a.listStaffRequests(w, r, kind)
		return
	}
	owner := current(r).UserID
	page, size := httpx.PageArgs(r)
	rows, e := database.QueryMaps(r.Context(), a.Pool, `SELECT `+requestColumns+` FROM customer_requests q WHERE q.kind=$1 AND q.user_id=$2 ORDER BY q.updated_at DESC,q.id LIMIT $3 OFFSET $4`, kind, owner, size, (page-1)*size)
	if e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	var total int64
	if e = a.Pool.QueryRow(r.Context(), `SELECT count(*) FROM customer_requests WHERE kind=$1 AND ($2='' OR user_id=$2)`, kind, owner).Scan(&total); e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	httpx.List(w, r, rows, total)
}
func (a *App) createRequest(w http.ResponseWriter, r *http.Request) {
	if !requireCustomer(w, r) {
		return
	}
	var in struct {
		Kind        string `json:"kind"`
		Description string `json:"description"`
		Quantity    string `json:"quantity"`
		Budget      int64  `json:"budgetRials"`
		Key         string `json:"idempotencyKey"`
	}
	picture, ok := decodeChat(w, r, &in)
	if !ok {
		return
	}
	in.Description = strings.TrimSpace(in.Description)
	if in.Description == "" && len(picture) > 0 {
		in.Description = "تصویر"
	}
	if len(picture) > 0 && in.Kind != "support" {
		httpx.Error(w, 400, "تصویر فقط برای گفتگو مجاز است")
		return
	}
	in.Quantity = strings.TrimSpace(in.Quantity)
	if (in.Kind != "support" && in.Kind != "custom") || !validText(in.Description, 4000) || !validRequestKey(in.Key) || in.Budget < 0 || in.Budget > 100000000000 || (in.Kind == "support" && (in.Quantity != "" || in.Budget != 0)) || (in.Kind == "custom" && (!validText(in.Quantity, 200) || in.Budget == 0)) {
		httpx.Error(w, 400, "شرح، مقدار و بودجه معتبر وارد کنید")
		return
	}
	if !a.limit(r, "requests:"+current(r).UserID, 30, time.Hour) {
		httpx.Error(w, 429, "درخواست‌ها زیاد است؛ کمی بعد تلاش کنید")
		return
	}
	tx, e := a.Pool.Begin(r.Context())
	if e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	defer tx.Rollback(r.Context())
	// Serialize per customer, including concurrent first support messages and retries.
	if _, e = tx.Exec(r.Context(), `SELECT id FROM users WHERE id=$1 FOR UPDATE`, current(r).UserID); e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	id := security.Token()
	var existing, kind, description, quantity, originalKey string
	var budget int64
	e = tx.QueryRow(r.Context(), `SELECT id,kind,description,quantity,budget_rials,idempotency_key FROM customer_requests WHERE user_id=$1 AND (idempotency_key=$2 OR (kind='support' AND $3='support')) ORDER BY (idempotency_key=$2) DESC LIMIT 1 FOR UPDATE`, current(r).UserID, in.Key, in.Kind).Scan(&existing, &kind, &description, &quantity, &budget, &originalKey)
	if e == nil {
		if kind != in.Kind || (in.Kind == "custom" && (description != in.Description || quantity != in.Quantity || budget != in.Budget)) || (in.Kind == "support" && originalKey == in.Key && description != in.Description) {
			httpx.Error(w, 409, "شناسه درخواست قبلاً برای اطلاعات دیگری استفاده شده است")
			return
		}
		id = existing
	} else if e == pgx.ErrNoRows {
		_, e = tx.Exec(r.Context(), `INSERT INTO customer_requests(id,user_id,kind,description,quantity,budget_rials,idempotency_key) VALUES($1,$2,$3,$4,$5,$6,$7)`, id, current(r).UserID, in.Kind, in.Description, in.Quantity, in.Budget, in.Key)
	}
	if e == nil && in.Kind == "support" {
		_, e = saveRequestMessage(r.Context(), tx, id, nil, in.Description, in.Key, picture)
		if e == pgx.ErrNoRows {
			httpx.Error(w, 409, "شناسه پیام قبلاً استفاده شده است")
			return
		}
	}
	if e == nil {
		e = tx.Commit(r.Context())
	}
	if e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	httpx.JSON(w, 201, map[string]string{"id": id})
}
func (a *App) decideRequest(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Status   string `json:"status"`
		Response string `json:"response"`
		Version  int    `json:"version"`
	}
	if !httpx.Decode(w, r, &in) {
		return
	}
	in.Response = strings.TrimSpace(in.Response)
	if (in.Status != "accepted" && in.Status != "rejected" && in.Status != "follow_up") || !validText(in.Response, 4000) || in.Version < 1 {
		httpx.Error(w, 400, "وضعیت و توضیح پاسخ را وارد کنید")
		return
	}
	tx, e := a.Pool.Begin(r.Context())
	if e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	defer tx.Rollback(r.Context())
	tag, e := tx.Exec(r.Context(), `UPDATE customer_requests SET status=$2,response=$3,version=version+1,updated_at=now() WHERE id=$1 AND kind='custom' AND version=$4`, r.PathValue("id"), in.Status, in.Response, in.Version)
	if e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	if tag.RowsAffected() == 0 {
		httpx.Error(w, 409, "درخواست تغییر کرده یا پیدا نشد؛ تازه کنید و دوباره بررسی کنید")
		return
	}
	if e = auditDetail(r.Context(), tx, current(r).StaffID, "request.decision", r.PathValue("id"), in); e == nil {
		e = tx.Commit(r.Context())
	}
	if e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	httpx.JSON(w, 200, map[string]bool{"ok": true})
}
