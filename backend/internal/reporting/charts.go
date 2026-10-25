package reporting

import (
	"net/http"
	"strings"
	"time"

	"bomish/internal/database"
	"bomish/internal/httpx"
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

func (s *Service) Charts(w http.ResponseWriter, r *http.Request) {
	section := r.URL.Query().Get("section")
	if section == "" {
		section = "overview"
	}
	from, to := Dates(r.URL.Query())
	if r.URL.Query().Get("from") == "" {
		from = to.AddDate(0, 0, -7)
	}
	for _, key := range []string{"from", "to"} {
		if value := r.URL.Query().Get(key); value != "" {
			if _, e := time.Parse("2006-01-02", value); e != nil {
				httpx.Error(w, 400, "تاریخ معتبر نیست")
				return
			}
		}
	}
	if !from.Before(to) || to.Sub(from) > 366*24*time.Hour {
		httpx.Error(w, 400, "بازه باید بین ۱ تا ۳۶۶ روز باشد")
		return
	}
	ids := r.URL.Query()["id"]
	if s := r.URL.Query().Get("ids"); len(ids) == 0 && s != "" {
		ids = strings.Split(s, ",")
	}
	if len(ids) > 12 {
		httpx.Error(w, 400, "حداکثر ۱۲ مورد را هم‌زمان مقایسه کنید")
		return
	}
	q := strings.TrimSpace(r.URL.Query().Get("q"))
	if len(q) > 500 {
		httpx.Error(w, 400, "جستجو بیش از حد طولانی است")
		return
	}
	days := []string{}
	for d := from; d.Before(to); d = d.AddDate(0, 0, 1) {
		days = append(days, d.Format("2006-01-02"))
	}
	if section == "prices" {
		s.priceCharts(w, r, from, to, days, ids, q)
		return
	}
	facts, ok := chartFacts[section]
	if !ok {
		httpx.Error(w, 400, "گزارش معتبر نیست")
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
	metric := r.URL.Query().Get("metric")
	if metric == "" {
		metric = "revenue"
		if section == "searches" {
			metric = "orders"
		}
	}
	switch metric {
	case "revenue", "quantity", "orders", "clicks", "views":
	default:
		httpx.Error(w, 400, "شاخص معتبر نیست")
		return
	}
	// Aggregate in PostgreSQL; never transfer every entity's daily history to Go.
	totalSQL := `WITH facts AS (` + facts + `) SELECT id,max(name) name,sum(revenue)::float8 revenue,sum(quantity)::float8 quantity,sum(orders)::float8 orders,sum(clicks)::float8 clicks,sum(views)::float8 views FROM facts WHERE ($3='' OR name ILIKE '%'||$3||'%' OR id ILIKE '%'||$3||'%') GROUP BY id`
	summary, e := database.QueryMaps(r.Context(), s.Pool, `SELECT count(*)::float8 AS "entityCount",count(*) FILTER(WHERE revenue>0 OR quantity>0 OR orders>0)::float8 AS "activeCount",coalesce(sum(revenue),0)::float8 revenue,coalesce(sum(quantity),0)::float8 quantity,coalesce(sum(orders),0)::float8 orders,coalesce(sum(clicks),0)::float8 clicks,coalesce(sum(views),0)::float8 views FROM (`+totalSQL+`) t`, from, to, q)
	if e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	// Rankings and denominators always cover the whole period, regardless of selected series.
	totals, e := database.QueryMaps(r.Context(), s.Pool, `SELECT * FROM (`+totalSQL+`) t ORDER BY `+metric+` DESC,id LIMIT 8`, from, to, q)
	if e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	selected := append([]string{}, ids...)
	if len(selected) == 0 {
		for i, t := range totals {
			if i == 5 {
				break
			}
			selected = append(selected, t["id"].(string))
		}
	}
	lines, e := database.QueryMaps(r.Context(), s.Pool, `SELECT * FROM (`+base+`) d WHERE id=ANY($4::text[]) ORDER BY id,"day"`, from, to, q, selected)
	if e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	packages := []map[string]any{}
	if section == "products" || section == "packages" {
		packages, e = database.QueryMaps(r.Context(), s.Pool, `WITH current_packages AS (
 SELECT p.id product_id,x->>'id' package_id,p.name,(x->>'amount')||' '||CASE x->>'unit' WHEN 'g' THEN 'گرم' WHEN 'kg' THEN 'کیلوگرم' WHEN 'ml' THEN 'میلی‌لیتر' ELSE 'لیتر' END label
 FROM products p CROSS JOIN LATERAL jsonb_array_elements(coalesce(nullif(p.content->'packages','null'::jsonb),'[]')) x
), sold AS (
 SELECT product_id,package_id,max(name) name,max(nullif(package_label,'')) label,sum(quantity)::bigint quantity,sum(net_rials)::bigint revenue
 FROM analytics_order_lines WHERE paid_at >= $1 AND paid_at < $2 GROUP BY product_id,package_id
), packages AS (
 SELECT coalesce(c.product_id,s.product_id) AS "productId",coalesce(c.package_id,s.package_id) AS "packageId",coalesce(c.name,s.name) name,coalesce(c.label,s.label,'بسته قدیمی') package,coalesce(s.quantity,0)::bigint quantity,coalesce(s.revenue,0)::bigint revenue
 FROM current_packages c FULL JOIN sold s ON s.product_id=c.product_id AND s.package_id=c.package_id
) SELECT * FROM packages WHERE ($3='' OR name ILIKE '%'||$3||'%') AND ($4::text[]='{}' OR "productId"=ANY($4::text[]) OR "productId"||':'||"packageId"=ANY($4::text[])) ORDER BY name,package LIMIT 100`, from, to, q, selected)
		if e != nil {
			httpx.DatabaseError(w, e)
			return
		}
	}
	httpx.JSON(w, 200, map[string]any{"days": days, "points": lines, "totals": totals, "summary": summary[0], "packages": packages})
}

func (s *Service) priceCharts(w http.ResponseWriter, r *http.Request, from, to time.Time, days, ids []string, q string) {
	// Rank and compare packages: prices of different package sizes must not be summed.
	packs := `SELECT h.product_id||':'||h.package_id id,h.product_id,h.package_id,max(p.name||' · '||h.package_label) name,count(*) FILTER(WHERE h.created_at>=$1 AND NOT h.baseline AND (h.old_rials IS DISTINCT FROM h.new_rials OR h.old_discount IS DISTINCT FROM h.new_discount))::float8 changes FROM price_history h JOIN products p ON p.id=h.product_id WHERE h.created_at<$2 AND ($3='' OR p.name ILIKE '%'||$3||'%') GROUP BY h.product_id,h.package_id`
	summary, e := database.QueryMaps(r.Context(), s.Pool, `SELECT count(*)::float8 AS "entityCount",count(*) FILTER(WHERE changes>0)::float8 AS "activeCount",coalesce(sum(changes),0)::float8 changes FROM (`+packs+`) t`, from, to, q)
	if e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	totals, e := database.QueryMaps(r.Context(), s.Pool, `SELECT * FROM (`+packs+`) t ORDER BY changes DESC,id LIMIT 8`, from, to, q)
	if e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	if len(ids) == 0 {
		for i, t := range totals {
			if i == 5 {
				break
			}
			ids = append(ids, t["id"].(string))
		}
	}
	// Limit before generating dates. Support legacy product IDs, with a hard series cap.
	base := `WITH packs AS (SELECT * FROM (` + packs + `) t WHERE id=ANY($4::text[]) OR product_id=ANY($4::text[]) ORDER BY changes DESC,id LIMIT 12) SELECT p.id,p.product_id AS "productId",p.name,to_char(d,'YYYY-MM-DD') AS "day",h.price::float8 price FROM packs p CROSS JOIN generate_series(($1::timestamptz AT TIME ZONE 'Asia/Tehran')::date,($2::timestamptz AT TIME ZONE 'Asia/Tehran')::date-1,interval '1 day') d LEFT JOIN LATERAL (SELECT CASE WHEN new_discount>0 THEN least(new_rials,ceil(new_rials::numeric*(100-new_discount)/1000000)*10000) ELSE new_rials END price FROM price_history WHERE product_id=p.product_id AND package_id=p.package_id AND created_at < ((d+interval '1 day') AT TIME ZONE 'Asia/Tehran') ORDER BY created_at DESC,id DESC LIMIT 1) h ON true ORDER BY p.id,d`
	rows, e := database.QueryMaps(r.Context(), s.Pool, base, from, to, q, ids)
	if e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	httpx.JSON(w, 200, map[string]any{"days": days, "points": rows, "totals": totals, "summary": summary[0], "packages": []any{}})
}
