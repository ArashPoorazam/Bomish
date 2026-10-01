package app

import (
	"net/http"
	"strings"
	"unicode/utf8"
)

const staffRequestColumns = requestColumns + `,u.phone,
 NOT EXISTS(SELECT 1 FROM request_reads rr WHERE rr.request_id=q.id AND rr.staff_id=$2 AND rr.last_message_id>=coalesce((SELECT max(id) FROM request_messages WHERE request_id=q.id AND staff_id IS NULL),0)) AS unread,
 coalesce((SELECT left(body,140) FROM request_messages WHERE request_id=q.id ORDER BY id DESC LIMIT 1),'') AS "latestMessage"`

func (a *App) listStaffRequests(w http.ResponseWriter, r *http.Request, kind string) {
	q := r.URL.Query()
	search := strings.TrimSpace(q.Get("q"))
	status := q.Get("status")
	unread := q.Get("unread")
	if utf8.RuneCountInString(search) > 200 || (status != "" && (kind != "custom" || (status != "new" && status != "follow_up" && status != "accepted" && status != "rejected"))) || (unread != "" && unread != "true" && unread != "false") {
		fail(w, 400, "فیلتر درخواست معتبر نیست")
		return
	}
	// Escape LIKE metacharacters so search is a literal substring.
	search = strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(search)
	page, size := pageArgs(r)
	relation := ` FROM (SELECT ` + staffRequestColumns + ` FROM customer_requests q JOIN users u ON u.id=q.user_id WHERE q.kind=$1) inbox
 WHERE ($3='' OR phone ILIKE '%' || $3 || '%' OR description ILIKE '%' || $3 || '%') AND ($4='' OR status=$4) AND ($5='' OR unread=($5='true'))`
	args := []any{kind, current(r).StaffID, search, status, unread}
	rows, err := queryMaps(r.Context(), a.Pool, `SELECT *`+relation+` ORDER BY "updatedAt" DESC,id LIMIT $6 OFFSET $7`, append(args, size, (page-1)*size)...)
	if err != nil {
		a.dbError(w, err)
		return
	}
	var total int64
	if err = a.Pool.QueryRow(r.Context(), `SELECT count(*)`+relation, args...).Scan(&total); err != nil {
		a.dbError(w, err)
		return
	}
	listResponse(w, r, rows, total)
}

func (a *App) staffRequest(w http.ResponseWriter, r *http.Request) {
	rows, err := queryMaps(r.Context(), a.Pool, `SELECT `+staffRequestColumns+` FROM customer_requests q JOIN users u ON u.id=q.user_id WHERE q.id=$1`, r.PathValue("id"), current(r).StaffID)
	if err != nil {
		a.dbError(w, err)
		return
	}
	if len(rows) == 0 {
		fail(w, 404, "درخواست پیدا نشد")
		return
	}
	write(w, 200, rows[0])
}
