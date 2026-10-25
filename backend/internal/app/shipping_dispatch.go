package app

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"bomish/internal/httpx"
	"bomish/internal/packing"
	"bomish/internal/security"

	"github.com/jackc/pgx/v5"
)

func (a *App) dispatchQuote(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Version int64  `json:"version"`
		Method  string `json:"method"`
	}
	if !httpx.Decode(w, r, &in) {
		return
	}
	d, e := loadDelivery(r.Context(), a.Pool, r.PathValue("id"), false)
	if e != nil {
		httpx.Error(w, 404, "اطلاعات ارسال پیدا نشد")
		return
	}
	if !d.Ready || deliveryLocked(d.Status) {
		httpx.Error(w, 409, "ابتدا آمادگی ارسال را تأیید کنید")
		return
	}
	method := d.Method
	if in.Method != "" {
		method = in.Method
	}
	if method != "snapp" && method != "post" {
		httpx.Error(w, 400, "روش نامعتبر است")
		return
	}
	if method != d.Method && !can(r, "orders.manage") {
		httpx.Error(w, 403, "تغییر روش فقط برای مدیر مجاز است")
		return
	}
	s := d.Snapshot
	s.Items = orderUnits(d)
	s.Method = method
	s.Parcels = d.Parcels
	if method == "snapp" {
		ok, reason := snappEligible(s.Config, s.Destination, orderUnits(d))
		if !ok {
			httpx.Error(w, 422, reason)
			return
		}
		s.Parcels = []packing.Parcel{}
	} else {
		if method != d.Method {
			s.Parcels, e = postalPacking(orderUnits(d), s.Config)
			if e != nil {
				httpx.Error(w, 422, e.Error())
				return
			}
		}
		if e = postalEligible(s.Config, s.Destination, s.Parcels); e != nil {
			httpx.Error(w, 422, e.Error())
			return
		}
	}
	q, e := a.shippingProvider(method).Quote(r.Context(), shippingRequest(s))
	if e != nil {
		shippingError(w, 503, "provider_unavailable", e.Error())
		return
	}
	expiry := time.Now().Add(time.Minute)
	if !q.ExpiresAt.IsZero() && q.ExpiresAt.Before(expiry) {
		expiry = q.ExpiresAt
	}
	a.deliveryMutation(w, r, in.Version, func(tx pgx.Tx, d *deliveryRecord, status string) error {
		if e := editableDelivery(*d, status); e != nil {
			return e
		}
		if !d.Ready {
			return errors.New("آمادگی ارسال تغییر کرده")
		}
		d.Review = &dispatchReview{ID: security.Token(), Version: d.Version + 1, Method: method, ExpiresAt: expiry, Quote: q, Parcels: s.Parcels}
		return nil
	})
}

func (a *App) bookShipment(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Version         int64  `json:"version"`
		DispatchQuoteID string `json:"dispatchQuoteId"`
		IdempotencyKey  string `json:"idempotencyKey"`
	}
	if !httpx.Decode(w, r, &in) {
		return
	}
	if len(in.IdempotencyKey) < 16 || len(in.IdempotencyKey) > 100 {
		httpx.Error(w, 400, "شناسه درخواست معتبر نیست")
		return
	}
	var existing string
	e := a.Pool.QueryRow(r.Context(), "SELECT id FROM shipment_attempts WHERE order_id=$1 AND idempotency_key=$2", r.PathValue("id"), in.IdempotencyKey).Scan(&existing)
	if e == nil {
		a.staffDelivery(w, r)
		return
	}
	a.deliveryMutation(w, r, in.Version, func(tx pgx.Tx, d *deliveryRecord, status string) error {
		if e := editableDelivery(*d, status); e != nil {
			return e
		}
		if !d.Ready || d.Method != "snapp" || d.Review == nil || d.Review.ID != in.DispatchQuoteID || d.Review.Method != d.Method || d.Review.Version != d.Version || time.Now().After(d.Review.ExpiresAt) {
			return errors.New("بررسی هزینه منقضی یا تغییر کرده؛ دوباره هزینه را بررسی کنید")
		}
		if e := readyValidation(r.Context(), tx, *d); e != nil {
			return e
		}
		id := security.Token()
		s := d.Snapshot
		s.Items = orderUnits(*d)
		s.Parcels = []packing.Parcel{}
		req := shippingRequest(s)
		req.Reference = id
		raw, _ := json.Marshal(req)
		_, e := tx.Exec(r.Context(), "INSERT INTO shipment_attempts(id,order_id,idempotency_key,reference,request,actor) VALUES($1,$2,$3,$1,$4,$5)", id, d.OrderID, in.IdempotencyKey, raw, current(r).StaffID)
		if e != nil {
			return errors.New("درخواست فعال دیگری وجود دارد؛ وضعیت را تازه کنید")
		}
		d.Status = "submitting"
		d.Review = nil
		return nil
	})
}

func (a *App) refreshShipment(w http.ResponseWriter, r *http.Request) {
	_, e := a.Pool.Exec(r.Context(), "UPDATE shipment_attempts SET available_at=now() WHERE order_id=$1 AND status NOT IN ('delivered','cancelled','failed')", r.PathValue("id"))
	if e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	if e = a.ProcessShipments(r.Context()); e != nil {
		shippingError(w, 503, "provider_unavailable", "درخواست ذخیره شده؛ دریافت وضعیت تازه انجام نشد")
		return
	}
	a.staffDelivery(w, r)
}

func (a *App) cancelShipment(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Version   int64 `json:"version"`
		Confirmed bool  `json:"confirmed"`
	}
	if !httpx.Decode(w, r, &in) {
		return
	}
	a.deliveryMutation(w, r, in.Version, func(tx pgx.Tx, d *deliveryRecord, status string) error {
		if !in.Confirmed || (d.Status != "awaiting_courier" && d.Status != "accepted") {
			return errors.New("لغو در این وضعیت مجاز نیست یا تأیید نشده است")
		}
		tag, e := tx.Exec(r.Context(), "UPDATE shipment_attempts SET cancel_started_at=now(),status='unknown',available_at=now() WHERE id=$1 AND order_id=$2 AND status IN ('awaiting_courier','accepted') AND cancel_started_at IS NULL", r.PathValue("shipmentId"), d.OrderID)
		if e != nil {
			return e
		}
		if tag.RowsAffected() != 1 {
			return errors.New("درخواست لغو قبلاً ثبت شده؛ وضعیت را تازه کنید")
		}
		d.Status = "unknown"
		return nil
	})
}

func (a *App) resolveShipment(w http.ResponseWriter, r *http.Request) {
	if !can(r, "orders.manage") {
		httpx.Error(w, 403, "رفع ابهام فقط برای مدیر مجاز است")
		return
	}
	var in struct {
		Version            int64  `json:"version"`
		Reason             string `json:"reason"`
		ConfirmedNoBooking bool   `json:"confirmedNoBooking"`
	}
	if !httpx.Decode(w, r, &in) {
		return
	}
	a.deliveryMutation(w, r, in.Version, func(tx pgx.Tx, d *deliveryRecord, status string) error {
		if d.Status != "unknown" || !in.ConfirmedNoBooking || len(strings.TrimSpace(in.Reason)) < 10 {
			return errors.New("نبود درخواست فعال را با ارائه‌دهنده بررسی و مدرک پیگیری را ثبت کنید")
		}
		tag, e := tx.Exec(r.Context(), "UPDATE shipment_attempts SET status='failed',updated_at=now() WHERE order_id=$1 AND status='unknown' AND (lease_until IS NULL OR lease_until<now())", d.OrderID)
		if e != nil {
			return e
		}
		if tag.RowsAffected() != 1 {
			return errors.New("بررسی خودکار هنوز فعال است؛ کمی بعد تلاش کنید")
		}
		d.Status = "failed"
		d.Review = nil
		return auditDetail(r.Context(), tx, current(r).StaffID, "shipping.resolve", d.OrderID, in)
	})
}
