package app

import (
	"context"
	"log/slog"
	"net"
	"net/http"
	"net/netip"
	"strings"
	"time"
)

func catalogBlocked(r *http.Request) bool {
	p := r.URL.Path
	return strings.HasPrefix(p, "/api/v1/checkout") || strings.HasPrefix(p, "/api/v1/auth/") ||
		strings.HasPrefix(p, "/api/v1/webhooks/") || strings.HasPrefix(p, "/api/v1/shipping/") ||
		(strings.HasPrefix(p, "/api/v1/orders/") && strings.HasSuffix(p, "/simulate")) ||
		(strings.HasPrefix(p, "/api/v1/cart/items/") && r.Method != "GET" && r.Method != "HEAD")
}
func (a *App) trusted(ip netip.Addr) bool {
	for _, p := range a.TrustedProxies {
		if p.Contains(ip.Unmap()) {
			return true
		}
	}
	return false
}
func (a *App) clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	peer, err := netip.ParseAddr(host)
	if err != nil {
		return "unknown"
	}
	if !a.trusted(peer) {
		return peer.Unmap().String()
	}
	// Walk from the closest proxy back to the first untrusted hop. Never trust
	// client-supplied CF-Connecting-IP or X-Forwarded-For without this chain.
	parts := strings.Split(r.Header.Get("X-Forwarded-For"), ",")
	for i := len(parts) - 1; i >= 0; i-- {
		candidate, err := netip.ParseAddr(strings.TrimSpace(parts[i]))
		if err != nil {
			return peer.Unmap().String()
		}
		peer = candidate
		if !a.trusted(peer) {
			break
		}
	}
	return peer.Unmap().String()
}

type responseStatus struct {
	http.ResponseWriter
	status int
	bytes  int
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

type requestIDKey struct{}

func (a *App) observe(next http.Handler, mux *http.ServeMux) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		started := time.Now()
		id := token()[:24]
		w.Header().Set("X-Request-ID", id)
		wrapped := &responseStatus{ResponseWriter: w}
		r = r.WithContext(context.WithValue(r.Context(), requestIDKey{}, id))
		next.ServeHTTP(wrapped, r)
		status := wrapped.status
		if status == 0 {
			status = 200
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
