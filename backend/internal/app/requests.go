package app

import (
	"github.com/jackc/pgx/v5"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"
)

func (a *App) requestRoutes(m *http.ServeMux) {
	m.HandleFunc("GET /api/v1/requests", a.customerRequests)
	m.HandleFunc("POST /api/v1/requests", a.createRequest)
	m.HandleFunc("GET /api/v1/requests/{id}/messages", a.customerMessages)
	m.HandleFunc("POST /api/v1/requests/{id}/messages", a.customerMessage)
	m.HandleFunc("GET /api/v1/staff/requests", a.permit(a.staffRequests, "requests"))
	m.HandleFunc("PATCH /api/v1/staff/requests/{id}", a.permit(a.decideRequest, "requests"))
	m.HandleFunc("GET /api/v1/staff/requests/{id}/messages", a.permit(a.staffMessages, "requests"))
	m.HandleFunc("POST /api/v1/staff/requests/{id}/messages", a.permit(a.staffMessage, "requests"))
	m.HandleFunc("POST /api/v1/staff/requests/{id}/read", a.permit(a.readRequest, "requests"))
	m.HandleFunc("GET /api/v1/staff/notifications", a.permitAny(a.requestNotifications, "requests", "orders"))
	m.HandleFunc("POST /api/v1/staff/orders/{id}/read", a.permit(a.readOrder, "orders"))
}

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
		fail(w, 400, "نوع درخواست معتبر نیست")
		return
	}
	owner := ""
	extra := ""
	join := ""
	if !staff {
		owner = current(r).UserID
	} else {
		extra = `,u.phone,NOT EXISTS(SELECT 1 FROM request_reads rr WHERE rr.request_id=q.id AND rr.staff_id=$5 AND rr.last_message_id>=coalesce((SELECT max(id) FROM request_messages WHERE request_id=q.id AND staff_id IS NULL),0)) AS unread`
		join = " JOIN users u ON u.id=q.user_id"
	}
	page, size := pageArgs(r)
	args := []any{kind, owner, size, (page - 1) * size}
	if staff {
		args = append(args, current(r).StaffID)
	}
	rows, e := queryMaps(r.Context(), a.Pool, `SELECT `+requestColumns+extra+` FROM customer_requests q`+join+` WHERE q.kind=$1 AND ($2='' OR q.user_id=$2) ORDER BY q.updated_at DESC,q.id LIMIT $3 OFFSET $4`, args...)
	if e != nil {
		a.dbError(w, e)
		return
	}
	var total int64
	if e = a.Pool.QueryRow(r.Context(), `SELECT count(*) FROM customer_requests WHERE kind=$1 AND ($2='' OR user_id=$2)`, kind, owner).Scan(&total); e != nil {
		a.dbError(w, e)
		return
	}
	listResponse(w, r, rows, total)
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
	if !decode(w, r, &in) {
		return
	}
	in.Description = strings.TrimSpace(in.Description)
	in.Quantity = strings.TrimSpace(in.Quantity)
	if (in.Kind != "support" && in.Kind != "custom") || !validText(in.Description, 4000) || !validRequestKey(in.Key) || in.Budget < 0 || in.Budget > 100000000000 || (in.Kind == "support" && (in.Quantity != "" || in.Budget != 0)) || (in.Kind == "custom" && (!validText(in.Quantity, 200) || in.Budget == 0)) {
		fail(w, 400, "شرح، مقدار و بودجه معتبر وارد کنید")
		return
	}
	if !a.limit(r, "requests:"+current(r).UserID, 30, time.Hour) {
		fail(w, 429, "درخواست‌ها زیاد است؛ کمی بعد تلاش کنید")
		return
	}
	tx, e := a.Pool.Begin(r.Context())
	if e != nil {
		a.dbError(w, e)
		return
	}
	defer tx.Rollback(r.Context())
	// Serialize per customer, including concurrent first support messages and retries.
	if _, e = tx.Exec(r.Context(), `SELECT id FROM users WHERE id=$1 FOR UPDATE`, current(r).UserID); e != nil {
		a.dbError(w, e)
		return
	}
	id := token()
	var existing, kind, description, quantity, originalKey string
	var budget int64
	e = tx.QueryRow(r.Context(), `SELECT id,kind,description,quantity,budget_rials,idempotency_key FROM customer_requests WHERE user_id=$1 AND (idempotency_key=$2 OR (kind='support' AND $3='support')) ORDER BY (idempotency_key=$2) DESC LIMIT 1 FOR UPDATE`, current(r).UserID, in.Key, in.Kind).Scan(&existing, &kind, &description, &quantity, &budget, &originalKey)
	if e == nil {
		if kind != in.Kind || (in.Kind == "custom" && (description != in.Description || quantity != in.Quantity || budget != in.Budget)) || (in.Kind == "support" && originalKey == in.Key && description != in.Description) {
			fail(w, 409, "شناسه درخواست قبلاً برای اطلاعات دیگری استفاده شده است")
			return
		}
		id = existing
	} else if e == pgx.ErrNoRows {
		_, e = tx.Exec(r.Context(), `INSERT INTO customer_requests(id,user_id,kind,description,quantity,budget_rials,idempotency_key) VALUES($1,$2,$3,$4,$5,$6,$7)`, id, current(r).UserID, in.Kind, in.Description, in.Quantity, in.Budget, in.Key)
	}
	if e == nil && in.Kind == "support" {
		_, e = saveRequestMessage(r.Context(), tx, id, nil, in.Description, in.Key)
		if e == pgx.ErrNoRows {
			fail(w, 409, "شناسه پیام قبلاً استفاده شده است")
			return
		}
	}
	if e == nil {
		e = tx.Commit(r.Context())
	}
	if e != nil {
		a.dbError(w, e)
		return
	}
	write(w, 201, map[string]string{"id": id})
}
func (a *App) decideRequest(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Status   string `json:"status"`
		Response string `json:"response"`
		Version  int    `json:"version"`
	}
	if !decode(w, r, &in) {
		return
	}
	in.Response = strings.TrimSpace(in.Response)
	if (in.Status != "accepted" && in.Status != "rejected" && in.Status != "follow_up") || !validText(in.Response, 4000) || in.Version < 1 {
		fail(w, 400, "وضعیت و توضیح پاسخ را وارد کنید")
		return
	}
	tx, e := a.Pool.Begin(r.Context())
	if e != nil {
		a.dbError(w, e)
		return
	}
	defer tx.Rollback(r.Context())
	tag, e := tx.Exec(r.Context(), `UPDATE customer_requests SET status=$2,response=$3,version=version+1,updated_at=now() WHERE id=$1 AND kind='custom' AND version=$4`, r.PathValue("id"), in.Status, in.Response, in.Version)
	if e != nil {
		a.dbError(w, e)
		return
	}
	if tag.RowsAffected() == 0 {
		fail(w, 409, "درخواست تغییر کرده یا پیدا نشد؛ تازه کنید و دوباره بررسی کنید")
		return
	}
	if e = auditDetail(r.Context(), tx, current(r).StaffID, "request.decision", r.PathValue("id"), in); e == nil {
		e = tx.Commit(r.Context())
	}
	if e != nil {
		a.dbError(w, e)
		return
	}
	write(w, 200, map[string]bool{"ok": true})
}
