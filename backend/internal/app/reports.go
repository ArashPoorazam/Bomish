package app

import (
	"net/http"
	"slices"
	"strconv"
	"strings"
)

type reportColumn struct {
	Key   string `json:"key"`
	Label string `json:"label"`
	Kind  string `json:"kind"`
}
type reportSpec struct {
	SQL         string
	Columns     []reportColumn
	DefaultSort string
}

func col(k, l string) reportColumn      { return reportColumn{k, l, "text"} }
func num(k, l string) reportColumn      { return reportColumn{k, l, "number"} }
func moneyCol(k, l string) reportColumn { return reportColumn{k, l + " (تومان)", "money"} }
func dateCol(k, l string) reportColumn  { return reportColumn{k, l, "date"} }

var reportSpecs = map[string]reportSpec{
	"overview":        {`SELECT to_char(paid_at AT TIME ZONE 'Asia/Tehran','YYYY-MM-DD') AS id,to_char(paid_at AT TIME ZONE 'Asia/Tehran','YYYY-MM-DD') AS name,count(*) AS orders,sum(subtotal_rials-discount_rials)::bigint AS revenue,avg(subtotal_rials-discount_rials)::bigint AS average FROM orders WHERE paid_at>=$1 AND paid_at<$2 AND status IN ('paid','packing','shipped','received') GROUP BY 1`, []reportColumn{col("name", "روز"), num("orders", "سفارش پرداخت‌شده"), moneyCol("revenue", "فروش خالص کالا"), moneyCol("average", "میانگین سفارش")}, "id DESC"},
	"products":        {`SELECT p.id,p.name,coalesce(s.quantity,0)::bigint AS quantity,coalesce(s.revenue,0)::bigint AS revenue,coalesce(v.views,0)::bigint AS views,coalesce(v.clicks,0)::bigint AS clicks FROM products p LEFT JOIN (SELECT product_id,sum(quantity) quantity,sum(net_rials) revenue FROM analytics_order_lines WHERE paid_at>=$1 AND paid_at<$2 GROUP BY product_id) s ON s.product_id=p.id LEFT JOIN (SELECT product_id,count(*) FILTER(WHERE kind='view') views,count(*) FILTER(WHERE kind='click') clicks FROM analytics_events WHERE created_at>=$1 AND created_at<$2 GROUP BY product_id) v ON v.product_id=p.id`, []reportColumn{col("name", "محصول"), num("quantity", "بسته فروخته‌شده"), moneyCol("revenue", "فروش خالص"), num("views", "بازدید یکتا در ۳۰ دقیقه"), num("clicks", "کلیک یکتا در ۳۰ دقیقه")}, "revenue DESC,id"},
	"packages":        {`SELECT product_id||':'||package_id AS id,max(name)||' · '||max(package_label) AS name,sum(quantity)::bigint AS quantity,sum(net_rials)::bigint AS revenue FROM analytics_order_lines WHERE paid_at>=$1 AND paid_at<$2 GROUP BY product_id,package_id`, []reportColumn{col("name", "محصول / بسته"), num("quantity", "تعداد"), moneyCol("revenue", "فروش خالص")}, "revenue DESC,id"},
	"customers":       {`SELECT u.id,coalesce(nullif(c.name,''),u.phone) AS name,u.phone,u.created_at AS "createdAt",coalesce(c.orders,0)::bigint AS orders,coalesce(c.revenue,0)::bigint AS revenue FROM users u LEFT JOIN (SELECT user_id,max(address->>'recipient') name,count(*) orders,sum(subtotal_rials-discount_rials) revenue FROM orders WHERE paid_at>=$1 AND paid_at<$2 AND status IN ('paid','packing','shipped','received') GROUP BY user_id) c ON c.user_id=u.id`, []reportColumn{col("name", "مشتری"), col("phone", "همراه"), dateCol("createdAt", "عضویت"), num("orders", "سفارش"), moneyCol("revenue", "خرید")}, "revenue DESC,id"},
	"customer-orders": {`SELECT o.id,o.user_id AS "customerId",coalesce(o.address->>'recipient','') AS name,o.paid_at AS "createdAt",o.status,o.subtotal_rials-o.discount_rials AS revenue,(SELECT string_agg(i.name||' × '||i.quantity::text,'، ') FROM order_items i WHERE i.order_id=o.id) AS items FROM orders o WHERE o.paid_at>=$1 AND o.paid_at<$2 AND o.status IN ('paid','packing','shipped','received')`, []reportColumn{col("id", "سفارش"), col("name", "مشتری"), dateCol("createdAt", "پرداخت"), col("items", "محصولات"), moneyCol("revenue", "خرید")}, `"createdAt" DESC,id`},
	"prices":          {`SELECT h.id::text AS id,p.name||' · '||h.package_label AS name,h.product_id AS "productId",h.old_rials AS "oldRials",h.new_rials AS "newRials",h.new_rials-h.old_rials AS change,CASE WHEN h.old_rials>0 THEN round((h.new_rials-h.old_rials)*100.0/h.old_rials,2)::float8 END AS percent,h.old_discount AS "oldDiscount",h.new_discount AS "newDiscount",h.created_at AS "createdAt",h.baseline,coalesce(nullif(s.full_name,''),s.username,'سیستم') AS actor FROM price_history h JOIN products p ON p.id=h.product_id LEFT JOIN staff s ON s.id=h.actor_id WHERE h.created_at>=$1 AND h.created_at<$2`, []reportColumn{col("name", "محصول / بسته"), moneyCol("oldRials", "قیمت قبل"), moneyCol("newRials", "قیمت جدید"), moneyCol("change", "تغییر"), num("percent", "درصد تغییر"), num("oldDiscount", "تخفیف قبل ٪"), num("newDiscount", "تخفیف جدید ٪"), col("actor", "همکار"), dateCol("createdAt", "زمان"), col("baseline", "ثبت مبنا")}, `"createdAt" DESC,id`},
	"categories":      {`SELECT c.id,c.name,coalesce(sum(l.net_rials),0)::bigint AS revenue,coalesce(sum(l.quantity),0)::bigint AS quantity FROM categories c LEFT JOIN products p ON p.category_id=c.id LEFT JOIN analytics_order_lines l ON l.product_id=p.id AND l.paid_at>=$1 AND l.paid_at<$2 GROUP BY c.id`, []reportColumn{col("name", "دسته‌بندی"), num("quantity", "تعداد بسته"), moneyCol("revenue", "فروش خالص")}, "revenue DESC,id"},
	"searches":        {`SELECT query AS id,query AS name,count(*) AS searches FROM analytics_events WHERE kind='search' AND created_at>=$1 AND created_at<$2 GROUP BY query`, []reportColumn{col("name", "عبارت جستجو"), num("searches", "جستجو")}, "searches DESC,id"},
	"discounts":       {`SELECT coalesce(discount_code,'بدون کد') AS id,coalesce(discount_code,'بدون کد') AS name,count(*) AS orders,sum(discount_rials)::bigint AS discount,sum(subtotal_rials-discount_rials)::bigint AS revenue FROM orders WHERE paid_at>=$1 AND paid_at<$2 AND status IN ('paid','packing','shipped','received') GROUP BY discount_code`, []reportColumn{col("name", "کد تخفیف"), num("orders", "سفارش"), moneyCol("discount", "تخفیف کد"), moneyCol("revenue", "فروش خالص")}, "revenue DESC,id"},
	"fulfillment":     {`SELECT status AS id,status AS name,count(*) AS orders FROM orders WHERE created_at>=$1 AND created_at<$2 GROUP BY status`, []reportColumn{col("name", "وضعیت"), num("orders", "سفارش")}, "orders DESC,id"},
	"referrals":       {`SELECT s.id,coalesce(nullif(s.full_name,''),s.username) AS name,(SELECT count(*) FROM customer_referrals r WHERE r.staff_id=s.id AND r.created_at>=$1 AND r.created_at<$2) AS customers,(SELECT coalesce(sum(net_rials),0)::bigint FROM commission_sales c WHERE c.staff_id=s.id AND c.created_at>=$1 AND c.created_at<$2) AS revenue,(SELECT coalesce(sum(amount_rials),0)::bigint FROM member_ledger l WHERE l.staff_id=s.id AND kind IN ('commission','commission_correction') AND l.created_at>=$1 AND l.created_at<$2) AS earned,(SELECT coalesce(sum(amount_rials),0)::bigint FROM member_ledger l WHERE l.staff_id=s.id) AS balance FROM staff s`, []reportColumn{col("name", "همکار"), num("customers", "معرفی موفق"), moneyCol("revenue", "فروش"), moneyCol("earned", "کمیسیون بازه"), moneyCol("balance", "مانده فعلی")}, "balance DESC,id"},
	"notifications":   {`SELECT status AS id,status AS name,count(*) AS messages FROM jobs WHERE kind='order_sms' AND available_at>=$1 AND available_at<$2 GROUP BY status`, []reportColumn{col("name", "وضعیت"), num("messages", "پیامک")}, "messages DESC,id"},
}

func reportQuery(r *http.Request) (reportSpec, string, []any, string, bool) {
	section := r.URL.Query().Get("section")
	if section == "" {
		section = "overview"
	}
	spec, ok := reportSpecs[section]
	if !ok {
		return spec, "", nil, "", false
	}
	from, to := reportDates(r)
	if !from.Before(to) {
		return spec, "", nil, "", false
	}
	args := []any{from, to, strings.TrimSpace(r.URL.Query().Get("q"))}
	sql := `SELECT * FROM (` + spec.SQL + `) x WHERE ($3='' OR row_to_json(x)::text ILIKE '%'||$3||'%')`
	if ids := r.URL.Query().Get("ids"); ids != "" {
		args = append(args, strings.Split(ids, ","))
		sql += ` AND id=ANY($4::text[])`
	}
	if customer := r.URL.Query().Get("customer"); customer != "" && section == "customer-orders" {
		args = append(args, customer)
		sql += ` AND "customerId"=$` + strconv.Itoa(len(args))
	}
	sort := spec.DefaultSort
	field := r.URL.Query().Get("sort")
	for _, c := range spec.Columns {
		if field == c.Key {
			sort = `"` + field + `"`
			if r.URL.Query().Get("direction") == "desc" {
				sort += " DESC"
			}
			if field != "id" {
				sort += ",id"
			}
		}
	}
	return spec, sql, args, sort, true
}
func (a *App) report(w http.ResponseWriter, r *http.Request) {
	spec, sql, args, sort, ok := reportQuery(r)
	if !ok {
		fail(w, 400, "گزارش یا بازه معتبر نیست")
		return
	}
	p, n := pageArgs(r)
	var total int64
	if e := a.Pool.QueryRow(r.Context(), "SELECT count(*) FROM ("+sql+") x", args...).Scan(&total); e != nil {
		a.dbError(w, e)
		return
	}
	args = append(args, n, (p-1)*n)
	items, e := queryMaps(r.Context(), a.Pool, sql+" ORDER BY "+sort+" LIMIT $"+strconv.Itoa(len(args)-1)+" OFFSET $"+strconv.Itoa(len(args)), args...)
	if e != nil {
		a.dbError(w, e)
		return
	}
	write(w, 200, map[string]any{"items": items, "total": total, "page": p, "pageSize": n, "columns": spec.Columns})
}
func (a *App) reportSeries(w http.ResponseWriter, r *http.Request) {
	spec, sql, args, _, ok := reportQuery(r)
	if !ok {
		fail(w, 400, "گزارش معتبر نیست")
		return
	}
	metric := r.URL.Query().Get("metric")
	valid := false
	for _, c := range spec.Columns {
		if c.Key == metric && slices.Contains([]string{"money", "number"}, c.Kind) {
			valid = true
		}
	}
	if !valid {
		fail(w, 400, "شاخص معتبر نیست")
		return
	}
	// Comparison stays on the server and follows exactly the same filters as the table/export.
	var count int64
	if e := a.Pool.QueryRow(r.Context(), "SELECT count(*) FROM ("+sql+") d", args...).Scan(&count); e != nil {
		a.dbError(w, e)
		return
	}
	combined := count > 8
	if combined {
		sql = `SELECT 'combined' AS id,'مجموع انتخاب‌ها' AS name,coalesce(sum("` + metric + `"),0)::float8 AS value FROM (` + sql + `) d`
	} else {
		sql = `SELECT id,coalesce(name,id) AS name,coalesce("` + metric + `",0)::float8 AS value FROM (` + sql + `) d ORDER BY id`
	}
	items, e := queryMaps(r.Context(), a.Pool, sql, args...)
	if e != nil {
		a.dbError(w, e)
		return
	}
	write(w, 200, map[string]any{"items": items, "combined": combined, "count": count, "metric": metric})
}
