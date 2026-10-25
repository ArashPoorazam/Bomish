package httpx

import (
	"net/http"
	"strconv"
)

func PageArgs(r *http.Request) (int, int) {
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

// List responses are bounded; explicit pagination returns an envelope.
func List(w http.ResponseWriter, r *http.Request, items any, total int64) {
	p, n := PageArgs(r)
	if r.URL.Query().Has("page") {
		JSON(w, 200, map[string]any{"items": items, "total": total, "page": p, "pageSize": n})
	} else {
		w.Header().Set("X-Total-Count", strconv.FormatInt(total, 10))
		JSON(w, 200, items)
	}
}
