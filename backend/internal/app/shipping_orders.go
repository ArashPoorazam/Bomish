package app

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"bomish/internal/carrier"
	"bomish/internal/domain"
	"bomish/internal/httpx"
	"bomish/internal/packing"

	"github.com/jackc/pgx/v5"
)

func deliveryLocked(status string) bool {
	return status != "not_requested" && status != "cancelled" && status != "failed"
}

func (a *App) staffDelivery(w http.ResponseWriter, r *http.Request) {
	d, e := loadDelivery(r.Context(), a.Pool, r.PathValue("id"), false)
	if e == pgx.ErrNoRows {
		httpx.JSON(w, 200, nil)
		return
	}
	if e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	var status string
	if e = a.Pool.QueryRow(r.Context(), "SELECT status FROM orders WHERE id=$1", d.OrderID).Scan(&status); e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	if (status == "paid" || status == "packing") && !deliveryLocked(d.Status) {
		d.AllowedActions = append(d.AllowedActions, "ready")
		if d.Method == "post" {
			d.AllowedActions = append(d.AllowedActions, "edit_parcels")
		}
		if d.Ready {
			d.AllowedActions = append(d.AllowedActions, "dispatch_quote")
			if d.Method == "snapp" {
				d.AllowedActions = append(d.AllowedActions, "book", "own_courier_dispatch")
			} else {
				d.AllowedActions = append(d.AllowedActions, "postal_dispatch")
			}
		}
		if can(r, "orders.manage") {
			d.AllowedActions = append(d.AllowedActions, "change_method")
		}
	}
	if d.AssignedCourier != nil && status == "shipped" && d.Status == "picked_up" {
		d.AllowedActions = append(d.AllowedActions, "own_courier_delivered")
	}
	if d.Method == "post" && status == "shipped" {
		d.AllowedActions = append(d.AllowedActions, "delivered")
	}
	if d.Method == "post" && (status == "paid" || status == "packing" || status == "shipped" || status == "received") {
		d.AllowedActions = append(d.AllowedActions, "postal_details")
	}
	if d.Method == "snapp" && d.AssignedCourier == nil && d.Status != "not_requested" {
		d.AllowedActions = append(d.AllowedActions, "refresh")
	}
	if d.Status == "awaiting_courier" || d.Status == "accepted" {
		d.AllowedActions = append(d.AllowedActions, "cancel")
	}
	if d.Status == "unknown" && (can(r, "orders.manage")) {
		d.AllowedActions = append(d.AllowedActions, "resolve")
	}
	if !can(r, "orders.edit") {
		d.AllowedActions = []string{}
	}
	var response []byte
	e = a.Pool.QueryRow(r.Context(), "SELECT id,response FROM shipment_attempts WHERE order_id=$1 ORDER BY created_at DESC LIMIT 1", d.OrderID).Scan(&d.AttemptID, &response)
	if e != nil && e != pgx.ErrNoRows {
		httpx.DatabaseError(w, e)
		return
	}
	if len(response) > 0 && d.AssignedCourier == nil {
		var booking carrier.Booking
		if e = json.Unmarshal(response, &booking); e != nil {
			httpx.DatabaseError(w, e)
			return
		}
		d.DriverName, d.DriverPhone = booking.DriverName, booking.DriverPhone
	}
	d.Events, e = deliveryEvents(r.Context(), a.Pool, d.OrderID)
	if e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	httpx.JSON(w, 200, d)
}

func (a *App) deliveryMutation(w http.ResponseWriter, r *http.Request, version int64, fn func(pgx.Tx, *deliveryRecord, string) error) {
	ctx := r.Context()
	tx, e := a.Pool.Begin(ctx)
	if e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	defer tx.Rollback(ctx)
	var status string
	e = tx.QueryRow(ctx, "SELECT status FROM orders WHERE id=$1 FOR UPDATE", r.PathValue("id")).Scan(&status)
	if e != nil {
		httpx.Error(w, 404, "سفارش پیدا نشد")
		return
	}
	d, e := loadDelivery(ctx, tx, r.PathValue("id"), true)
	if e != nil {
		httpx.Error(w, 404, "اطلاعات ارسال پیدا نشد")
		return
	}
	if version != d.Version {
		shippingError(w, 409, "stale_version", "سفارش تغییر کرده؛ نسخه تازه را دریافت کنید")
		return
	}
	if e = fn(tx, &d, status); e != nil {
		shippingError(w, 409, "delivery_conflict", e.Error())
		return
	}
	if e = saveDelivery(ctx, tx, d); e == nil {
		e = auditDetail(ctx, tx, current(r).StaffID, "shipping."+r.PathValue("action"), d.OrderID, map[string]any{"path": r.URL.Path, "version": d.Version})
	}
	if e == nil {
		e = tx.Commit(ctx)
	}
	if e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	a.staffDelivery(w, r)
}

func (a *App) changeDeliveryMethod(w http.ResponseWriter, r *http.Request) {
	if !can(r, "orders.manage") {
		httpx.Error(w, 403, "تغییر روش فقط برای مدیر مجاز است")
		return
	}
	var in struct {
		Version         int64  `json:"version"`
		Method          string `json:"method"`
		Reason          string `json:"reason"`
		CustomerConsent bool   `json:"customerConsent"`
		DispatchQuoteID string `json:"dispatchQuoteId"`
	}
	if !httpx.Decode(w, r, &in) {
		return
	}
	a.deliveryMutation(w, r, in.Version, func(tx pgx.Tx, d *deliveryRecord, status string) error {
		if e := editableDelivery(*d, status); e != nil {
			return e
		}
		if !in.CustomerConsent || strings.TrimSpace(in.Reason) == "" || d.Review == nil || d.Review.ID != in.DispatchQuoteID || d.Review.Method != in.Method || d.Review.Version != d.Version || time.Now().After(d.Review.ExpiresAt) {
			return errors.New("رضایت مشتری، دلیل و بررسی هزینه تازه لازم است")
		}
		previousMethod := d.Method
		d.Snapshot.Items = orderUnits(*d)
		d.Parcels = d.Review.Parcels
		if in.Method == "snapp" {
			d.Parcels = []packing.Parcel{}
		}
		reviewedCost := d.Review.Quote.CostRials
		d.Method = in.Method
		d.Snapshot.Method = in.Method
		d.Snapshot.Service = d.Snapshot.Config.Tapin.Service
		if in.Method == "snapp" {
			d.Snapshot.Service = d.Snapshot.Config.Snapp.Service
		}
		d.Status = "not_requested"
		d.Review = nil
		d.Ready = false
		return auditDetail(r.Context(), tx, current(r).StaffID, "shipping.method-change", d.OrderID, map[string]any{"before": previousMethod, "after": in.Method, "reason": in.Reason, "customerConsent": in.CustomerConsent, "reviewedCostRials": reviewedCost})
	})
}

func (a *App) postalParcel(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Version         int64  `json:"version"`
		Tracking        string `json:"tracking"`
		ActualCostRials *int64 `json:"actualCostRials"`
	}
	if !httpx.Decode(w, r, &in) {
		return
	}
	in.Tracking = domain.Normalize(strings.TrimSpace(in.Tracking))
	a.deliveryMutation(w, r, in.Version, func(tx pgx.Tx, d *deliveryRecord, status string) error {
		if d.Method != "post" || (status != "paid" && status != "packing" && status != "shipped" && status != "received") {
			return errors.New("ثبت رهگیری فقط برای مرسوله پستی پرداخت‌شده مجاز است")
		}
		if !domain.ValidPostalTracking(in.Tracking) || (in.ActualCostRials != nil && (*in.ActualCostRials < 0 || *in.ActualCostRials > 100000000000)) {
			return errors.New("کد رهگیری ۱۰ تا ۳۰ رقمی و هزینه معتبر لازم است")
		}
		found := false
		for i, p := range d.Parcels {
			if p.ID == r.PathValue("parcelId") {
				d.Parcels[i].Tracking = in.Tracking
				d.Parcels[i].ActualCostRials = in.ActualCostRials
				found = true
			} else if p.Tracking == in.Tracking {
				return errors.New("بارکد برای کارتن دیگری ثبت شده است")
			}
		}
		if !found {
			return errors.New("کارتن پیدا نشد")
		}
		var cost int64
		known := true
		for _, p := range d.Parcels {
			if p.ActualCostRials == nil {
				known = false
			} else {
				cost += *p.ActualCostRials
			}
		}
		d.ActualCostRials = nil
		if known {
			d.ActualCostRials = &cost
		}
		return nil
	})
}
