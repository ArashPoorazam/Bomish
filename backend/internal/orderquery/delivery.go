package orderquery

import (
	"context"
	"encoding/json"
	"time"

	"bomish/internal/database"
	"bomish/internal/domain"
)

// attachDeliveries uses two queries for an entire page, including the latest
// courier contact. It reads only the customer projection, not packing geometry,
// provider diagnostics, costs, pickup addresses, or dispatch reviews.
func attachDeliveries(ctx context.Context, q database.Querier, orders []domain.Order, ids []string, indexes map[string]int, trackingTemplate string) error {
	rows, err := q.Query(ctx, `SELECT s.order_id,s.method,s.delivery_status,
 coalesce(s.snapshot->>'service',''),coalesce((s.snapshot->'carrierQuote'->>'simulated')::boolean,false),
 s.parcels,s.courier_staff_id IS NOT NULL,s.courier_name,s.courier_phone,
 coalesce(a.response->>'driverName',''),coalesce(a.response->>'driverPhone','')
 FROM order_shipping s JOIN orders o ON o.id=s.order_id
 LEFT JOIN LATERAL (SELECT response FROM shipment_attempts WHERE order_id=s.order_id
 ORDER BY created_at DESC,id DESC LIMIT 1) a
 ON s.method='snapp' AND s.courier_staff_id IS NULL AND o.status IN ('shipped','received')
 WHERE s.order_id=ANY($1::text[])`, ids)
	if err != nil {
		return err
	}
	for rows.Next() {
		var id, name, phone, driverName, driverPhone string
		var raw []byte
		var assigned bool
		v := &domain.Delivery{Parcels: []domain.CustomerParcel{}, Events: []domain.DeliveryEvent{}}
		if err = rows.Scan(&id, &v.Method, &v.Status, &v.Service, &v.Simulated, &raw, &assigned, &name, &phone, &driverName, &driverPhone); err != nil {
			rows.Close()
			return err
		}
		order := &orders[indexes[id]]
		if v.Method == "post" {
			// Unmarshal the allowlisted fields only. Never copy a stored tracking URL.
			var parcels []struct {
				ID       string `json:"id"`
				Tracking string `json:"tracking"`
			}
			if err = json.Unmarshal(raw, &parcels); err != nil {
				rows.Close()
				return err
			}
			for _, p := range parcels {
				link := ""
				if domain.ValidPostalTracking(p.Tracking) {
					link = domain.PostalTrackingURL(p.Tracking, trackingTemplate)
				}
				v.Parcels = append(v.Parcels, domain.CustomerParcel{ID: p.ID, Tracking: p.Tracking, TrackingURL: link})
			}
		}
		if v.Method == "snapp" && (order.Status == "shipped" || order.Status == "received") {
			if assigned {
				v.Courier = &domain.CourierContact{Name: name, Phone: phone}
			} else if driverName != "" || driverPhone != "" {
				v.Courier = &domain.CourierContact{Name: driverName, Phone: domain.Phone(driverPhone)}
			}
		}
		if assigned {
			v.Method, v.Service = "own_courier", "own_courier"
		}
		order.Shipping = v
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	events, err := q.Query(ctx, `SELECT order_id,status,occurred_at FROM delivery_events WHERE order_id=ANY($1::text[]) ORDER BY occurred_at,id`, ids)
	if err != nil {
		return err
	}
	defer events.Close()
	for events.Next() {
		var id string
		var event domain.DeliveryEvent
		var at time.Time
		if err := events.Scan(&id, &event.Status, &at); err != nil {
			return err
		}
		event.CreatedAt = at.Format(time.RFC3339)
		if v := orders[indexes[id]].Shipping; v != nil {
			v.Events = append(v.Events, event)
		}
	}
	return events.Err()
}
