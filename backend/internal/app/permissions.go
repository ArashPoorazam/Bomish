package app

import (
	"net/http"
	"slices"
	"strings"

	"bomish/internal/httpx"
)

func can(r *http.Request, permission string) bool {
	return slices.Contains(current(r).Permissions, permission)
}

func requirePermission(w http.ResponseWriter, r *http.Request, permission string) bool {
	if !can(r, permission) {
		httpx.Error(w, 403, "به این بخش یا عملیات دسترسی ندارید")
		return false
	}
	return true
}

// Route registration supplies the exact capability. HTTP methods never
// silently change the authorization policy.
func withPermission(h http.HandlerFunc, permission string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if requirePermission(w, r, permission) {
			h(w, r)
		}
	}
}
func withAnyPermission(h http.HandlerFunc, permissions ...string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		for _, p := range permissions {
			if can(r, p) {
				h(w, r)
				return
			}
		}
		httpx.Error(w, 403, "به این بخش یا عملیات دسترسی ندارید")
	}
}

// Request detail routes derive the section from the stored request, never from client input.
func (a *App) permitRequest(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		kind := r.URL.Query().Get("kind")
		if id := r.PathValue("id"); id != "" {
			if !can(r, "support") && !can(r, "custom") {
				httpx.Error(w, 403, "به این بخش دسترسی ندارید")
				return
			}
			if e := a.Pool.QueryRow(r.Context(), "SELECT kind FROM customer_requests WHERE id=$1", id).Scan(&kind); e != nil {
				httpx.Error(w, 404, "درخواست پیدا نشد")
				return
			}
		}
		if kind != "support" && kind != "custom" {
			httpx.Error(w, 400, "نوع درخواست معتبر نیست")
			return
		}
		if r.Method != "GET" && r.Method != "HEAD" && !strings.HasSuffix(r.URL.Path, "/read") {
			kind += ".edit"
		}
		if requirePermission(w, r, kind) {
			h(w, r)
		}
	}
}
