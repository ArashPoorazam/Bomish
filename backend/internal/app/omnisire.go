package app

import (
	"net/http"
	"strings"
	"time"

	"bomish/internal/database"
	"bomish/internal/httpx"
	"bomish/internal/reporting"
)

func (a *App) omnisireRoutes(m *http.ServeMux) {
	reports := &reporting.Service{Pool: a.Pool}
	m.HandleFunc("GET /api/v1/omnisire/summary", withPermission(a.summary, "overview"))
	m.HandleFunc("GET /api/v1/omnisire/members", withPermission(a.listMembers, "members"))
	m.HandleFunc("POST /api/v1/omnisire/members", withPermission(a.createMember, "members.create"))
	m.HandleFunc("GET /api/v1/omnisire/members/{id}", withPermission(a.memberDetail, "members"))
	m.HandleFunc("PATCH /api/v1/omnisire/members/{id}", withPermission(a.editMember, "members.edit"))
	m.HandleFunc("DELETE /api/v1/omnisire/members/{id}", withPermission(a.archiveMember, "members.delete"))
	m.HandleFunc("POST /api/v1/omnisire/members/{id}/credentials", withPermission(a.resetMemberCredentials, "members.edit"))
	m.HandleFunc("GET /api/v1/omnisire/members/{id}/sales", withPermission(a.ownerSales, "members"))
	m.HandleFunc("POST /api/v1/omnisire/members/{id}/payments", withPermission(a.recordMemberPayment, "members.edit"))
	m.HandleFunc("POST /api/v1/omnisire/members/{id}/payments/{entry}/reverse", withPermission(a.reverseMemberPayment, "members.edit"))
	m.HandleFunc("POST /api/v1/omnisire/members/{id}/refunds", withPermission(a.refundCommission, "members.edit"))
	m.HandleFunc("GET /api/v1/omnisire/events", withPermission(a.listEvents, "events"))
	m.HandleFunc("GET /api/v1/omnisire/analytics", withPermission(reports.Report, "analytics"))
	m.HandleFunc("GET /api/v1/omnisire/analytics/charts", withPermission(reports.Charts, "analytics"))
	m.HandleFunc("GET /api/v1/omnisire/analytics/series", withPermission(reports.Series, "analytics"))
	m.HandleFunc("POST /api/v1/omnisire/exports", withPermission(a.createExport, "analytics.export"))
	m.HandleFunc("GET /api/v1/omnisire/exports/{id}", withPermission(a.getExport, "analytics.export"))
	m.HandleFunc("GET /api/v1/omnisire/exports/{id}/download", withPermission(a.downloadExport, "analytics.export"))
	m.HandleFunc("POST /api/v1/omnisire/exports/{id}/retry", withPermission(a.retryExport, "analytics.export"))
	m.HandleFunc("GET /api/v1/omnisire/permission-options", withPermission(a.permissionOptions, "members"))
}

func (a *App) summary(w http.ResponseWriter, r *http.Request) {
	from, to := reporting.Dates(r.URL.Query())
	out, e := database.QueryMaps(r.Context(), a.Pool, `SELECT (SELECT coalesce(sum(subtotal_rials-discount_rials),0)::bigint FROM orders WHERE paid_at>=$1 AND paid_at<$2 AND status IN ('paid','packing','shipped','received')) AS revenue,(SELECT count(*) FROM orders WHERE paid_at>=$1 AND paid_at<$2 AND status IN ('paid','packing','shipped','received')) AS orders,(SELECT count(*) FROM staff WHERE active AND archived_at IS NULL) AS members,(SELECT coalesce(sum(balance),0)::bigint FROM (SELECT sum(amount_rials) balance FROM member_ledger GROUP BY staff_id HAVING sum(amount_rials)>0) b) AS payable`, from, to)
	if e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	httpx.JSON(w, 200, out[0])
}

func (a *App) listEvents(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	from, to := reporting.Dates(r.URL.Query())
	if q.Get("from") == "" {
		from = time.Unix(0, 0)
	}
	sort := "a.created_at DESC,a.id DESC"
	if q.Get("sort") == "oldest" {
		sort = "a.created_at,a.id"
	}
	a.paged(w, r, `SELECT a.id,a.action,a.entity_id AS "entityId",a.detail,a.created_at AS "createdAt",coalesce(nullif(s.full_name,''),nullif(s.username,''),'سیستم') AS "actorName",coalesce(a.staff_id,'') AS "staffId" FROM audit_events a LEFT JOIN staff s ON s.id=a.staff_id WHERE a.created_at >= $1 AND a.created_at < $2 AND ($3='' OR a.staff_id=$3) AND ($4='' OR a.action=$4) AND ($5='' OR a.entity_id=$5) AND ($6='' OR a.action||' '||a.entity_id ILIKE '%'||$6||'%' OR s.full_name||' '||s.username ILIKE '%'||$6||'%')`, []any{from, to, q.Get("actor"), q.Get("action"), q.Get("entity"), strings.TrimSpace(q.Get("q"))}, sort)
}
