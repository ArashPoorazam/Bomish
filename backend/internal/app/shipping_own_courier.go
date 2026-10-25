package app

import (
	"errors"
	"net/http"
	"strings"

	"bomish/internal/domain"
	"bomish/internal/httpx"

	"github.com/jackc/pgx/v5"
)

type staffCourier struct {
	ID       string `json:"id"`
	FullName string `json:"fullName"`
	Phone    string `json:"phone"`
}

// Fulfillment staff need the active courier roster, not member financial data.
func (a *App) shippingCouriers(w http.ResponseWriter, r *http.Request) {
	rows, err := a.Pool.Query(r.Context(), `SELECT id,full_name,phone FROM staff WHERE role='courier' AND active AND archived_at IS NULL ORDER BY full_name,id`)
	if err != nil {
		httpx.DatabaseError(w, err)
		return
	}
	defer rows.Close()
	couriers := []staffCourier{}
	for rows.Next() {
		var c staffCourier
		if err = rows.Scan(&c.ID, &c.FullName, &c.Phone); err != nil {
			httpx.DatabaseError(w, err)
			return
		}
		couriers = append(couriers, c)
	}
	if err = rows.Err(); err != nil {
		httpx.DatabaseError(w, err)
		return
	}
	httpx.JSON(w, 200, couriers)
}

func (a *App) dispatchOwnCourier(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Version   int64  `json:"version"`
		CourierID string `json:"courierId"`
	}
	if !httpx.Decode(w, r, &in) {
		return
	}
	if strings.TrimSpace(in.CourierID) == "" {
		httpx.Error(w, 400, "همکار پیک را انتخاب کنید")
		return
	}
	a.deliveryMutation(w, r, in.Version, func(tx pgx.Tx, d *deliveryRecord, status string) error {
		if err := editableDelivery(*d, status); err != nil {
			return err
		}
		if d.Method != "snapp" || !d.Ready || status != "packing" || d.AssignedCourier != nil {
			return errors.New("ابتدا بسته‌بندی و آمادگی ارسال سفارش تهران را تأیید کنید")
		}
		if err := readyValidation(r.Context(), tx, *d); err != nil {
			return err
		}
		var active bool
		if err := tx.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM shipment_attempts WHERE order_id=$1 AND status NOT IN ('cancelled','failed'))`, d.OrderID).Scan(&active); err != nil {
			return err
		}
		if active {
			return errors.New("ابتدا وضعیت درخواست اسنپ را مشخص و لغو آن را تأیید کنید")
		}
		var courier staffCourier
		// Serialize against role changes, suspension and archiving.
		if err := tx.QueryRow(r.Context(), `SELECT id,full_name,phone FROM staff WHERE id=$1 AND role='courier' AND active AND archived_at IS NULL FOR SHARE`, in.CourierID).Scan(&courier.ID, &courier.FullName, &courier.Phone); err != nil {
			if err == pgx.ErrNoRows {
				return errors.New("این همکار پیک فعال نیست؛ فهرست پیک‌ها را تازه کنید")
			}
			return err
		}
		d.AssignedCourier = &courier
		d.Status = "picked_up"
		d.Review = nil
		// A Snapp quote is not the actual cost of our courier.
		d.ActualCostRials = nil
		return a.recordOwnCourierMilestone(r, tx, d, "shipped")
	})
}

func (a *App) deliverOwnCourier(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Version int64 `json:"version"`
	}
	if !httpx.Decode(w, r, &in) {
		return
	}
	a.deliveryMutation(w, r, in.Version, func(tx pgx.Tx, d *deliveryRecord, status string) error {
		if d.AssignedCourier == nil || d.Status != "picked_up" || status != "shipped" {
			return errors.New("ابتدا سفارش را به پیک بومیش تحویل دهید")
		}
		d.Status = "delivered"
		return a.recordOwnCourierMilestone(r, tx, d, "received")
	})
}

func (a *App) recordOwnCourierMilestone(r *http.Request, tx pgx.Tx, d *deliveryRecord, stage string) error {
	ctx := r.Context()
	if _, err := tx.Exec(ctx, `UPDATE orders SET status=$2 WHERE id=$1`, d.OrderID, stage); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `INSERT INTO delivery_events(order_id,event_key,status,actor) VALUES($1,$2,$3,$4)`, d.OrderID, d.OrderID+":own_courier:"+d.Status, d.Status, current(r).StaffID); err != nil {
		return err
	}
	if err := queueOrderSMS(ctx, tx, d.OrderID, stage, &domain.CourierContact{Name: d.AssignedCourier.FullName, Phone: d.AssignedCourier.Phone}); err != nil {
		return err
	}
	return auditDetail(ctx, tx, current(r).StaffID, "shipping.own-courier."+stage, d.OrderID, map[string]any{"courier": d.AssignedCourier, "status": d.Status})
}
