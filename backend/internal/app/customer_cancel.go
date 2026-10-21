package app

import (
	"context"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
)

func (a *App) cancelOrder(w http.ResponseWriter, r *http.Request) {
	if !requireCustomer(w, r) {
		return
	}
	ctx := r.Context()
	tx, err := a.Pool.Begin(ctx)
	if err != nil {
		a.dbError(w, err)
		return
	}
	defer tx.Rollback(ctx)
	id := r.PathValue("id")
	var status string
	err = tx.QueryRow(ctx, "SELECT status FROM orders WHERE id=$1 AND user_id=$2 FOR UPDATE", id, current(r).UserID).Scan(&status)
	if err == pgx.ErrNoRows {
		fail(w, 404, "سفارش پیدا نشد")
		return
	}
	if err != nil {
		a.dbError(w, err)
		return
	}
	if status == "cancelled" {
		write(w, 200, map[string]bool{"ok": true})
		return
	}
	if status != "pending" && status != "paid" && status != "packing" && status != "review" {
		fail(w, 409, "این سفارش دیگر قابل لغو نیست")
		return
	}
	var shipped bool
	err = tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM order_shipping WHERE order_id=$1 AND delivery_status IN ('picked_up','delivered','returning'))", id).Scan(&shipped)
	if err != nil {
		a.dbError(w, err)
		return
	}
	if shipped {
		fail(w, 409, "سفارش ارسال‌شده قابل لغو نیست")
		return
	}
	// Serialize with dispatch and confirm carrier cancellation before accepting a refund obligation.
	rows, err := tx.Query(ctx, "SELECT id,reference,status FROM shipment_attempts WHERE order_id=$1 AND status NOT IN ('cancelled','failed') FOR UPDATE", id)
	if err != nil {
		a.dbError(w, err)
		return
	}
	type attempt struct{ id, reference, status string }
	var attempts []attempt
	for rows.Next() {
		var v attempt
		if err = rows.Scan(&v.id, &v.reference, &v.status); err != nil {
			break
		}
		attempts = append(attempts, v)
	}
	if err == nil {
		err = rows.Err()
	}
	rows.Close()
	if err != nil {
		a.dbError(w, err)
		return
	}
	for _, v := range attempts {
		if v.status != "awaiting_courier" && v.status != "accepted" {
			fail(w, 409, "وضعیت ارسال در حال بررسی است؛ لطفاً کمی بعد دوباره تلاش کنید یا با پشتیبانی تماس بگیرید")
			return
		}
		networkCtx, stop := context.WithTimeout(ctx, 10*time.Second)
		booking, cancelErr := a.courier().Cancel(networkCtx, v.reference)
		stop()
		if cancelErr != nil || booking.Reference != v.reference || booking.Status != "cancelled" {
			fail(w, 409, "لغو ارسال هنوز تأیید نشده است؛ لطفاً دوباره تلاش کنید یا با پشتیبانی تماس بگیرید")
			return
		}
		if _, err = tx.Exec(ctx, "UPDATE shipment_attempts SET status='cancelled',cancel_started_at=now(),cancel_invoked_at=now(),lease_until=NULL,lease_token=NULL,updated_at=now() WHERE id=$1", v.id); err != nil {
			a.dbError(w, err)
			return
		}
	}
	_, err = tx.Exec(ctx, "UPDATE orders SET status='cancelled' WHERE id=$1", id)
	if err == nil {
		_, err = tx.Exec(ctx, "UPDATE order_shipping SET delivery_status='cancelled',ready=false,version=version+1,updated_at=now() WHERE order_id=$1", id)
	}
	if err == nil {
		_, err = tx.Exec(ctx, "INSERT INTO order_events(order_id,status) VALUES($1,'cancelled') ON CONFLICT DO NOTHING", id)
	}
	if err == nil {
		err = auditDetail(ctx, tx, "", "order.cancelled", id, map[string]any{"before": status, "after": "cancelled", "customerId": current(r).UserID, "refundRequired": status != "pending"})
	}
	if err == nil {
		err = tx.Commit(ctx)
	}
	if err != nil {
		a.dbError(w, err)
		return
	}
	write(w, 200, map[string]bool{"ok": true})
}
