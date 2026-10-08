package app

import (
	"bomish/internal/carrier"
	"bomish/internal/domain"
	"bomish/internal/packing"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/jackc/pgx/v5"
	"net/http"
	"strings"
	"time"
)

type dispatchReview struct {
	ID        string        `json:"id"`
	Version   int64         `json:"version"`
	Method    string        `json:"method"`
	ExpiresAt time.Time     `json:"expiresAt"`
	Quote     carrier.Quote `json:"quote"`
}
type deliveryRecord struct {
	OrderID         string                 `json:"orderId"`
	Version         int64                  `json:"version"`
	Method          string                 `json:"method"`
	Status          string                 `json:"status"`
	Ready           bool                   `json:"ready"`
	Snapshot        shippingSnapshot       `json:"snapshot"`
	Parcels         []packing.Parcel       `json:"parcels"`
	ActualCostRials *int64                 `json:"actualCostRials"`
	Review          *dispatchReview        `json:"review"`
	AllowedActions  []string               `json:"allowedActions"`
	Events          []domain.DeliveryEvent `json:"events"`
	AttemptID       string                 `json:"attemptId"`
	DriverName      string                 `json:"driverName,omitempty"`
	DriverPhone     string                 `json:"driverPhone,omitempty"`
	UpdatedAt       time.Time              `json:"updatedAt"`
}

func loadDelivery(ctx context.Context, q querier, id string, lock bool) (deliveryRecord, error) {
	d := deliveryRecord{OrderID: id, AllowedActions: []string{}, Events: []domain.DeliveryEvent{}}
	var raw, parcels, review []byte
	suffix := ""
	if lock {
		suffix = " FOR UPDATE"
	}
	e := q.QueryRow(ctx, "SELECT version,method,delivery_status,ready,snapshot,parcels,actual_cost_rials,dispatch_quote,updated_at FROM order_shipping WHERE order_id=$1"+suffix, id).Scan(&d.Version, &d.Method, &d.Status, &d.Ready, &raw, &parcels, &d.ActualCostRials, &review, &d.UpdatedAt)
	if e != nil {
		return d, e
	}
	if e = json.Unmarshal(raw, &d.Snapshot); e != nil {
		return d, e
	}
	if e = json.Unmarshal(parcels, &d.Parcels); e != nil {
		return d, e
	}
	if len(review) > 0 {
		if e = json.Unmarshal(review, &d.Review); e != nil {
			return d, e
		}
	}
	return d, nil
}
func deliveryLocked(status string) bool {
	return status != "not_requested" && status != "cancelled" && status != "failed"
}
func (a *App) staffDelivery(w http.ResponseWriter, r *http.Request) {
	d, e := loadDelivery(r.Context(), a.Pool, r.PathValue("id"), false)
	if e == pgx.ErrNoRows {
		write(w, 200, nil)
		return
	}
	if e != nil {
		a.dbError(w, e)
		return
	}
	var status string
	if e = a.Pool.QueryRow(r.Context(), "SELECT status FROM orders WHERE id=$1", d.OrderID).Scan(&status); e != nil {
		a.dbError(w, e)
		return
	}
	if (status == "paid" || status == "packing") && !deliveryLocked(d.Status) {
		d.AllowedActions = append(d.AllowedActions, "edit_parcels", "ready")
		if d.Ready {
			d.AllowedActions = append(d.AllowedActions, "dispatch_quote")
			if d.Method == "snapp" {
				d.AllowedActions = append(d.AllowedActions, "book")
			} else {
				d.AllowedActions = append(d.AllowedActions, "postal_dispatch")
			}
		}
		if current(r).Role == "owner" || current(r).Role == "manager" {
			d.AllowedActions = append(d.AllowedActions, "change_method")
		}
	}
	if d.Method == "post" && status == "shipped" {
		d.AllowedActions = append(d.AllowedActions, "delivered")
	}
	if d.Method == "post" && (status == "paid" || status == "packing" || status == "shipped" || status == "received") {
		d.AllowedActions = append(d.AllowedActions, "postal_details")
	}
	if d.Method == "snapp" && d.Status != "not_requested" {
		d.AllowedActions = append(d.AllowedActions, "refresh")
	}
	if d.Status == "awaiting_courier" || d.Status == "accepted" {
		d.AllowedActions = append(d.AllowedActions, "cancel")
	}
	if d.Status == "unknown" && (current(r).Role == "owner" || current(r).Role == "manager") {
		d.AllowedActions = append(d.AllowedActions, "resolve")
	}
	var response []byte
	e = a.Pool.QueryRow(r.Context(), "SELECT id,response FROM shipment_attempts WHERE order_id=$1 ORDER BY created_at DESC LIMIT 1", d.OrderID).Scan(&d.AttemptID, &response)
	if e != nil && e != pgx.ErrNoRows {
		a.dbError(w, e)
		return
	}
	if len(response) > 0 {
		var booking carrier.Booking
		if e = json.Unmarshal(response, &booking); e != nil {
			a.dbError(w, e)
			return
		}
		d.DriverName, d.DriverPhone = booking.DriverName, booking.DriverPhone
	}
	d.Events, e = deliveryEvents(r.Context(), a.Pool, d.OrderID)
	if e != nil {
		a.dbError(w, e)
		return
	}
	write(w, 200, d)
}
func deliveryEvents(ctx context.Context, q querier, id string) ([]domain.DeliveryEvent, error) {
	out := []domain.DeliveryEvent{}
	rows, e := q.Query(ctx, "SELECT status,occurred_at FROM delivery_events WHERE order_id=$1 ORDER BY occurred_at,id", id)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	for rows.Next() {
		var v domain.DeliveryEvent
		var t time.Time
		if e = rows.Scan(&v.Status, &t); e != nil {
			return nil, e
		}
		v.CreatedAt = t.Format(time.RFC3339)
		out = append(out, v)
	}
	return out, rows.Err()
}
func attachDelivery(ctx context.Context, q querier, o *domain.Order) error {
	d, e := loadDelivery(ctx, q, o.ID, false)
	if e == pgx.ErrNoRows {
		return nil
	}
	if e != nil {
		return e
	}
	v := &domain.Delivery{Method: d.Method, Service: d.Snapshot.Service, Status: d.Status, Simulated: d.Snapshot.CarrierQuote.Simulated, Parcels: []domain.CustomerParcel{}}
	for _, p := range d.Parcels {
		url := ""
		if d.Method == "post" && validTracking(p.Tracking) {
			url = postalTrackingURL(p.Tracking)
		}
		v.Parcels = append(v.Parcels, domain.CustomerParcel{ID: p.ID, Tracking: p.Tracking, TrackingURL: url})
	}
	v.Events, e = deliveryEvents(ctx, q, o.ID)
	o.Shipping = v
	return e
}
func saveDelivery(ctx context.Context, tx pgx.Tx, d deliveryRecord) error {
	parcels, _ := json.Marshal(d.Parcels)
	snapshot, _ := json.Marshal(d.Snapshot)
	var review []byte
	if d.Review != nil {
		review, _ = json.Marshal(d.Review)
	}
	_, e := tx.Exec(ctx, "UPDATE order_shipping SET version=version+1,method=$2,delivery_status=$3,ready=$4,snapshot=$5,parcels=$6,actual_cost_rials=$7,dispatch_quote=$8,updated_at=now() WHERE order_id=$1", d.OrderID, d.Method, d.Status, d.Ready, snapshot, parcels, d.ActualCostRials, review)
	return e
}
func (a *App) deliveryMutation(w http.ResponseWriter, r *http.Request, version int64, fn func(pgx.Tx, *deliveryRecord, string) error) {
	ctx := r.Context()
	tx, e := a.Pool.Begin(ctx)
	if e != nil {
		a.dbError(w, e)
		return
	}
	defer tx.Rollback(ctx)
	var status string
	e = tx.QueryRow(ctx, "SELECT status FROM orders WHERE id=$1 FOR UPDATE", r.PathValue("id")).Scan(&status)
	if e != nil {
		fail(w, 404, "سفارش پیدا نشد")
		return
	}
	d, e := loadDelivery(ctx, tx, r.PathValue("id"), true)
	if e != nil {
		fail(w, 404, "اطلاعات ارسال پیدا نشد")
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
		a.dbError(w, e)
		return
	}
	a.staffDelivery(w, r)
}
func orderUnits(d deliveryRecord) []packing.Item {
	out := []packing.Item{}
	for _, p := range d.Snapshot.Parcels {
		for _, v := range p.Placements {
			out = append(out, v.Item)
		}
	}
	return out
}
func editableDelivery(d deliveryRecord, status string) error {
	if status != "paid" && status != "packing" {
		return errors.New("پرداخت تأییدشده و سفارش ارسال‌نشده لازم است")
	}
	if deliveryLocked(d.Status) {
		return carrier.ErrUnknown
	}
	return nil
}
func (a *App) correctParcels(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Version int64            `json:"version"`
		Parcels []packing.Parcel `json:"parcels"`
		Reason  string           `json:"reason"`
	}
	if !decode(w, r, &in) {
		return
	}
	a.deliveryMutation(w, r, in.Version, func(tx pgx.Tx, d *deliveryRecord, status string) error {
		if e := editableDelivery(*d, status); e != nil {
			return e
		}
		if strings.TrimSpace(in.Reason) == "" {
			return errors.New("دلیل اصلاح را بنویسید")
		}
		cfg, e := readShippingConfig(r.Context(), tx, true)
		if e != nil {
			return e
		}
		for i, p := range in.Parcels {
			found := false
			for _, b := range cfg.Boxes {
				if p.Box.ID == b.ID && b.Active && b.Verified {
					in.Parcels[i].Box = b
					found = true
					break
				}
			}
			if !found {
				return errors.New("کارتن فعال پیدا نشد")
			}
			in.Parcels[i].Tracking = ""
			in.Parcels[i].ActualCostRials = nil
		}
		if e = packing.ValidateCorrections(in.Parcels, orderUnits(*d)); e != nil {
			return e
		}
		d.Parcels = in.Parcels
		d.Ready = false
		d.Review = nil
		return auditDetail(r.Context(), tx, current(r).StaffID, "shipping.parcels", d.OrderID, map[string]any{"reason": in.Reason, "parcels": in.Parcels})
	})
}
func readyValidation(ctx context.Context, tx pgx.Tx, d deliveryRecord) error {
	var incomplete int
	e := tx.QueryRow(ctx, "SELECT count(*) FROM order_items WHERE order_id=$1 AND NOT packed", d.OrderID).Scan(&incomplete)
	if e != nil {
		return e
	}
	if incomplete > 0 {
		return errors.New("همه ردیف‌های سفارش را در چک‌لیست تأیید کنید")
	}
	for _, p := range d.Parcels {
		if !p.Confirmed {
			return errors.New("بسته‌بندی واقعی همه کارتن‌ها را تأیید کنید")
		}
	}
	if e = packing.ValidateCorrections(d.Parcels, orderUnits(d)); e != nil {
		return e
	}
	if e = d.Snapshot.Destination.Validate(); e != nil {
		return e
	}
	if d.Method == "snapp" {
		ok, reason := snappEligible(d.Snapshot.Config, d.Snapshot.Destination, d.Parcels)
		if !ok {
			return errors.New(reason)
		}
	} else if e = postalEligible(d.Snapshot.Config, d.Snapshot.Destination, d.Parcels); e != nil {
		return e
	}
	return nil
}
func (a *App) readyOrder(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Version int64 `json:"version"`
	}
	if !decode(w, r, &in) {
		return
	}
	a.deliveryMutation(w, r, in.Version, func(tx pgx.Tx, d *deliveryRecord, status string) error {
		if e := editableDelivery(*d, status); e != nil {
			return e
		}
		if e := readyValidation(r.Context(), tx, *d); e != nil {
			return e
		}
		d.Ready = true
		d.Review = nil
		if _, e := tx.Exec(r.Context(), "UPDATE orders SET status='packing' WHERE id=$1", d.OrderID); e != nil {
			return e
		}
		return queueOrderSMS(r.Context(), tx, d.OrderID, "packing")
	})
}
func (a *App) dispatchQuote(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Version int64  `json:"version"`
		Method  string `json:"method"`
	}
	if !decode(w, r, &in) {
		return
	}
	d, e := loadDelivery(r.Context(), a.Pool, r.PathValue("id"), false)
	if e != nil {
		fail(w, 404, "اطلاعات ارسال پیدا نشد")
		return
	}
	if !d.Ready || deliveryLocked(d.Status) {
		fail(w, 409, "ابتدا آمادگی ارسال را تأیید کنید")
		return
	}
	method := d.Method
	if in.Method != "" {
		method = in.Method
	}
	if method != "snapp" && method != "post" {
		fail(w, 400, "روش نامعتبر است")
		return
	}
	if method != d.Method && current(r).Role != "owner" && current(r).Role != "manager" {
		fail(w, 403, "تغییر روش فقط برای مدیر مجاز است")
		return
	}
	s := d.Snapshot
	s.Method = method
	s.Parcels = d.Parcels
	if method == "snapp" {
		ok, reason := snappEligible(s.Config, s.Destination, s.Parcels)
		if !ok {
			fail(w, 422, reason)
			return
		}
	} else if e = postalEligible(s.Config, s.Destination, s.Parcels); e != nil {
		fail(w, 422, e.Error())
		return
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
		d.Review = &dispatchReview{ID: token(), Version: d.Version + 1, Method: method, ExpiresAt: expiry, Quote: q}
		return nil
	})
}
func (a *App) bookShipment(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Version         int64  `json:"version"`
		DispatchQuoteID string `json:"dispatchQuoteId"`
		IdempotencyKey  string `json:"idempotencyKey"`
	}
	if !decode(w, r, &in) {
		return
	}
	if len(in.IdempotencyKey) < 16 || len(in.IdempotencyKey) > 100 {
		fail(w, 400, "شناسه درخواست معتبر نیست")
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
		id := token()
		s := d.Snapshot
		s.Parcels = d.Parcels
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
		a.dbError(w, e)
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
	if !decode(w, r, &in) {
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
func (a *App) changeDeliveryMethod(w http.ResponseWriter, r *http.Request) {
	if current(r).Role != "owner" && current(r).Role != "manager" {
		fail(w, 403, "تغییر روش فقط برای مدیر مجاز است")
		return
	}
	var in struct {
		Version         int64  `json:"version"`
		Method          string `json:"method"`
		Reason          string `json:"reason"`
		CustomerConsent bool   `json:"customerConsent"`
		DispatchQuoteID string `json:"dispatchQuoteId"`
	}
	if !decode(w, r, &in) {
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
	if !decode(w, r, &in) {
		return
	}
	in.Tracking = domain.Normalize(strings.TrimSpace(in.Tracking))
	a.deliveryMutation(w, r, in.Version, func(tx pgx.Tx, d *deliveryRecord, status string) error {
		if d.Method != "post" || (status != "paid" && status != "packing" && status != "shipped" && status != "received") {
			return errors.New("ثبت رهگیری فقط برای مرسوله پستی پرداخت‌شده مجاز است")
		}
		if !validTracking(in.Tracking) || (in.ActualCostRials != nil && (*in.ActualCostRials < 0 || *in.ActualCostRials > 100000000000)) {
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
func (a *App) resolveShipment(w http.ResponseWriter, r *http.Request) {
	if current(r).Role != "owner" && current(r).Role != "manager" {
		fail(w, 403, "رفع ابهام فقط برای مدیر مجاز است")
		return
	}
	var in struct {
		Version            int64  `json:"version"`
		Reason             string `json:"reason"`
		ConfirmedNoBooking bool   `json:"confirmedNoBooking"`
	}
	if !decode(w, r, &in) {
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

// The same predicate is applied to list rows and counts before pagination.
func deliveryFilterSQL(provider, attention int) string {
	return fmt.Sprintf(` AND ($%d='' OR coalesce((SELECT method FROM order_shipping ds WHERE ds.order_id=orders.id),'legacy_postal')=$%d) AND ($%d='' OR EXISTS(SELECT 1 FROM order_shipping ds WHERE ds.order_id=orders.id AND (($%d='ready' AND ds.ready AND ds.delivery_status IN ('not_requested','cancelled','failed')) OR ($%d='waiting' AND ds.delivery_status IN ('submitting','awaiting_courier','accepted')) OR ($%d='unknown' AND ds.delivery_status='unknown') OR ($%d='failed' AND ds.delivery_status IN ('failed','returning')) OR ($%d='missing' AND NOT ds.ready AND orders.status IN ('paid','packing')))))`, provider, provider, attention, attention, attention, attention, attention, attention)
}
