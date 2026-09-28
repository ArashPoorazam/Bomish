package app

import (
	"context"
	"encoding/json"
	"github.com/jackc/pgx/v5"
	"net/http"
	"strconv"
	"strings"
	"time"
)

func (a *App) omnisireRoutes(m *http.ServeMux) {
	routes := map[string]http.HandlerFunc{
		"GET /api/v1/omnisire/summary":                                a.summary,
		"GET /api/v1/omnisire/members":                                a.listMembers,
		"POST /api/v1/omnisire/members":                               a.createMember,
		"GET /api/v1/omnisire/members/{id}":                           a.memberDetail,
		"PATCH /api/v1/omnisire/members/{id}":                         a.editMember,
		"DELETE /api/v1/omnisire/members/{id}":                        a.archiveMember,
		"POST /api/v1/omnisire/members/{id}/credentials":              a.resetMemberCredentials,
		"GET /api/v1/omnisire/members/{id}/sales":                     a.ownerSales,
		"POST /api/v1/omnisire/members/{id}/payments":                 a.recordMemberPayment,
		"POST /api/v1/omnisire/members/{id}/payments/{entry}/reverse": a.reverseMemberPayment,
		"POST /api/v1/omnisire/members/{id}/refunds":                  a.refundCommission,
		"GET /api/v1/omnisire/events":                                 a.listEvents,
		"GET /api/v1/omnisire/analytics":                              a.report,
		"GET /api/v1/omnisire/analytics/charts":                       a.reportCharts,
		"GET /api/v1/omnisire/analytics/series":                       a.reportSeries,
		"POST /api/v1/omnisire/exports":                               a.createExport,
		"GET /api/v1/omnisire/exports/{id}":                           a.getExport,
		"GET /api/v1/omnisire/exports/{id}/download":                  a.downloadExport,
		"POST /api/v1/omnisire/exports/{id}/retry":                    a.retryExport,
	}
	for route, h := range routes {
		m.HandleFunc(route, a.permit(h, "omnisire"))
	}
	m.HandleFunc("GET /api/v1/staff/sales", a.permit(a.personalSales, "sales"))
	m.HandleFunc("POST /api/v1/referral", a.captureReferral)
	m.HandleFunc("GET /api/v1/staff/product-options", a.productOptions)
	m.HandleFunc("GET /api/v1/staff/category-counts", a.permit(a.categoryCounts, "categories"))
}

type pageResult struct {
	Items    []map[string]any `json:"items"`
	Total    int64            `json:"total"`
	Page     int              `json:"page"`
	PageSize int              `json:"pageSize"`
}

func pageArgs(r *http.Request) (int, int) {
	p, _ := strconv.Atoi(r.URL.Query().Get("page"))
	n, _ := strconv.Atoi(r.URL.Query().Get("pageSize"))
	if p < 1 {
		p = 1
	}
	if p > 1000000 {
		p = 1000000
	}
	if n < 1 {
		n = 25
	}
	if n > 100 {
		n = 100
	}
	return p, n
}
func queryMaps(ctx context.Context, q querier, sql string, args ...any) ([]map[string]any, error) {
	rows, e := q.Query(ctx, sql, args...)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []map[string]any{}
	fields := rows.FieldDescriptions()
	for rows.Next() {
		vals, e := rows.Values()
		if e != nil {
			return nil, e
		}
		row := map[string]any{}
		for i, f := range fields {
			row[string(f.Name)] = vals[i]
		}
		out = append(out, row)
	}
	return out, rows.Err()
}
func (a *App) paged(w http.ResponseWriter, r *http.Request, sql string, args []any, sort string) {
	p, n := pageArgs(r)
	var total int64
	if e := a.Pool.QueryRow(r.Context(), "SELECT count(*) FROM ("+sql+") report", args...).Scan(&total); e != nil {
		a.dbError(w, e)
		return
	}
	args = append(args, n, (p-1)*n)
	items, e := queryMaps(r.Context(), a.Pool, sql+" ORDER BY "+sort+" LIMIT $"+strconv.Itoa(len(args)-1)+" OFFSET $"+strconv.Itoa(len(args)), args...)
	if e != nil {
		a.dbError(w, e)
		return
	}
	write(w, 200, pageResult{items, total, p, n})
}
func auditDetail(ctx context.Context, tx pgx.Tx, actor, action, id string, detail any) error {
	b, e := json.Marshal(detail)
	if e != nil {
		return e
	}
	_, e = tx.Exec(ctx, "INSERT INTO audit_events(staff_id,action,entity_id,detail) VALUES(nullif($1,''),$2,$3,$4)", actor, action, id, b)
	return e
}
func (a *App) logEvent(ctx context.Context, actor, action, id string, detail any) {
	b, _ := json.Marshal(detail)
	_, _ = a.Pool.Exec(ctx, "INSERT INTO audit_events(staff_id,action,entity_id,detail) VALUES(nullif($1,''),$2,$3,$4)", actor, action, id, b)
}
func reportDates(r *http.Request) (time.Time, time.Time) {
	zone, _ := time.LoadLocation("Asia/Tehran")
	now := time.Now().In(zone)
	end := time.Date(now.Year(), now.Month(), now.Day()+1, 0, 0, 0, 0, zone)
	start := end.AddDate(0, 0, -30)
	if t, e := time.ParseInLocation("2006-01-02", r.URL.Query().Get("from"), zone); e == nil {
		start = t
	}
	if t, e := time.ParseInLocation("2006-01-02", r.URL.Query().Get("to"), zone); e == nil {
		end = t.AddDate(0, 0, 1)
	}
	return start, end
}
func (a *App) listEvents(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	from, to := reportDates(r)
	if q.Get("from") == "" {
		from = time.Unix(0, 0)
	}
	sort := "a.created_at DESC,a.id DESC"
	if q.Get("sort") == "oldest" {
		sort = "a.created_at,a.id"
	}
	a.paged(w, r, `SELECT a.id,a.action,a.entity_id AS "entityId",a.detail,a.created_at AS "createdAt",coalesce(nullif(s.full_name,''),nullif(s.username,''),'سیستم') AS "actorName",coalesce(a.staff_id,'') AS "staffId" FROM audit_events a LEFT JOIN staff s ON s.id=a.staff_id WHERE a.created_at >= $1 AND a.created_at < $2 AND ($3='' OR a.staff_id=$3) AND ($4='' OR a.action=$4) AND ($5='' OR a.entity_id=$5) AND ($6='' OR a.action||' '||a.entity_id ILIKE '%'||$6||'%' OR s.full_name||' '||s.username ILIKE '%'||$6||'%')`, []any{from, to, q.Get("actor"), q.Get("action"), q.Get("entity"), strings.TrimSpace(q.Get("q"))}, sort)
}
