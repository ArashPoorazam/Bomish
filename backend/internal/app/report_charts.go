package app

import (
	"net/http"
	"strings"
	"time"
)

// Each fact is assigned to its Tehran calendar day before aggregation.
const chartDay = `to_char(at AT TIME ZONE 'Asia/Tehran','YYYY-MM-DD')`

var chartFacts = map[string]string{
	"overview":   `SELECT 'all'::text id,'فروش کل'::text name,paid_at at,subtotal_rials-discount_rials revenue,0::bigint quantity,1::bigint orders,0::bigint clicks,0::bigint views FROM orders WHERE paid_at >= $1 AND paid_at < $2 AND status IN ('paid','packing','shipped','received')`,
	"products":   `SELECT p.id,p.name,l.paid_at at,l.net_rials revenue,l.quantity,0::bigint orders,0::bigint clicks,0::bigint views FROM analytics_order_lines l JOIN products p ON p.id=l.product_id WHERE l.paid_at >= $1 AND l.paid_at < $2 UNION ALL SELECT p.id,p.name,e.created_at,0,0,0,CASE WHEN e.kind='click' THEN 1 ELSE 0 END,CASE WHEN e.kind='view' THEN 1 ELSE 0 END FROM analytics_events e JOIN products p ON p.id=e.product_id WHERE e.created_at >= $1 AND e.created_at < $2 AND e.kind IN ('click','view')`,
	"packages":   `SELECT product_id||':'||package_id id,name||' · '||package_label name,paid_at at,net_rials revenue,quantity,0::bigint orders,0::bigint clicks,0::bigint views FROM analytics_order_lines WHERE paid_at >= $1 AND paid_at < $2`,
	"customers":  `SELECT u.id,coalesce(nullif(o.address->>'recipient',''),u.phone) name,o.paid_at at,o.subtotal_rials-o.discount_rials revenue,0::bigint quantity,1::bigint orders,0::bigint clicks,0::bigint views FROM orders o JOIN users u ON u.id=o.user_id WHERE o.paid_at >= $1 AND o.paid_at < $2 AND o.status IN ('paid','packing','shipped','received')`,
	"categories": `SELECT c.id,c.name,l.paid_at at,l.net_rials revenue,l.quantity,0::bigint orders,0::bigint clicks,0::bigint views FROM analytics_order_lines l JOIN products p ON p.id=l.product_id JOIN categories c ON c.id=p.category_id WHERE l.paid_at >= $1 AND l.paid_at < $2 UNION ALL SELECT c.id,c.name,e.created_at,0,0,0,CASE WHEN e.kind='click' THEN 1 ELSE 0 END,CASE WHEN e.kind='view' THEN 1 ELSE 0 END FROM analytics_events e JOIN products p ON p.id=e.product_id JOIN categories c ON c.id=p.category_id WHERE e.created_at >= $1 AND e.created_at < $2 AND e.kind IN ('click','view')`,
	"searches":   `SELECT query id,query name,created_at at,0::bigint revenue,0::bigint quantity,count(*)::bigint orders,0::bigint clicks,0::bigint views FROM analytics_events WHERE kind='search' AND created_at >= $1 AND created_at < $2 GROUP BY query,created_at`,
}

func (a *App) reportCharts(w http.ResponseWriter, r *http.Request) {
	section := r.URL.Query().Get("section")
	if section == "" {
		section = "overview"
	}
	from, to := reportDates(r)
	if r.URL.Query().Get("from") == "" {
		from = to.AddDate(0, 0, -7)
	}
	for _, key := range []string{"from", "to"} {
		if value := r.URL.Query().Get(key); value != "" {
			if _, e := time.Parse("2006-01-02", value); e != nil {
				fail(w, 400, "تاریخ معتبر نیست")
				return
			}
		}
	}
	if !from.Before(to) || to.Sub(from) > 366*24*time.Hour {
		fail(w, 400, "بازه باید بین ۱ تا ۳۶۶ روز باشد")
		return
	}
	ids := []string{}
	if s := r.URL.Query().Get("ids"); s != "" {
		ids = strings.Split(s, ",")
	}
	if len(ids) > 12 {
		fail(w, 400, "حداکثر ۱۲ مورد را هم‌زمان مقایسه کنید")
		return
	}
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if len(q) > 500 {
		fail(w, 400, "جستجو بیش از حد طولانی است")
		return
	}
	days := []string{}
	for d := from; d.Before(to); d = d.AddDate(0, 0, 1) {
		days = append(days, d.Format("2006-01-02"))
	}
	if section == "prices" {
		a.priceCharts(w, r, from, to, days, ids, q)
		return
	}
	facts, ok := chartFacts[section]
	if !ok {
		fail(w, 400, "گزارش معتبر نیست")
		return
	}
	// Include inactive-in-period entities so a zero-sales product can still be compared.
	candidates := map[string]string{
		"overview":   `SELECT 'all'::text id,'فروش کل'::text name`,
		"products":   `SELECT id,name FROM products`,
		"categories": `SELECT id,name FROM categories`,
		"customers":  `SELECT id,phone name FROM users`,
		"packages":   `SELECT p.id||':'||(pack->>'id') id,p.name||' · '||(pack->>'amount')||' '||(pack->>'unit') name FROM products p CROSS JOIN LATERAL jsonb_array_elements(coalesce(nullif(p.content->'packages','null'::jsonb),'[]')) pack`,
	}
	if candidate, exists := candidates[section]; exists {
		facts += ` UNION ALL SELECT id,name,$1::timestamptz,0,0,0,0,0 FROM (` + candidate + `) candidates`
	}
	base := `WITH facts AS (` + facts + `) SELECT id,max(name) name,` + chartDay + ` AS "day",sum(revenue)::float8 revenue,sum(quantity)::float8 quantity,sum(orders)::float8 orders,sum(clicks)::float8 clicks,sum(views)::float8 views FROM facts WHERE ($3='' OR name ILIKE '%'||$3||'%' OR id ILIKE '%'||$3||'%') GROUP BY id,"day"`
	rows, e := queryMaps(r.Context(), a.Pool, base, from, to, q)
	if e != nil {
		a.dbError(w, e)
		return
	}
	// Totals include every matching entity, independent of table pagination and comparison selection.
	totals, e := queryMaps(r.Context(), a.Pool, `SELECT id,max(name) name,sum(revenue)::float8 revenue,sum(quantity)::float8 quantity,sum(orders)::float8 orders,sum(clicks)::float8 clicks,sum(views)::float8 views FROM (`+base+`) d GROUP BY id ORDER BY revenue DESC,quantity DESC,clicks DESC,id`, from, to, q)
	if e != nil {
		a.dbError(w, e)
		return
	}
	selected := map[string]bool{}
	for _, id := range ids {
		selected[id] = true
	}
	if len(selected) == 0 {
		for i, t := range totals {
			if i >= 5 {
				break
			}
			selected[t["id"].(string)] = true
		}
	}
	lines := []map[string]any{}
	for _, row := range rows {
		if selected[row["id"].(string)] {
			lines = append(lines, row)
		}
	}
	packages := []map[string]any{}
	if section == "products" || section == "packages" {
		packages, e = queryMaps(r.Context(), a.Pool, `WITH current_packages AS (
 SELECT p.id product_id,x->>'id' package_id,p.name,(x->>'amount')||' '||CASE x->>'unit' WHEN 'g' THEN 'گرم' WHEN 'kg' THEN 'کیلوگرم' WHEN 'ml' THEN 'میلی‌لیتر' ELSE 'لیتر' END label
 FROM products p CROSS JOIN LATERAL jsonb_array_elements(coalesce(nullif(p.content->'packages','null'::jsonb),'[]')) x
), sold AS (
 SELECT product_id,package_id,max(name) name,max(nullif(package_label,'')) label,sum(quantity)::bigint quantity,sum(net_rials)::bigint revenue
 FROM analytics_order_lines WHERE paid_at >= $1 AND paid_at < $2 GROUP BY product_id,package_id
), packages AS (
 SELECT coalesce(c.product_id,s.product_id) AS "productId",coalesce(c.package_id,s.package_id) AS "packageId",coalesce(c.name,s.name) name,coalesce(c.label,s.label,'بسته قدیمی') package,coalesce(s.quantity,0)::bigint quantity,coalesce(s.revenue,0)::bigint revenue
 FROM current_packages c FULL JOIN sold s ON s.product_id=c.product_id AND s.package_id=c.package_id
) SELECT * FROM packages WHERE ($3='' OR name ILIKE '%'||$3||'%') AND ($4::text[]='{}' OR "productId"=ANY($4::text[]) OR "productId"||':'||"packageId"=ANY($4::text[])) ORDER BY name,package`, from, to, q, ids)
		if e != nil {
			a.dbError(w, e)
			return
		}
	}
	write(w, 200, map[string]any{"days": days, "points": lines, "totals": totals, "packages": packages})
}

func (a *App) priceCharts(w http.ResponseWriter, r *http.Request, from, to time.Time, days, ids []string, q string) {
	// Carry forward the last recorded effective package price. Unknown history stays null.
	base := `WITH packs AS (SELECT h.product_id,h.package_id,max(p.name||' · '||h.package_label) name FROM price_history h JOIN products p ON p.id=h.product_id WHERE h.created_at<$2 AND ($3='' OR p.name ILIKE '%'||$3||'%') GROUP BY h.product_id,h.package_id) SELECT p.product_id||':'||p.package_id id,p.product_id AS "productId",p.name,to_char(d,'YYYY-MM-DD') AS "day",h.price::float8 price FROM packs p CROSS JOIN generate_series(($1::timestamptz AT TIME ZONE 'Asia/Tehran')::date,($2::timestamptz AT TIME ZONE 'Asia/Tehran')::date-1,interval '1 day') d LEFT JOIN LATERAL (SELECT floor((new_rials*(100-new_discount)+500)/1000)*10 price FROM price_history WHERE product_id=p.product_id AND package_id=p.package_id AND created_at < ((d+interval '1 day') AT TIME ZONE 'Asia/Tehran') ORDER BY created_at DESC,id DESC LIMIT 1) h ON true WHERE ($4::text[]='{}' OR p.product_id=ANY($4::text[])) ORDER BY p.name,p.product_id,p.package_id,d`
	totals, e := queryMaps(r.Context(), a.Pool, `SELECT p.id,p.name,count(*) FILTER(WHERE h.created_at>=$1 AND NOT h.baseline AND (h.old_rials IS DISTINCT FROM h.new_rials OR h.old_discount IS DISTINCT FROM h.new_discount))::float8 changes FROM products p JOIN price_history h ON h.product_id=p.id WHERE h.created_at<$2 AND ($3='' OR p.name ILIKE '%'||$3||'%') GROUP BY p.id ORDER BY p.name,p.id`, from, to, q)
	if e != nil {
		a.dbError(w, e)
		return
	}
	if len(ids) == 0 {
		for i, t := range totals {
			if i == 3 {
				break
			}
			ids = append(ids, t["id"].(string))
		}
	}
	rows, e := queryMaps(r.Context(), a.Pool, base, from, to, q, ids)
	if e != nil {
		a.dbError(w, e)
		return
	}
	write(w, 200, map[string]any{"days": days, "points": rows, "totals": totals, "packages": []any{}})
}
