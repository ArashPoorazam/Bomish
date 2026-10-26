package app

import (
	"net/http"
	"strings"
	"time"

	"bomish/internal/database"
	"bomish/internal/httpx"
	"bomish/internal/reporting"
	"github.com/jackc/pgx/v5"
)

// Classify by recorded action, without inferring severity from arbitrary payloads.
const eventSource = `SELECT a.id,a.action,a.entity_id AS "entityId",a.detail,a.created_at AS "createdAt",
 coalesce(nullif(s.full_name,''),nullif(s.username,''),'سیستم') AS "actorName",coalesce(a.staff_id,'') AS "staffId",
 CASE
 WHEN split_part(a.action,'.',1) IN ('auth','staff','owner') THEN 'access'
 WHEN split_part(a.action,'.',1) IN ('product','product-discount','product_packaging','packaging','inventory','article','articles','category','store','pricing','discount') THEN 'catalog'
 WHEN split_part(a.action,'.',1) IN ('order','shipping') THEN 'orders'
 WHEN split_part(a.action,'.',1) IN ('payment','commission','referral') THEN 'finance'
 ELSE 'other' END AS category,
 a.action IN ('auth.failed','auth.omnisire_failed','order.review') AS "reviewSignal"
 FROM audit_events a LEFT JOIN staff s ON s.id=a.staff_id
 WHERE a.created_at >= $1 AND a.created_at < $2
 AND ($3='' OR a.staff_id=$3) AND ($4='' OR a.action=$4) AND ($5='' OR a.entity_id=$5)
 AND ($6='' OR a.action||' '||a.entity_id ILIKE '%'||$6||'%'
 OR concat_ws(' ',s.full_name,s.username) ILIKE '%'||$6||'%'
 OR a.id::text=$6 OR a.detail->>'requestId'=$6)`
const filteredEvents = `WITH source AS (` + eventSource + `) SELECT * FROM source WHERE ($7='' OR category=$7) AND (NOT $8 OR "reviewSignal")`

func (a *App) listEvents(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	for _, key := range []string{"from", "to"} {
		if q.Get(key) != "" {
			if _, err := time.Parse("2006-01-02", q.Get(key)); err != nil {
				httpx.Error(w, 400, "Invalid event date range")
				return
			}
		}
	}
	from, to := reporting.Dates(q)
	if q.Get("from") == "" {
		from = time.Unix(0, 0)
	}
	if !from.Before(to) {
		httpx.Error(w, 400, "Start date must not follow end date")
		return
	}
	category := q.Get("category")
	switch category {
	case "", "access", "catalog", "orders", "finance", "other":
	default:
		httpx.Error(w, 400, "Invalid event category")
		return
	}
	if q.Get("review") != "" && q.Get("review") != "true" && q.Get("review") != "false" {
		httpx.Error(w, 400, "Invalid review filter")
		return
	}
	args := []any{from, to, q.Get("actor"), q.Get("action"), q.Get("entity"), strings.TrimSpace(q.Get("q")), category, q.Get("review") == "true"}
	sort := `"createdAt" DESC,id DESC`
	if q.Get("sort") == "oldest" {
		sort = `"createdAt",id`
	}
	// Counts and the page must describe the same snapshot while new events arrive.
	tx, err := a.Pool.BeginTx(r.Context(), pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		httpx.DatabaseError(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	var total, actors, unattributed, review int64
	err = tx.QueryRow(r.Context(), `SELECT count(*),count(DISTINCT nullif("staffId",'')),count(*) FILTER (WHERE "staffId"=''),count(*) FILTER (WHERE "reviewSignal") FROM (`+filteredEvents+`) events`, args...).Scan(&total, &actors, &unattributed, &review)
	if err != nil {
		httpx.DatabaseError(w, err)
		return
	}
	page, size := httpx.PageArgs(r)
	lastPage := max(1, (int(total)+size-1)/size)
	page = min(page, lastPage)
	args = append(args, size, (page-1)*size)
	items, err := database.QueryMaps(r.Context(), tx, filteredEvents+` ORDER BY `+sort+` LIMIT $9 OFFSET $10`, args...)
	if err != nil {
		httpx.DatabaseError(w, err)
		return
	}
	if err = tx.Commit(r.Context()); err != nil {
		httpx.DatabaseError(w, err)
		return
	}
	httpx.JSON(w, 200, map[string]any{"items": items, "total": total, "page": page, "pageSize": size, "summary": map[string]int64{"actors": actors, "unattributed": unattributed, "review": review}})
}
