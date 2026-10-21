package app

import (
	"net/http"
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
		section, action := "overview", "view"
		switch {
		case strings.Contains(route, "/members"):
			section = "members"
			if strings.HasPrefix(route, "POST ") {
				action = "edit"
				if route == "POST /api/v1/omnisire/members" {
					action = "create"
				}
			}
			if strings.HasPrefix(route, "PATCH ") {
				action = "edit"
			}
			if strings.HasPrefix(route, "DELETE ") {
				action = "delete"
			}
		case strings.Contains(route, "/events"):
			section = "events"
		case strings.Contains(route, "/analytics"):
			section = "analytics"
		case strings.Contains(route, "/exports"):
			section, action = "analytics", "export"
		}
		m.HandleFunc(route, a.permit(h, section, action))
	}
	m.HandleFunc("GET /api/v1/omnisire/permission-options", a.permit(a.permissionOptions, "members"))
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
