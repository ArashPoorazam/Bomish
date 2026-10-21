package app

import (
	"net/http"
	"strconv"
)

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
