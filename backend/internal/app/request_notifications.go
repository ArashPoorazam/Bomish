package app

import "net/http"

func (a *App) requestNotifications(w http.ResponseWriter, r *http.Request) {
	out := map[string]int64{"support": 0, "custom": 0, "orders": 0, "supportEvent": 0, "customEvent": 0, "orderEvent": 0}
	if can(r, "requests") {
		var support, custom, supportEvent, customEvent int64
		e := a.Pool.QueryRow(r.Context(), `
			SELECT count(*) FILTER (WHERE q.kind='support'),
			       count(*) FILTER (WHERE q.kind='custom'),
			       coalesce((SELECT max(id) FROM request_messages WHERE staff_id IS NULL),0),
			       coalesce((SELECT (extract(epoch FROM created_at)*1000000)::bigint FROM customer_requests WHERE kind='custom' ORDER BY created_at DESC LIMIT 1),0)
			FROM customer_requests q
			WHERE NOT EXISTS(SELECT 1 FROM request_reads rr WHERE rr.staff_id=$1 AND rr.request_id=q.id AND rr.last_message_id>=coalesce((SELECT max(id) FROM request_messages WHERE request_id=q.id AND staff_id IS NULL),0))`, current(r).StaffID).Scan(&support, &custom, &supportEvent, &customEvent)
		if e != nil {
			a.dbError(w, e)
			return
		}
		out["support"], out["custom"] = support, custom
		out["supportEvent"], out["customEvent"] = supportEvent, customEvent
	}
	if can(r, "orders") {
		var count, event int64
		e := a.Pool.QueryRow(r.Context(), `
			SELECT count(*), coalesce((SELECT (extract(epoch FROM created_at)*1000000)::bigint FROM orders ORDER BY created_at DESC LIMIT 1),0)
			FROM orders o WHERE status IN ('pending','paid','packing','shipped','review')
			AND NOT EXISTS(SELECT 1 FROM order_reads rr WHERE rr.staff_id=$1 AND rr.order_id=o.id)`, current(r).StaffID).Scan(&count, &event)
		if e != nil {
			a.dbError(w, e)
			return
		}
		out["orders"], out["orderEvent"] = count, event
	}
	write(w, 200, out)
}
func (a *App) readRequest(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Last int64 `json:"lastMessageId"`
	}
	if !decode(w, r, &in) {
		return
	}
	if in.Last < 0 {
		fail(w, 400, "نشانگر معتبر نیست")
		return
	}
	tag, e := a.Pool.Exec(r.Context(), `INSERT INTO request_reads(staff_id,request_id,last_message_id) SELECT $1,q.id,$3::bigint FROM customer_requests q WHERE q.id=$2 AND ($3::bigint=0 OR EXISTS(SELECT 1 FROM request_messages WHERE request_id=q.id AND id=$3)) ON CONFLICT(staff_id,request_id) DO UPDATE SET last_message_id=greatest(request_reads.last_message_id,excluded.last_message_id)`, current(r).StaffID, r.PathValue("id"), in.Last)
	if e != nil {
		a.dbError(w, e)
		return
	}
	if tag.RowsAffected() == 0 {
		fail(w, 404, "درخواست پیدا نشد")
		return
	}
	write(w, 200, map[string]bool{"ok": true})
}
func (a *App) readOrder(w http.ResponseWriter, r *http.Request) {
	_, e := a.Pool.Exec(r.Context(), `INSERT INTO order_reads(staff_id,order_id) SELECT $1,id FROM orders WHERE id=$2 ON CONFLICT DO NOTHING`, current(r).StaffID, r.PathValue("id"))
	if e != nil {
		a.dbError(w, e)
		return
	}
	write(w, 200, map[string]bool{"ok": true})
}
