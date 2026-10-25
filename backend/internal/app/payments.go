package app

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"time"

	"bomish/internal/httpx"
)

func (a *App) simulatePayment(w http.ResponseWriter, r *http.Request) {
	if !a.Dev {
		httpx.Error(w, 404, "یافت نشد")
		return
	}
	if !requireCustomer(w, r) {
		return
	}
	var in struct {
		Success bool `json:"success"`
	}
	if !httpx.Decode(w, r, &in) {
		return
	}
	status, e := a.settle(r.Context(), r.PathValue("id"), current(r).UserID, in.Success)
	if e != nil {
		httpx.Error(w, 409, e.Error())
		return
	}
	httpx.JSON(w, 200, map[string]string{"status": status})
}

func (a *App) settle(ctx context.Context, id, user string, success bool) (string, error) {
	tx, e := a.Pool.Begin(ctx)
	if e != nil {
		return "", e
	}
	defer tx.Rollback(ctx)
	var status, discountCode string
	var expires time.Time
	e = tx.QueryRow(ctx, "SELECT status,reservation_expires_at,coalesce(discount_code,'') FROM orders WHERE id=$1 AND user_id=$2 FOR UPDATE", id, user).Scan(&status, &expires, &discountCode)
	if e != nil {
		return "", errors.New("سفارش پیدا نشد")
	}
	if status != "pending" && status != "expired" {
		return status, nil
	}
	var paymentStatus string
	e = tx.QueryRow(ctx, "SELECT status FROM payment_attempts WHERE order_id=$1 FOR UPDATE", id).Scan(&paymentStatus)
	if e != nil {
		return "", e
	}
	if paymentStatus != "pending" {
		return status, nil
	}
	available := true
	if success && status == "expired" {
		capacity, err := reclaimDiscount(ctx, tx, discountCode, user)
		if err != nil {
			return "", err
		}
		available = available && capacity
	}
	final := "cancelled"
	if success {
		final = "paid"
		if !available {
			final = "review"
		}
	}
	if final == "paid" {
		_, e = tx.Exec(ctx, `DELETE FROM carts c USING order_items oi,sessions s WHERE oi.order_id=$1 AND c.product_id=oi.product_id AND c.package_id=oi.package_id AND c.quantity=oi.quantity AND c.session_hash=s.token_hash AND s.user_id=$2`, id, user)
		if e != nil {
			return "", e
		}
		if e = queueOrderSMS(ctx, tx, id, final); e != nil {
			return "", e
		}
	}
	paidAt := time.Now()
	if final == "paid" {
		if _, e = tx.Exec(ctx, "UPDATE orders SET paid_at=$2 WHERE id=$1", id, paidAt); e != nil {
			return "", e
		}
		if e = creditCommission(ctx, tx, id, user, paidAt); e != nil {
			return "", e
		}
	}
	if e = auditDetail(ctx, tx, "", "order."+final, id, map[string]string{"before": status, "after": final}); e != nil {
		return "", e
	}
	_, e = tx.Exec(ctx, "UPDATE orders SET status=$1 WHERE id=$2", final, id)
	if e == nil {
		ps := "failed"
		if success {
			ps = "verified"
		}
		_, e = tx.Exec(ctx, "UPDATE payment_attempts SET status=$1,reference=$2 WHERE order_id=$3", ps, "sim-"+id, id)
	}
	if e == nil {
		e = tx.Commit(ctx)
	}
	return final, e
}

func (a *App) ExpireReservations(ctx context.Context) error {
	tx, e := a.Pool.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	rows, e := tx.Query(ctx, "SELECT id FROM orders WHERE status='pending' AND reservation_expires_at<now() ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 100")
	if e != nil {
		return e
	}
	ids := []string{}
	for rows.Next() {
		var id string
		if e = rows.Scan(&id); e != nil {
			rows.Close()
			return e
		}
		ids = append(ids, id)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return e
	}
	for _, id := range ids {
		_, e = tx.Exec(ctx, "UPDATE orders SET status='expired' WHERE id=$1", id)
		if e == nil {
			e = auditDetail(ctx, tx, "", "order.expired", id, map[string]string{"before": "pending", "after": "expired"})
		}
		if e != nil {
			return e
		}
	}
	if e = tx.Commit(ctx); e != nil {
		return fmt.Errorf("expiry: %w", e)
	}
	return nil
}
