package app

import (
	"bomish/internal/carrier"
	"context"
	"time"
)

// Simulation uses dedicated durable rows, never a provider endpoint. Scenario controls
// are server-side test settings; customers cannot choose outcomes or prices.
type simulation struct {
	a      *App
	method string
}

func (s simulation) Quote(ctx context.Context, r carrier.Request) (carrier.Quote, error) {
	cost := int64(550000)
	parts := map[string]int64{}
	if s.method == "post" {
		cost = 0
		for _, p := range r.Parcels {
			n := int64(300003) + p.Weight()*20
			cost += n
			parts[p.ID] = n
		}
	}
	return carrier.Quote{CostRials: cost, ExpiresAt: time.Now().Add(5 * time.Minute), Components: parts, Simulated: true}, nil
}
func (s simulation) Create(ctx context.Context, r carrier.Request) (carrier.Booking, error) {
	q, e := s.Quote(ctx, r)
	if e != nil {
		return carrier.Booking{}, e
	}
	_, e = s.a.Pool.Exec(ctx, "INSERT INTO simulated_shipments(reference,provider_id,status,cost_rials) VALUES($1,$2,'awaiting_courier',$3) ON CONFLICT DO NOTHING", r.Reference, "sim-"+r.Reference, q.CostRials)
	if e != nil {
		return carrier.Booking{}, e
	}
	return s.Lookup(ctx, r.Reference)
}
func (s simulation) Lookup(ctx context.Context, ref string) (carrier.Booking, error) {
	var b carrier.Booking
	b.Reference = ref
	e := s.a.Pool.QueryRow(ctx, "SELECT provider_id,status,cost_rials,updated_at FROM simulated_shipments WHERE reference=$1", ref).Scan(&b.ID, &b.Status, &b.CostRials, &b.OccurredAt)
	if e != nil {
		return b, carrier.ErrUnknown
	}
	if b.Status == "accepted" || b.Status == "picked_up" || b.Status == "delivered" {
		b.DriverName, b.DriverPhone = "پیک آزمایشی", "09121110002"
	}
	return b, nil
}
func (s simulation) Cancel(ctx context.Context, ref string) (carrier.Booking, error) {
	_, e := s.a.Pool.Exec(ctx, "UPDATE simulated_shipments SET status='cancelled',updated_at=now() WHERE reference=$1 AND status IN ('awaiting_courier','accepted')", ref)
	if e != nil {
		return carrier.Booking{}, e
	}
	return s.Lookup(ctx, ref)
}
