package app

import (
	"bomish/internal/domain"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// List responses are bounded; explicit pagination returns an envelope.
func listResponse(w http.ResponseWriter, r *http.Request, items any, total int64) {
	p, n := pageArgs(r)
	if r.URL.Query().Has("page") {
		write(w, 200, map[string]any{"items": items, "total": total, "page": p, "pageSize": n})
	} else {
		w.Header().Set("X-Total-Count", strconv.FormatInt(total, 10))
		write(w, 200, items)
	}
}
func (a *App) catalogPage(w http.ResponseWriter, r *http.Request, staff bool) {
	q := r.URL.Query()
	page, size := pageArgs(r)
	query := domain.Normalize(strings.TrimSpace(q.Get("q")))
	if len(query) > 500 {
		fail(w, 400, "جستجو بیش از حد طولانی است")
		return
	}
	max, _ := strconv.ParseInt(domain.Normalize(q.Get("max")), 10, 64)
	if max < 0 || max > 10000000000 {
		fail(w, 400, "سقف قیمت معتبر نیست")
		return
	}
	// Read draft content only in authenticated catalog tools. Filtering and sorting happen before pagination.
	content := "p.content"
	join := ""
	status := "p.status"
	where := `p.status='published'`
	if staff {
		content = "coalesce(d.content,p.content)"
		join = "LEFT JOIN product_drafts d ON d.product_id=p.id"
		status = "CASE WHEN p.status='archived' THEN 'archived' WHEN d.product_id IS NOT NULL THEN 'draft' ELSE p.status END"
		where = "true"
	}
	metric := "0::bigint AS sold_quantity"
	if q.Get("collection") == "bestsellers" {
		join += ` JOIN (SELECT oi.product_id,sum(oi.quantity) AS sold_quantity FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE o.paid_at>=now()-interval '30 days' AND o.paid_at<=now() AND o.status IN ('paid','packing','shipped','received') GROUP BY oi.product_id) sales ON sales.product_id=p.id`
		metric = "sales.sold_quantity"
	}
	base := `WITH catalog AS (SELECT ` + metric + `,p.id,p.first_published_at,p.restocked_at,p.slug,p.name,p.search_text,p.category_id,p.status AS published_status,` + status + ` AS status,p.price_rials,p.min_grams,` + content + ` AS content,coalesce((p.content->>'outOfStock')::boolean,false) AS out_of_stock,prices.min_price,prices.min_weight FROM products p ` + join + ` LEFT JOIN LATERAL (SELECT min(CASE WHEN coalesce((` + content + `->>'discountPercent')::numeric,0)>0 THEN least((pack->>'priceRials')::numeric,ceil((pack->>'priceRials')::numeric*(100-(` + content + `->>'discountPercent')::numeric)/1000000)*10000) ELSE (pack->>'priceRials')::numeric END) min_price,min(CASE pack->>'unit' WHEN 'g' THEN (pack->>'amount')::numeric WHEN 'kg' THEN (pack->>'amount')::numeric*1000 ELSE (pack->>'shippingGrams')::numeric END) min_weight FROM jsonb_array_elements(coalesce(nullif(` + content + `->'packages','null'::jsonb),'[]')) pack) prices ON true WHERE ` + where + `) SELECT * FROM catalog WHERE ($1='' OR id=$1 OR search_text LIKE '%'||$1||'%' OR name||' '||slug||' '||content::text ILIKE '%'||$1||'%' OR similarity(search_text,$1)>0.12) AND ($2='' OR category_id=$2) AND ($3='' OR status=$3) AND ($4='' OR ($4 IN ('true','in') AND NOT out_of_stock) OR ($4='out' AND out_of_stock)) AND ($5::bigint=0 OR min_price<=$5) AND ($6::text[]='{}' OR id=ANY($6::text[]))`
	if q.Get("discounted") == "true" {
		base += " AND coalesce((content->>'discountPercent')::numeric,0)>0"
	}
	if q.Get("collection") == "suggestions" {
		base += " AND id IN (SELECT product_id FROM product_suggestions)"
	}
	if q.Get("collection") == "arrivals" {
		base += " AND (first_published_at IS NOT NULL OR restocked_at IS NOT NULL)"
	}

	ids := []string{}
	if q.Get("ids") != "" {
		ids = strings.Split(q.Get("ids"), ",")
	}
	args := []any{query, q.Get("category"), q.Get("status"), q.Get("available"), max * 10, ids}
	var total int64
	if e := a.Pool.QueryRow(r.Context(), "SELECT count(*) FROM ("+base+") x", args...).Scan(&total); e != nil {
		a.dbError(w, e)
		return
	}
	sort := "name,id"
	switch q.Get("sort") {
	case "newest":
		sort = "greatest(first_published_at,restocked_at) DESC NULLS LAST,id"
	case "price-asc":
		sort = "min_price,id"
	case "price-desc":
		sort = "min_price DESC,id"
	case "name":
		sort = "name,id"
	default:
		if query != "" {
			sort = "(id=$1 OR slug=$1) DESC,similarity(name,$1) DESC,name,id"
		}
	}
	if q.Get("collection") == "suggestions" {
		sort = "(SELECT position FROM product_suggestions WHERE product_id=catalog.id),id"
	}
	if q.Get("collection") == "bestsellers" {
		sort = "sold_quantity DESC,id"
	}

	rows, e := queryMaps(r.Context(), a.Pool, base+" ORDER BY "+sort+" LIMIT $7 OFFSET $8", append(args, size, (page-1)*size)...)
	if e != nil {
		a.dbError(w, e)
		return
	}
	out := []domain.Product{}
	for _, row := range rows {
		var p domain.Product
		b, _ := json.Marshal(row["content"])
		_ = json.Unmarshal(b, &p)
		p.FirstPublishedAt = ""
		if published, ok := row["first_published_at"].(time.Time); ok {
			p.FirstPublishedAt = published.Format(time.RFC3339Nano)
		}
		p.ID = row["id"].(string)
		p.Status = row["status"].(string)
		if p.Name == "" {
			p.Name = row["name"].(string)
		}
		if p.Slug == "" {
			p.Slug = row["slug"].(string)
		}
		if p.CategoryID == "" {
			p.CategoryID = row["category_id"].(string)
		}
		p.OutOfStock = row["out_of_stock"].(bool)
		p.EnsurePackages()
		out = append(out, p)
	}
	listResponse(w, r, out, total)
}
func (a *App) productOptions(w http.ResponseWriter, r *http.Request) {
	if !(can(r, "products") || can(r, "articles") || can(r, "categories") || can(r, "pricing")) {
		fail(w, 403, "به این بخش دسترسی ندارید")
		return
	}
	a.catalogPage(w, r, can(r, "products") || can(r, "pricing"))
}
func (a *App) summary(w http.ResponseWriter, r *http.Request) {
	from, to := reportDates(r)
	out, e := queryMaps(r.Context(), a.Pool, `SELECT (SELECT coalesce(sum(subtotal_rials-discount_rials),0)::bigint FROM orders WHERE paid_at>=$1 AND paid_at<$2 AND status IN ('paid','packing','shipped','received')) AS revenue,(SELECT count(*) FROM orders WHERE paid_at>=$1 AND paid_at<$2 AND status IN ('paid','packing','shipped','received')) AS orders,(SELECT count(*) FROM staff WHERE active AND archived_at IS NULL) AS members,(SELECT coalesce(sum(balance),0)::bigint FROM (SELECT sum(amount_rials) balance FROM member_ledger GROUP BY staff_id HAVING sum(amount_rials)>0) b) AS payable`, from, to)
	if e != nil {
		a.dbError(w, e)
		return
	}
	write(w, 200, out[0])
}

func (a *App) categoryCounts(w http.ResponseWriter, r *http.Request) {
	rows, e := queryMaps(r.Context(), a.Pool, `SELECT c.id,count(DISTINCT p.id) AS count FROM categories c LEFT JOIN products p ON p.category_id=c.id OR EXISTS(SELECT 1 FROM product_drafts d WHERE d.product_id=p.id AND d.content->>'categoryId'=c.id) GROUP BY c.id`)
	if e != nil {
		a.dbError(w, e)
		return
	}
	out := map[string]any{}
	for _, row := range rows {
		out[row["id"].(string)] = row["count"]
	}
	write(w, 200, out)
}
