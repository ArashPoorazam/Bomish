// Package orderquery reads bounded order pages and their customer-safe delivery projections.
package orderquery

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"bomish/internal/database"
	"bomish/internal/domain"
)

type Filter struct {
	CustomerID, ID, Status, Search, Provider, Attention string
	Limit, Offset                                       int
	TrackingTemplate                                    string
}

func Load(ctx context.Context, q database.Querier, filter Filter) ([]domain.Order, error) {
	user, id, status, search := filter.CustomerID, filter.ID, filter.Status, filter.Search
	provider, attention := filter.Provider, filter.Attention
	limit, offset := filter.Limit, max(filter.Offset, 0)
	if limit <= 0 {
		limit = 100
	}
	limit = min(limit, 100)
	orderBy := "created_at DESC,id"
	if user == "" && id == "" {
		// Prioritize staff work before pagination, without changing customer history.
		orderBy = `CASE
 WHEN status IN ('paid','packing','review') OR (status='shipped' AND EXISTS (
 SELECT 1 FROM order_shipping ds WHERE ds.order_id=orders.id AND ds.delivery_status IN ('failed','returning','unknown')
 )) THEN 0
 WHEN status='pending' THEN 1
 WHEN status='shipped' THEN 2
 ELSE 3 END,created_at DESC,id`
	}
	rows, e := q.Query(ctx, `SELECT id,status,address,subtotal_rials,shipping_rials,total_rials,tracking,created_at,coalesce(discount_code,''),discount_rials FROM orders WHERE ($1='' OR user_id=$1) AND ($2='' OR id=$2) AND ($3='' OR status=$3 OR ($3='active' AND status IN ('paid','packing','shipped','review'))) AND ($4='' OR id||' '||address::text||' '||tracking ILIKE '%'||$4||'%') `+deliveryFilterSQL(7, 8)+` ORDER BY `+orderBy+` LIMIT $5 OFFSET $6`, user, id, status, search, limit, offset, provider, attention)
	if e != nil {
		return nil, e
	}
	out := make([]domain.Order, 0, limit)
	indexes := make(map[string]int, limit)
	ids := make([]string, 0, limit)
	for rows.Next() {
		var v domain.Order
		var raw []byte
		var date time.Time
		if e = rows.Scan(&v.ID, &v.Status, &raw, &v.SubtotalRials, &v.ShippingRials, &v.TotalRials, &v.Tracking, &date, &v.DiscountCode, &v.DiscountRials); e != nil {
			rows.Close()
			return nil, e
		}
		if e = json.Unmarshal(raw, &v.Address); e != nil {
			rows.Close()
			return nil, e
		}
		v.CreatedAt = date.Format(time.RFC3339)
		v.Items = []domain.OrderItem{}
		v.Events = []domain.OrderEvent{}
		indexes[v.ID] = len(out)
		ids = append(ids, v.ID)
		out = append(out, v)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return nil, e
	}
	if len(ids) == 0 {
		return out, nil
	}
	items, e := q.Query(ctx, `SELECT order_id,product_id,name,grams,price_rials,total_rials,package_id,package_label,quantity,packed FROM order_items WHERE order_id=ANY($1::text[]) ORDER BY product_id,package_id`, ids)
	if e != nil {
		return nil, e
	}
	for items.Next() {
		var order string
		var it domain.OrderItem
		if e = items.Scan(&order, &it.ProductID, &it.Name, &it.Grams, &it.PriceRials, &it.TotalRials, &it.PackageID, &it.PackageLabel, &it.Quantity, &it.Packed); e != nil {
			items.Close()
			return nil, e
		}
		i := indexes[order]
		out[i].Items = append(out[i].Items, it)
	}
	e = items.Err()
	items.Close()
	if e != nil {
		return nil, e
	}
	events, e := q.Query(ctx, "SELECT order_id,status,created_at FROM order_events WHERE order_id=ANY($1::text[]) ORDER BY created_at", ids)
	if e != nil {
		return nil, e
	}
	defer events.Close()
	for events.Next() {
		var id string
		var v domain.OrderEvent
		var t time.Time
		if e = events.Scan(&id, &v.Status, &t); e != nil {
			return nil, e
		}
		v.CreatedAt = t.Format(time.RFC3339)
		i := indexes[id]
		out[i].Events = append(out[i].Events, v)
	}
	if e = events.Err(); e != nil {
		return nil, e
	}
	events.Close()
	if e = attachDeliveries(ctx, q, out, ids, indexes, filter.TrackingTemplate); e != nil {
		return nil, e
	}
	return out, nil
}

func deliveryFilterSQL(provider, attention int) string {
	return fmt.Sprintf(` AND ($%d='' OR coalesce((SELECT CASE WHEN courier_staff_id IS NOT NULL THEN 'own_courier' ELSE method END FROM order_shipping ds WHERE ds.order_id=orders.id),'legacy_postal')=$%d) AND ($%d='' OR EXISTS(SELECT 1 FROM order_shipping ds WHERE ds.order_id=orders.id AND (($%d='ready' AND ds.ready AND ds.delivery_status IN ('not_requested','cancelled','failed')) OR ($%d='waiting' AND ds.delivery_status IN ('submitting','awaiting_courier','accepted')) OR ($%d='unknown' AND ds.delivery_status='unknown') OR ($%d='failed' AND ds.delivery_status IN ('failed','returning')) OR ($%d='missing' AND NOT ds.ready AND orders.status IN ('paid','packing')))))`, provider, provider, attention, attention, attention, attention, attention, attention)
}

// Count uses the same delivery filters as the staff page.
func Count(ctx context.Context, q database.Querier, f Filter) (int64, error) {
	var total int64
	err := q.QueryRow(ctx, `SELECT count(*) FROM orders WHERE ($1='' OR status=$1 OR ($1='active' AND status IN ('paid','packing','shipped','review'))) AND ($2='' OR id||' '||address::text||' '||tracking ILIKE '%'||$2||'%')`+deliveryFilterSQL(3, 4)+` AND ($5='' OR user_id=$5) AND ($6='' OR id=$6)`, f.Status, f.Search, f.Provider, f.Attention, f.CustomerID, f.ID).Scan(&total)
	return total, err
}
