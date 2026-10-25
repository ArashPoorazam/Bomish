package httpx

import (
	"context"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"bomish/internal/security"
)

type responseStatus struct {
	http.ResponseWriter
	status int
	bytes  int
}

type requestIDKey struct{}

func Observe(next http.Handler, mux *http.ServeMux, metrics ...*RequestMetrics) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started := time.Now()
		id := security.Token()[:24]
		w.Header().Set("X-Request-ID", id)
		wrapped := &responseStatus{ResponseWriter: w}
		r = r.WithContext(context.WithValue(r.Context(), requestIDKey{}, id))
		next.ServeHTTP(wrapped, r)
		status := wrapped.status
		if status == 0 {
			status = 200
		}
		// Monitoring and health probes must not inflate application traffic.
		if len(metrics) > 0 && metrics[0] != nil && strings.HasPrefix(r.URL.Path, "/api/v1/") && r.URL.Path != "/api/v1/health" && r.URL.Path != "/api/v1/omnisire/monitoring" {
			metrics[0].Record(time.Now(), status, time.Since(started))
		}
		// Route patterns omit user IDs and queries. No cookies, bodies, authorization,
		// phone numbers, addresses, OTPs or IP addresses are recorded in access logs.
		_, route := mux.Handler(r)
		if route == "" {
			route = "unmatched"
		}
		slog.Info("http_request", "request_id", id, "method", r.Method, "route", route, "status", status, "duration_ms", time.Since(started).Milliseconds(), "bytes", wrapped.bytes)
	})
}

func RequestID(ctx context.Context) string {
	id, _ := ctx.Value(requestIDKey{}).(string)
	return id
}

func (w *responseStatus) Unwrap() http.ResponseWriter { return w.ResponseWriter }

func (w *responseStatus) WriteHeader(status int) {
	if w.status == 0 {
		w.status = status
		w.ResponseWriter.WriteHeader(status)
	}
}

func (w *responseStatus) Write(b []byte) (int, error) {
	if w.status == 0 {
		w.WriteHeader(200)
	}
	n, e := w.ResponseWriter.Write(b)
	w.bytes += n
	return n, e
}
