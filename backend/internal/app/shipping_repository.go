package app

import (
	"context"
	"encoding/json"
	"time"

	"bomish/internal/carrier"
	"bomish/internal/database"
	"bomish/internal/domain"
	"bomish/internal/packing"

	"github.com/jackc/pgx/v5"
)

type dispatchReview struct {
	ID        string           `json:"id"`
	Version   int64            `json:"version"`
	Method    string           `json:"method"`
	ExpiresAt time.Time        `json:"expiresAt"`
	Parcels   []packing.Parcel `json:"parcels,omitempty"`
	Quote     carrier.Quote    `json:"quote"`
}

type deliveryRecord struct {
	AssignedCourier *staffCourier          `json:"assignedCourier,omitempty"`
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

func loadDelivery(ctx context.Context, q database.Querier, id string, lock bool) (deliveryRecord, error) {
	d := deliveryRecord{OrderID: id, AllowedActions: []string{}, Events: []domain.DeliveryEvent{}}
	var raw, parcels, review []byte
	var courierID *string
	var courier staffCourier
	suffix := ""
	if lock {
		suffix = " FOR UPDATE"
	}
	e := q.QueryRow(ctx, "SELECT version,method,delivery_status,ready,snapshot,parcels,actual_cost_rials,dispatch_quote,updated_at,courier_staff_id,courier_name,courier_phone FROM order_shipping WHERE order_id=$1"+suffix, id).Scan(&d.Version, &d.Method, &d.Status, &d.Ready, &raw, &parcels, &d.ActualCostRials, &review, &d.UpdatedAt, &courierID, &courier.FullName, &courier.Phone)
	if e != nil {
		return d, e
	}
	if courierID != nil {
		courier.ID = *courierID
		d.AssignedCourier = &courier
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

func deliveryEvents(ctx context.Context, q database.Querier, id string) ([]domain.DeliveryEvent, error) {
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

func saveDelivery(ctx context.Context, tx pgx.Tx, d deliveryRecord) error {
	parcels, _ := json.Marshal(d.Parcels)
	snapshot, _ := json.Marshal(d.Snapshot)
	var review []byte
	if d.Review != nil {
		review, _ = json.Marshal(d.Review)
	}
	var courierID *string
	courierName, courierPhone := "", ""
	if d.AssignedCourier != nil {
		courierID = &d.AssignedCourier.ID
		courierName, courierPhone = d.AssignedCourier.FullName, d.AssignedCourier.Phone
	}
	_, e := tx.Exec(ctx, "UPDATE order_shipping SET version=version+1,method=$2,delivery_status=$3,ready=$4,snapshot=$5,parcels=$6,actual_cost_rials=$7,dispatch_quote=$8,courier_staff_id=$9,courier_name=$10,courier_phone=$11,updated_at=now() WHERE order_id=$1", d.OrderID, d.Method, d.Status, d.Ready, snapshot, parcels, d.ActualCostRials, review, courierID, courierName, courierPhone)
	return e
}

// The same predicate is applied to list rows and counts before pagination.
