package app

import (
	"fmt"
	"net/http"
	"time"
)

func (a *App) limit(r *http.Request, key string, max int, window time.Duration) bool {
	var n int
	e := a.Pool.QueryRow(r.Context(), `INSERT INTO rate_limits(key,hits,expires_at) VALUES($1,1,now()+$2::interval) ON CONFLICT(key) DO UPDATE SET hits=CASE WHEN rate_limits.expires_at<now() THEN 1 ELSE rate_limits.hits+1 END, expires_at=CASE WHEN rate_limits.expires_at<now() THEN excluded.expires_at ELSE rate_limits.expires_at END RETURNING hits`, key, fmt.Sprintf("%d seconds", int(window.Seconds()))).Scan(&n)
	return e == nil && n <= max
}
