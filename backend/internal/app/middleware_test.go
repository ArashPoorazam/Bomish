package app

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestPublicAndWebhookRequestsHaveDeadlineWithoutSession(t *testing.T) {
	for _, path := range []string{"/api/v1/health", "/api/v1/products", "/api/v1/webhooks/snapp"} {
		a := &App{} // A database call here would panic and fail the status check.
		handler := a.middleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			deadline, ok := r.Context().Deadline()
			if !ok || time.Until(deadline) > 15*time.Second {
				t.Error("missing request deadline")
			}
			w.WriteHeader(http.StatusNoContent)
		}))
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, httptest.NewRequest("GET", path, nil))
		if w.Code != http.StatusNoContent || len(w.Result().Cookies()) != 0 {
			t.Fatalf("%s: %d", path, w.Code)
		}
	}
}
