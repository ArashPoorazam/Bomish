package reporting

import (
	"net/http"
	"slices"
	"strconv"

	"bomish/internal/database"
	"bomish/internal/httpx"
)

func (s *Service) Report(w http.ResponseWriter, r *http.Request) {
	plan, err := BuildQuery(r.URL.Query())
	if err != nil {
		httpx.Error(w, 400, "گزارش یا بازه معتبر نیست")
		return
	}
	sql, args, sort := plan.SQL, plan.Args, plan.Sort
	p, n := httpx.PageArgs(r)
	var total int64
	if e := s.Pool.QueryRow(r.Context(), "SELECT count(*) FROM ("+sql+") x", args...).Scan(&total); e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	args = append(args, n, (p-1)*n)
	items, e := database.QueryMaps(r.Context(), s.Pool, sql+" ORDER BY "+sort+" LIMIT $"+strconv.Itoa(len(args)-1)+" OFFSET $"+strconv.Itoa(len(args)), args...)
	if e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	httpx.JSON(w, 200, map[string]any{"items": items, "total": total, "page": p, "pageSize": n, "columns": plan.Columns})
}

func (s *Service) Series(w http.ResponseWriter, r *http.Request) {
	plan, err := BuildQuery(r.URL.Query())
	if err != nil {
		httpx.Error(w, 400, "گزارش معتبر نیست")
		return
	}
	sql, args := plan.SQL, plan.Args
	metric := r.URL.Query().Get("metric")
	valid := false
	for _, c := range plan.Columns {
		if c.Key == metric && slices.Contains([]string{"money", "number"}, c.Kind) {
			valid = true
		}
	}
	if !valid {
		httpx.Error(w, 400, "شاخص معتبر نیست")
		return
	}
	// Comparison stays on the server and follows exactly the same filters as the table/export.
	var count int64
	if e := s.Pool.QueryRow(r.Context(), "SELECT count(*) FROM ("+sql+") d", args...).Scan(&count); e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	combined := count > 8
	if combined {
		sql = `SELECT 'combined' AS id,'مجموع انتخاب‌ها' AS name,coalesce(sum("` + metric + `"),0)::float8 AS value FROM (` + sql + `) d`
	} else {
		sql = `SELECT id,coalesce(name,id) AS name,coalesce("` + metric + `",0)::float8 AS value FROM (` + sql + `) d ORDER BY id`
	}
	items, e := database.QueryMaps(r.Context(), s.Pool, sql, args...)
	if e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	httpx.JSON(w, 200, map[string]any{"items": items, "combined": combined, "count": count, "metric": metric})
}
