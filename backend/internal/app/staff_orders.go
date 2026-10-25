package app

import (
	"net/http"
	"os"
	"strings"

	"bomish/internal/domain"
	"bomish/internal/httpx"
	"bomish/internal/orderquery"

	"github.com/jackc/pgx/v5"
)

func (a *App) staffOrders(w http.ResponseWriter, r *http.Request) {
	page, size := httpx.PageArgs(r)
	q := r.URL.Query()
	status, search := q.Get("status"), q.Get("q")
	filter := orderquery.Filter{Status: status, Search: search, Limit: size, Offset: (page - 1) * size, Provider: q.Get("provider"), Attention: q.Get("attention"), TrackingTemplate: os.Getenv("POST_TRACKING_URL_TEMPLATE")}
	v, e := orderquery.Load(r.Context(), a.Pool, filter)
	if e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	total, e := orderquery.Count(r.Context(), a.Pool, filter)
	if e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	httpx.List(w, r, v, total)
}

func (a *App) updateOrder(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Status   string `json:"status"`
		Tracking string `json:"tracking"`
	}
	if !httpx.Decode(w, r, &in) {
		return
	}
	if in.Status != "packing" && in.Status != "shipped" && in.Status != "received" {
		httpx.Error(w, 400, "وضعیت مجاز نیست")
		return
	}
	in.Tracking = domain.Normalize(strings.TrimSpace(in.Tracking))
	var calculated bool
	if e := a.Pool.QueryRow(r.Context(), "SELECT EXISTS(SELECT 1 FROM order_shipping WHERE order_id=$1)", r.PathValue("id")).Scan(&calculated); e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	if !calculated && in.Status == "shipped" && !domain.ValidPostalTracking(in.Tracking) {
		httpx.Error(w, 400, "کد رهگیری لازم است")
		return
	}
	tx, e := a.Pool.Begin(r.Context())
	if e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	defer tx.Rollback(r.Context())
	// Checklist edits lock the same order, making validation and confirmation atomic.
	var currentStatus string
	if e = tx.QueryRow(r.Context(), "SELECT status FROM orders WHERE id=$1 FOR UPDATE", r.PathValue("id")).Scan(&currentStatus); e != nil {
		if e == pgx.ErrNoRows {
			httpx.Error(w, 404, "سفارش پیدا نشد")
			return
		}
		httpx.DatabaseError(w, e)
		return
	}
	if !calculated && (in.Status == "packing" || in.Status == "shipped") {
		var complete bool
		if e = tx.QueryRow(r.Context(), "SELECT count(*)>0 AND coalesce(bool_and(packed),false) FROM order_items WHERE order_id=$1", r.PathValue("id")).Scan(&complete); e != nil {
			httpx.DatabaseError(w, e)
			return
		}
		if !complete {
			httpx.Error(w, 409, "همه ردیف‌های سفارش را در چک‌لیست بسته‌بندی تأیید کنید")
			return
		}
	}
	if calculated {
		d, err := loadDelivery(r.Context(), tx, r.PathValue("id"), true)
		if err != nil {
			httpx.DatabaseError(w, err)
			return
		}
		if in.Status == "packing" || d.Method != "post" {
			httpx.Error(w, 409, "از پنل ارسال و تأیید آمادگی استفاده کنید")
			return
		}
		if in.Status == "shipped" {
			if !d.Ready || currentStatus != "packing" {
				httpx.Error(w, 409, "آمادگی ارسال کامل نیست")
				return
			}
			if err = readyValidation(r.Context(), tx, d); err != nil {
				httpx.Error(w, 409, err.Error())
				return
			}
			for _, p := range d.Parcels {
				if !domain.ValidPostalTracking(p.Tracking) {
					httpx.Error(w, 409, "بارکد همه کارتن‌ها لازم است")
					return
				}
			}
			in.Tracking = d.Parcels[0].Tracking
			d.Status = "picked_up"
		}
		if in.Status == "received" {
			if currentStatus != "shipped" {
				httpx.Error(w, 409, "ابتدا همه کارتن‌ها را ارسال کنید")
				return
			}
			d.Status = "delivered"
		}
		if e = saveDelivery(r.Context(), tx, d); e != nil {
			httpx.DatabaseError(w, e)
			return
		}
		if _, e = tx.Exec(r.Context(), "INSERT INTO delivery_events(order_id,event_key,status,actor) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING", d.OrderID, d.OrderID+":postal:"+d.Status, d.Status, current(r).StaffID); e != nil {
			httpx.DatabaseError(w, e)
			return
		}
	}
	previous := "paid"
	if in.Status == "shipped" {
		previous = "packing"
	}
	if in.Status == "received" {
		previous = "shipped"
	}
	tag, e := tx.Exec(r.Context(), "UPDATE orders SET status=$1,tracking=CASE WHEN $1='shipped' THEN $2 ELSE tracking END WHERE id=$3 AND status=$4", in.Status, in.Tracking, r.PathValue("id"), previous)
	if e != nil || tag.RowsAffected() == 0 {
		httpx.Error(w, 409, "تغییر وضعیت سفارش مجاز نیست")
		return
	}
	if e = queueOrderSMS(r.Context(), tx, r.PathValue("id"), in.Status); e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	if e = auditDetail(r.Context(), tx, current(r).StaffID, "order."+in.Status, r.PathValue("id"), map[string]string{"before": previous, "after": in.Status, "tracking": in.Tracking}); e == nil {
		e = tx.Commit(r.Context())
	}
	if e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	httpx.JSON(w, 200, map[string]bool{"ok": true})
}
