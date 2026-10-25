package app

import (
	"net/http"
	"strconv"

	"bomish/internal/database"
	"bomish/internal/httpx"
)

type pageResult struct {
	Items    []map[string]any `json:"items"`
	Total    int64            `json:"total"`
	Page     int              `json:"page"`
	PageSize int              `json:"pageSize"`
}

func (a *App) paged(w http.ResponseWriter, r *http.Request, sql string, args []any, sort string) {
	p, n := httpx.PageArgs(r)
	var total int64
	if e := a.Pool.QueryRow(r.Context(), "SELECT count(*) FROM ("+sql+") report", args...).Scan(&total); e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	args = append(args, n, (p-1)*n)
	items, e := database.QueryMaps(r.Context(), a.Pool, sql+" ORDER BY "+sort+" LIMIT $"+strconv.Itoa(len(args)-1)+" OFFSET $"+strconv.Itoa(len(args)), args...)
	if e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	httpx.JSON(w, 200, pageResult{items, total, p, n})
}
