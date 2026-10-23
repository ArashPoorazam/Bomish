package app

import (
	"bomish/internal/carrier"
	"bomish/internal/domain"
	"context"
	"encoding/json"
	"github.com/jackc/pgx/v5"
	"net/http"
	"time"
)

// Claim and commit before crossing the network boundary. Expired leases always do
// a lookup after create_started_at: creation is never retried automatically.
func (a *App) ProcessShipments(ctx context.Context) error {
	for n := 0; n < 10; n++ {
		tx, e := a.Pool.Begin(ctx)
		if e != nil {
			return e
		}
		var id, order, reference string
		var raw []byte
		var started, cancelRequested, cancelInvoked *time.Time
		var failures int
		e = tx.QueryRow(ctx, `SELECT id,order_id,reference,request,create_started_at,cancel_started_at,cancel_invoked_at,failures FROM shipment_attempts WHERE status NOT IN ('delivered','cancelled','failed') AND available_at<=now() AND (lease_until IS NULL OR lease_until<now()) ORDER BY available_at FOR UPDATE SKIP LOCKED LIMIT 1`).Scan(&id, &order, &reference, &raw, &started, &cancelRequested, &cancelInvoked, &failures)
		if e == pgx.ErrNoRows {
			tx.Rollback(ctx)
			return nil
		}
		if e != nil {
			tx.Rollback(ctx)
			return e
		}
		lease := token()
		create := started == nil
		cancel := cancelRequested != nil && cancelInvoked == nil
		_, e = tx.Exec(ctx, `UPDATE shipment_attempts SET lease_until=now()+interval '45 seconds',lease_token=$2,create_started_at=coalesce(create_started_at,now()),cancel_invoked_at=CASE WHEN $3 THEN now() ELSE cancel_invoked_at END,updated_at=now() WHERE id=$1`, id, lease, cancel)
		if e == nil {
			e = tx.Commit(ctx)
		} else {
			tx.Rollback(ctx)
		}
		if e != nil {
			return e
		}
		var req carrier.Request
		if e = json.Unmarshal(raw, &req); e != nil {
			return e
		}
		networkCtx, stop := context.WithTimeout(ctx, 20*time.Second)
		var b carrier.Booking
		switch {
		case cancel:
			b, e = a.courier().Cancel(networkCtx, reference)
		case create:
			b, e = a.courier().Create(networkCtx, req)
		default:
			b, e = a.courier().Lookup(networkCtx, reference)
		}
		stop()
		if e != nil {
			tx, err := a.Pool.Begin(ctx)
			if err != nil {
				return err
			}
			_, err = tx.Exec(ctx, "SELECT id FROM orders WHERE id=$1 FOR UPDATE", order)
			if err == nil {
				tag, updateErr := tx.Exec(ctx, `UPDATE shipment_attempts SET status=CASE WHEN $3 THEN 'unknown' ELSE status END,failures=failures+1,available_at=now()+($4*interval '1 second'),lease_until=NULL,lease_token=NULL WHERE id=$1 AND lease_token=$2`, id, lease, create || cancel || started != nil, min(900, 60*(1<<min(failures, 4))))
				err = updateErr
				if err == nil && tag.RowsAffected() == 1 {
					_, err = tx.Exec(ctx, "UPDATE order_shipping SET delivery_status='unknown',updated_at=now(),version=version+1 WHERE order_id=$1 AND delivery_status NOT IN ('delivered','cancelled')", order)
				}
			}
			if err == nil {
				err = tx.Commit(ctx)
			} else {
				tx.Rollback(ctx)
			}
			if err != nil {
				return err
			}
			continue
		}
		if e = a.applyBooking(ctx, id, order, lease, b); e != nil {
			return e
		}
	}
	return nil
}
func nextDeliveryState(previous, next string) string {
	if previous == "delivered" {
		return previous
	}
	if next == "allocation_cancelled" {
		return previous
	}
	if next == "delivered" {
		return next
	}
	if previous == "cancelled" {
		return previous
	}
	rank := map[string]int{"submitting": 0, "unknown": 0, "awaiting_courier": 1, "accepted": 2, "picked_up": 3, "returning": 4, "failed": 4, "cancelled": 4}
	n, ok := rank[next]
	if !ok {
		return previous
	}
	if rank[previous] > n {
		return previous
	}
	return next
}
func (a *App) applyBooking(ctx context.Context, id, order, lease string, b carrier.Booking) error {
	tx, e := a.Pool.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	var orderStatus string
	if e = tx.QueryRow(ctx, "SELECT status FROM orders WHERE id=$1 FOR UPDATE", order).Scan(&orderStatus); e != nil {
		return e
	}
	d, e := loadDelivery(ctx, tx, order, true)
	if e != nil {
		return e
	}
	var ref, status, ownedLease string
	var previousResponse []byte
	if e = tx.QueryRow(ctx, "SELECT reference,status,coalesce(lease_token,''),response FROM shipment_attempts WHERE id=$1 FOR UPDATE", id).Scan(&ref, &status, &ownedLease, &previousResponse); e != nil {
		return e
	}
	if ownedLease != lease || b.Reference != ref || b.ID == "" {
		return nil
	}
	// Status-only updates must not discard a previously identified driver.
	var previousBooking carrier.Booking
	_ = json.Unmarshal(previousResponse, &previousBooking)
	if b.DriverName == "" {
		b.DriverName = previousBooking.DriverName
	}
	if b.DriverPhone == "" {
		b.DriverPhone = previousBooking.DriverPhone
	}
	confirmed := d.Status
	if confirmed == "unknown" {
		// A transport failure hides freshness, not the last confirmed milestone.
		// Recover it for this attempt before applying a possibly older lookup.
		e = tx.QueryRow(ctx, "SELECT status FROM delivery_events WHERE attempt_id=$1 ORDER BY id DESC LIMIT 1", id).Scan(&confirmed)
		if e != nil && e != pgx.ErrNoRows {
			return e
		}
	}
	next := nextDeliveryState(confirmed, b.Status)
	if b.CostRials != nil && (*b.CostRials < 0 || *b.CostRials > 100000000000) {
		return carrier.ErrUnavailable
	}
	if b.OccurredAt.IsZero() || b.OccurredAt.After(time.Now().Add(time.Minute)) {
		b.OccurredAt = time.Now()
	}
	d.Status = next
	if b.CostRials != nil {
		d.ActualCostRials = b.CostRials
	}
	raw, _ := json.Marshal(b)
	_, e = tx.Exec(ctx, "UPDATE shipment_attempts SET status=$2,provider_id=$3,response=$4,failures=0,available_at=now()+interval '60 seconds',lease_until=NULL,lease_token=NULL,updated_at=now() WHERE id=$1", id, next, b.ID, raw)
	if e != nil {
		return e
	}
	_, e = tx.Exec(ctx, "INSERT INTO delivery_events(order_id,attempt_id,event_key,status,external_status,occurred_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING", order, id, id+":"+next, next, b.Status, b.OccurredAt)
	if e != nil {
		return e
	}
	if next == "picked_up" || next == "delivered" {
		if orderStatus == "packing" {
			if _, e = tx.Exec(ctx, "UPDATE orders SET status='shipped' WHERE id=$1", order); e != nil {
				return e
			}
			if e = queueOrderSMS(ctx, tx, order, "shipped", &domain.CourierContact{Name: b.DriverName, Phone: b.DriverPhone}); e != nil {
				return e
			}
			orderStatus = "shipped"
		}
		if next == "delivered" && orderStatus == "shipped" {
			if _, e = tx.Exec(ctx, "UPDATE orders SET status='received' WHERE id=$1", order); e != nil {
				return e
			}
			if e = queueOrderSMS(ctx, tx, order, "received"); e != nil {
				return e
			}
		}
	}
	if e = saveDelivery(ctx, tx, d); e != nil {
		return e
	}
	if e = auditDetail(ctx, tx, "", "shipping.reconciled", order, map[string]any{"status": next, "costRials": d.ActualCostRials}); e != nil {
		return e
	}
	_, e = tx.Exec(ctx, "UPDATE shipping_webhooks SET processed_at=now() WHERE reference=$1 AND processed_at IS NULL", ref)
	if e != nil {
		return e
	}
	return tx.Commit(ctx)
}

// Unverified callback contracts are hints only: no incoming status or price is applied.
// Every known reference is persisted before acknowledgement and authenticated lookup
// supplies the authoritative state. Deduplication is based on bounded canonical input.
func (a *App) snappWebhook(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 16<<10)
	var in struct {
		Reference  string    `json:"reference"`
		EventID    string    `json:"eventId"`
		OccurredAt time.Time `json:"occurredAt"`
	}
	if !decode(w, r, &in) {
		return
	}
	if len(in.Reference) != 64 || len(in.EventID) < 1 || len(in.EventID) > 200 || in.OccurredAt.IsZero() {
		fail(w, 400, "رویداد معتبر نیست")
		return
	}
	tx, e := a.Pool.Begin(r.Context())
	if e != nil {
		a.dbError(w, e)
		return
	}
	defer tx.Rollback(r.Context())
	var id string
	e = tx.QueryRow(r.Context(), "SELECT id FROM shipment_attempts WHERE reference=$1", in.Reference).Scan(&id)
	if e != nil {
		write(w, 202, map[string]bool{"accepted": true})
		return
	}
	tag, e := tx.Exec(r.Context(), "INSERT INTO shipping_webhooks(event_key,reference,occurred_at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING", hash(in.Reference+":"+in.EventID), in.Reference, in.OccurredAt)
	if e == nil && tag.RowsAffected() == 1 {
		_, e = tx.Exec(r.Context(), "UPDATE shipment_attempts SET available_at=least(available_at,now()) WHERE id=$1", id)
	}
	if e == nil {
		e = tx.Commit(r.Context())
	}
	if e != nil {
		a.dbError(w, e)
		return
	}
	write(w, 202, map[string]bool{"accepted": true})
}
func (a *App) simulateShipment(w http.ResponseWriter, r *http.Request) {
	if !a.simulatedShipping() {
		fail(w, 404, "یافت نشد")
		return
	}
	var in struct {
		Status string `json:"status"`
	}
	if !decode(w, r, &in) {
		return
	}
	switch in.Status {
	case "awaiting_courier", "accepted", "picked_up", "delivered", "allocation_cancelled", "returning", "failed":
	default:
		fail(w, 400, "وضعیت معتبر نیست")
		return
	}
	_, e := a.Pool.Exec(r.Context(), "UPDATE simulated_shipments SET status=$2,updated_at=now() WHERE reference=(SELECT reference FROM shipment_attempts WHERE order_id=$1 ORDER BY created_at DESC LIMIT 1)", r.PathValue("id"), in.Status)
	if e != nil {
		a.dbError(w, e)
		return
	}
	a.refreshShipment(w, r)
}
