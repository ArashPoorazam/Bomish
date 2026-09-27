package app

import (
	"bomish/internal/domain"
	"net/http"
	"time"
)

func (a *App) recordEvent(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Kind      string `json:"kind"`
		ProductID string `json:"productId"`
		Query     string `json:"query"`
	}
	if !decode(w, r, &in) {
		return
	}
	in.Query = domain.Normalize(in.Query)
	if (in.Kind != "view" && in.Kind != "search") || (in.Kind == "search" && (len([]rune(in.Query)) < 2 || len([]rune(in.Query)) > 120)) {
		fail(w, 400, "رویداد معتبر نیست")
		return
	}
	if current(r).StaffID != "" {
		write(w, 200, map[string]bool{"ok": true})
		return
	}
	if !a.limit(r, "analytics-ip:"+ip(r), 300, time.Hour) || !a.limit(r, "analytics:"+current(r).Hash+":"+in.Kind+":"+in.ProductID+in.Query, 1, 30*time.Minute) {
		write(w, 200, map[string]bool{"ok": true})
		return
	}
	var product any
	if in.Kind == "view" {
		var exists bool
		if a.Pool.QueryRow(r.Context(), "SELECT EXISTS(SELECT 1 FROM products WHERE id=$1 AND status='published')", in.ProductID).Scan(&exists) != nil || !exists {
			fail(w, 404, "محصول پیدا نشد")
			return
		}
		product = in.ProductID
		in.Query = ""
	}
	_, e := a.Pool.Exec(r.Context(), "INSERT INTO analytics_events(kind,product_id,query,session_hash) VALUES($1,$2,$3,$4)", in.Kind, product, in.Query, current(r).Hash)
	if e != nil {
		a.dbError(w, e)
		return
	}
	write(w, 200, map[string]bool{"ok": true})
}
func (a *App) analytics(w http.ResponseWriter, r *http.Request) {
	days := 30
	switch r.URL.Query().Get("days") {
	case "7":
		days = 7
	case "90":
		days = 90
	case "365":
		days = 365
	}
	since := time.Now().AddDate(0, 0, -days)
	queries := map[string]string{
		"summary":       `SELECT count(*) FILTER(WHERE status IN ('paid','packing','shipped','received')) orders,coalesce(sum(subtotal_rials) FILTER(WHERE status IN ('paid','packing','shipped','received')),0) revenue,coalesce(avg(subtotal_rials) FILTER(WHERE status IN ('paid','packing','shipped','received')),0)::bigint average,count(*) FILTER(WHERE status IN ('cancelled','expired')) abandoned FROM orders WHERE created_at>=$1`,
		"sales":         `SELECT d::date::text AS day,coalesce(sum(o.subtotal_rials),0) revenue,count(o.id) orders FROM generate_series($1::date,current_date,'1 day') d LEFT JOIN orders o ON o.created_at::date=d::date AND o.status IN ('paid','packing','shipped','received') GROUP BY d ORDER BY d`,
		"products":      `SELECT p.id,p.name,coalesce(v.views,0) views,coalesce(s.quantity,0) quantity,coalesce(s.revenue,0) revenue FROM products p LEFT JOIN (SELECT product_id,count(*) views FROM analytics_events WHERE kind='view' AND created_at>=$1 GROUP BY product_id) v ON v.product_id=p.id LEFT JOIN (SELECT oi.product_id,sum(oi.quantity) quantity,sum(oi.total_rials) revenue FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE o.created_at>=$1 AND o.status IN ('paid','packing','shipped','received') GROUP BY oi.product_id) s ON s.product_id=p.id ORDER BY quantity DESC,views DESC LIMIT 50`,
		"searches":      `SELECT query,count(*) searches FROM analytics_events WHERE kind='search' AND created_at>=$1 GROUP BY query ORDER BY searches DESC LIMIT 30`,
		"categories":    `SELECT c.name,sum(i.total_rials) revenue FROM order_items i JOIN orders o ON o.id=i.order_id JOIN products p ON p.id=i.product_id JOIN categories c ON c.id=p.category_id WHERE o.created_at>=$1 AND o.status IN ('paid','packing','shipped','received') GROUP BY c.id ORDER BY revenue DESC`,
		"customers":     `SELECT u.phone,coalesce(max(o.address->>'recipient'),'') name,count(*) orders,sum(o.subtotal_rials) revenue FROM orders o JOIN users u ON u.id=o.user_id WHERE o.created_at>=$1 AND o.status IN ('paid','packing','shipped','received') GROUP BY u.id ORDER BY revenue DESC LIMIT 20`,
		"fulfillment":   `SELECT status,count(*) orders FROM orders WHERE created_at>=$1 GROUP BY status ORDER BY orders DESC`,
		"notifications": `SELECT status,count(*) messages FROM jobs WHERE kind='order_sms' AND available_at>=$1 GROUP BY status`,
	}
	out := map[string]any{"days": days}
	for key, sql := range queries {
		rows, e := a.Pool.Query(r.Context(), sql, since)
		if e != nil {
			a.dbError(w, e)
			return
		}
		data := []map[string]any{}
		fields := rows.FieldDescriptions()
		for rows.Next() {
			values, e := rows.Values()
			if e != nil {
				rows.Close()
				a.dbError(w, e)
				return
			}
			row := map[string]any{}
			for i, f := range fields {
				row[f.Name] = values[i]
			}
			data = append(data, row)
		}
		e = rows.Err()
		rows.Close()
		if e != nil {
			a.dbError(w, e)
			return
		}
		out[key] = data
	}
	write(w, 200, out)
}
func (a *App) deleteCategory(w http.ResponseWriter, r *http.Request) {
	tag, e := a.Pool.Exec(r.Context(), "DELETE FROM categories WHERE id=$1 AND NOT EXISTS(SELECT 1 FROM products WHERE category_id=$1) AND NOT EXISTS(SELECT 1 FROM product_drafts WHERE content->>'categoryId'=$1)", r.PathValue("id"))
	if e != nil {
		a.dbError(w, e)
		return
	}
	if tag.RowsAffected() == 0 {
		fail(w, 409, "ابتدا محصولات این دسته را به دسته دیگری منتقل کنید")
		return
	}
	write(w, 200, map[string]bool{"ok": true})
}
