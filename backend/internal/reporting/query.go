package reporting

import (
	"errors"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"time"

	"bomish/internal/domain"
)

type Column struct {
	Key   string `json:"key"`
	Label string `json:"label"`
	Kind  string `json:"kind"`
}

type reportSpec struct {
	SQL         string
	Columns     []Column
	DefaultSort string
}

func col(k, l string) Column { return Column{k, l, "text"} }

func num(k, l string) Column { return Column{k, l, "number"} }

func moneyCol(k, l string) Column { return Column{k, l + " (تومان)", "money"} }

func dateCol(k, l string) Column { return Column{k, l, "date"} }

var reportSpecs = map[string]reportSpec{
	"overview":        {`SELECT to_char(paid_at AT TIME ZONE 'Asia/Tehran','YYYY-MM-DD') AS id,to_char(paid_at AT TIME ZONE 'Asia/Tehran','YYYY-MM-DD') AS name,count(*) AS orders,sum(subtotal_rials-discount_rials)::bigint AS revenue,avg(subtotal_rials-discount_rials)::bigint AS average FROM orders WHERE paid_at>=$1 AND paid_at<$2 AND status IN ('paid','packing','shipped','received') GROUP BY 1`, []Column{col("name", "روز"), num("orders", "سفارش پرداخت‌شده"), moneyCol("revenue", "فروش خالص کالا"), moneyCol("average", "میانگین سفارش")}, "id DESC"},
	"products":        {`SELECT p.id,p.name,coalesce(s.quantity,0)::bigint AS quantity,coalesce(s.revenue,0)::bigint AS revenue,coalesce(v.views,0)::bigint AS views,coalesce(v.clicks,0)::bigint AS clicks FROM products p LEFT JOIN (SELECT product_id,sum(quantity) quantity,sum(net_rials) revenue FROM analytics_order_lines WHERE paid_at>=$1 AND paid_at<$2 GROUP BY product_id) s ON s.product_id=p.id LEFT JOIN (SELECT product_id,count(*) FILTER(WHERE kind='view') views,count(*) FILTER(WHERE kind='click') clicks FROM analytics_events WHERE created_at>=$1 AND created_at<$2 GROUP BY product_id) v ON v.product_id=p.id`, []Column{col("name", "محصول"), num("quantity", "بسته فروخته‌شده"), moneyCol("revenue", "فروش خالص"), num("views", "بازدید یکتا در ۳۰ دقیقه"), num("clicks", "کلیک یکتا در ۳۰ دقیقه")}, "revenue DESC,id"},
	"packages":        {`SELECT product_id||':'||package_id AS id,max(name)||' · '||max(package_label) AS name,sum(quantity)::bigint AS quantity,sum(net_rials)::bigint AS revenue FROM analytics_order_lines WHERE paid_at>=$1 AND paid_at<$2 GROUP BY product_id,package_id`, []Column{col("name", "محصول / بسته"), num("quantity", "تعداد"), moneyCol("revenue", "فروش خالص")}, "revenue DESC,id"},
	"customers":       {`SELECT u.id,coalesce(nullif(c.name,''),u.phone) AS name,u.phone,u.created_at AS "createdAt",coalesce(c.orders,0)::bigint AS orders,coalesce(c.revenue,0)::bigint AS revenue FROM users u LEFT JOIN (SELECT user_id,max(address->>'recipient') name,count(*) orders,sum(subtotal_rials-discount_rials) revenue FROM orders WHERE paid_at>=$1 AND paid_at<$2 AND status IN ('paid','packing','shipped','received') GROUP BY user_id) c ON c.user_id=u.id`, []Column{col("name", "مشتری"), col("phone", "همراه"), dateCol("createdAt", "عضویت"), num("orders", "سفارش"), moneyCol("revenue", "خرید")}, "revenue DESC,id"},
	"customer-orders": {`SELECT o.id,o.user_id AS "customerId",coalesce(o.address->>'recipient','') AS name,o.paid_at AS "createdAt",o.status,o.subtotal_rials-o.discount_rials AS revenue,(SELECT string_agg(i.name||' × '||i.quantity::text,'، ') FROM order_items i WHERE i.order_id=o.id) AS items FROM orders o WHERE o.paid_at>=$1 AND o.paid_at<$2 AND o.status IN ('paid','packing','shipped','received')`, []Column{col("id", "سفارش"), col("name", "مشتری"), dateCol("createdAt", "پرداخت"), col("items", "محصولات"), moneyCol("revenue", "خرید")}, `"createdAt" DESC,id`},
	"prices":          {`SELECT h.id::text AS id,p.name||' · '||h.package_label AS name,h.product_id AS "productId",h.product_id||':'||h.package_id AS "comparisonId",h.old_rials AS "oldRials",h.new_rials AS "newRials",h.new_rials-h.old_rials AS change,CASE WHEN h.old_rials>0 THEN round((h.new_rials-h.old_rials)*100.0/h.old_rials,2)::float8 END AS percent,h.old_discount AS "oldDiscount",h.new_discount AS "newDiscount",h.created_at AS "createdAt",h.baseline,coalesce(nullif(s.full_name,''),s.username,'سیستم') AS actor FROM price_history h JOIN products p ON p.id=h.product_id LEFT JOIN staff s ON s.id=h.actor_id WHERE h.created_at>=$1 AND h.created_at<$2`, []Column{col("name", "محصول / بسته"), moneyCol("oldRials", "قیمت قبل"), moneyCol("newRials", "قیمت جدید"), moneyCol("change", "تغییر"), num("percent", "درصد تغییر"), num("oldDiscount", "تخفیف قبل ٪"), num("newDiscount", "تخفیف جدید ٪"), col("actor", "همکار"), dateCol("createdAt", "زمان"), col("baseline", "ثبت مبنا")}, `"createdAt" DESC,id`},
	"categories":      {`SELECT c.id,c.name,coalesce(sum(l.net_rials),0)::bigint AS revenue,coalesce(sum(l.quantity),0)::bigint AS quantity FROM categories c LEFT JOIN products p ON p.category_id=c.id LEFT JOIN analytics_order_lines l ON l.product_id=p.id AND l.paid_at>=$1 AND l.paid_at<$2 GROUP BY c.id`, []Column{col("name", "دسته‌بندی"), num("quantity", "تعداد بسته"), moneyCol("revenue", "فروش خالص")}, "revenue DESC,id"},
	"searches":        {`SELECT query AS id,query AS name,count(*) AS searches FROM analytics_events WHERE kind='search' AND created_at>=$1 AND created_at<$2 GROUP BY query`, []Column{col("name", "عبارت جستجو"), num("searches", "جستجو")}, "searches DESC,id"},
	"discounts":       {`SELECT coalesce(discount_code,'بدون کد') AS id,coalesce(discount_code,'بدون کد') AS name,count(*) AS orders,sum(discount_rials)::bigint AS discount,sum(subtotal_rials-discount_rials)::bigint AS revenue FROM orders WHERE paid_at>=$1 AND paid_at<$2 AND status IN ('paid','packing','shipped','received') GROUP BY discount_code`, []Column{col("name", "کد تخفیف"), num("orders", "سفارش"), moneyCol("discount", "تخفیف کد"), moneyCol("revenue", "فروش خالص")}, "revenue DESC,id"},
	"fulfillment":     {`SELECT status AS id,status AS name,count(*) AS orders FROM orders WHERE created_at>=$1 AND created_at<$2 GROUP BY status`, []Column{col("name", "وضعیت"), num("orders", "سفارش")}, "orders DESC,id"},
	"referrals":       {`SELECT s.id,coalesce(nullif(s.full_name,''),s.username) AS name,(SELECT count(*) FROM customer_referrals r WHERE r.staff_id=s.id AND r.created_at>=$1 AND r.created_at<$2) AS customers,(SELECT coalesce(sum(net_rials),0)::bigint FROM commission_sales c WHERE c.staff_id=s.id AND c.created_at>=$1 AND c.created_at<$2) AS revenue,(SELECT coalesce(sum(amount_rials),0)::bigint FROM member_ledger l WHERE l.staff_id=s.id AND kind IN ('commission','commission_correction') AND l.created_at>=$1 AND l.created_at<$2) AS earned,(SELECT coalesce(sum(amount_rials),0)::bigint FROM member_ledger l WHERE l.staff_id=s.id) AS balance FROM staff s`, []Column{col("name", "همکار"), num("customers", "معرفی موفق"), moneyCol("revenue", "فروش"), moneyCol("earned", "کمیسیون بازه"), moneyCol("balance", "مانده فعلی")}, "balance DESC,id"},
	"notifications":   {`SELECT status AS id,CASE status WHEN 'pending' THEN 'در صف ارسال' WHEN 'sending' THEN 'در حال ارسال' WHEN 'accepted' THEN 'پذیرفته‌شده توسط کاوه‌نگار (تحویل تأیید نشده)' WHEN 'unknown' THEN 'نتیجه نامشخص؛ نیازمند بررسی' WHEN 'failed' THEN 'ارسال ناموفق' WHEN 'skipped' THEN 'ارسال نشده' ELSE status END AS name,count(*) AS messages FROM jobs WHERE kind='order_sms' AND created_at>=$1 AND created_at<$2 GROUP BY status`, []Column{col("name", "وضعیت"), num("messages", "پیامک")}, "messages DESC,id"},
}

// QueryPlan contains only allowlisted SQL identifiers and parameterized values.
type QueryPlan struct {
	SQL     string
	Args    []any
	Sort    string
	Columns []Column
}

func BuildQuery(values url.Values) (QueryPlan, error) {
	section := values.Get("section")
	if section == "" {
		section = "overview"
	}
	spec, ok := reportSpecs[section]
	if !ok {
		return QueryPlan{}, errors.New("invalid report filters")
	}
	from, to := Dates(values)
	for _, key := range []string{"from", "to"} {
		if value := values.Get(key); value != "" {
			if _, e := time.Parse("2006-01-02", value); e != nil {
				return QueryPlan{}, errors.New("invalid report filters")
			}
		}
	}
	if !from.Before(to) || to.Sub(from) > 366*24*time.Hour {
		return QueryPlan{}, errors.New("invalid report filters")
	}
	query := domain.Normalize(values.Get("q"))
	if len(query) > 500 {
		return QueryPlan{}, errors.New("invalid report filters")
	}
	// Search meaningful labels, not JSON keys or incidental numeric metrics.
	fields := []string{"coalesce(name,'')", "id"}
	switch section {
	case "customers":
		fields = append(fields, "phone")
	case "prices":
		fields = append(fields, "actor")
	case "customer-orders":
		fields = append(fields, "coalesce(items,'')")
	}
	query = strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(query)
	args := []any{from, to, query}
	sql := `SELECT * FROM (` + spec.SQL + `) x WHERE ($3='' OR lower(translate(` + strings.Join(fields, `||' '||`) + `, 'يك۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩', 'یک01234567890123456789')) LIKE '%'||$3||'%')`
	if ids := values.Get("ids"); ids != "" {
		args = append(args, strings.Split(ids, ","))
		sql += ` AND id=ANY($4::text[])`
	}
	if customer := values.Get("customer"); customer != "" && section == "customer-orders" {
		args = append(args, customer)
		sql += ` AND "customerId"=$` + strconv.Itoa(len(args))
	}
	sort := spec.DefaultSort
	field := values.Get("sort")
	for _, c := range spec.Columns {
		if field == c.Key {
			sort = `"` + field + `"`
			if values.Get("direction") == "desc" {
				sort += " DESC"
			}
			sort += " NULLS LAST"
			if field != "id" {
				sort += ",id"
			}
		}
	}
	return QueryPlan{SQL: sql, Args: args, Sort: sort, Columns: slices.Clone(spec.Columns)}, nil
}

func Dates(values url.Values) (time.Time, time.Time) {
	zone := tehran()
	now := time.Now().In(zone)
	end := time.Date(now.Year(), now.Month(), now.Day()+1, 0, 0, 0, 0, zone)
	start := end.AddDate(0, 0, -30)
	if t, e := time.ParseInLocation("2006-01-02", values.Get("from"), zone); e == nil {
		start = t
	}
	if t, e := time.ParseInLocation("2006-01-02", values.Get("to"), zone); e == nil {
		end = t.AddDate(0, 0, 1)
	}
	return start, end
}
