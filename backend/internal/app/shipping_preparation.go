package app

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"bomish/internal/carrier"
	"bomish/internal/httpx"
	"bomish/internal/packing"

	"github.com/jackc/pgx/v5"
)

func orderUnits(d deliveryRecord) []packing.Item {
	return snapshotItems(d.Snapshot)
}

func snapshotItems(s shippingSnapshot) []packing.Item {
	if len(s.Items) > 0 {
		return s.Items
	}
	// Orders created before package snapshots retain their original carton allocation.
	out := []packing.Item{}
	for _, p := range s.Parcels {
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
	if !httpx.Decode(w, r, &in) {
		return
	}
	a.deliveryMutation(w, r, in.Version, func(tx pgx.Tx, d *deliveryRecord, status string) error {
		if e := editableDelivery(*d, status); e != nil {
			return e
		}
		if d.Method != "post" {
			return errors.New("ارسال با پیک به محاسبه کارتن نیاز ندارد")
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
	if e = d.Snapshot.Destination.Validate(); e != nil {
		return e
	}
	if d.Method == "snapp" {
		ok, reason := snappEligible(d.Snapshot.Config, d.Snapshot.Destination, orderUnits(d))
		if !ok {
			return errors.New(reason)
		}
		return nil
	}
	for _, p := range d.Parcels {
		if !p.Confirmed {
			return errors.New("بسته‌بندی واقعی همه کارتن‌ها را تأیید کنید")
		}
	}
	if e = packing.ValidateCorrections(d.Parcels, orderUnits(d)); e != nil {
		return e
	}
	if e = postalEligible(d.Snapshot.Config, d.Snapshot.Destination, d.Parcels); e != nil {
		return e
	}
	return nil
}

func (a *App) readyOrder(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Version int64 `json:"version"`
	}
	if !httpx.Decode(w, r, &in) {
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
