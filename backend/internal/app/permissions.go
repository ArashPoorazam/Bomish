package app

import (
	"net/http"
	"slices"
	"strings"
)

var staffSections = []string{"products", "articles", "categories", "pricing", "orders", "requests", "shipping", "sales"}

// Bare keys grant viewing; action keys never grant access to a denied section.
// Legacy restrictions remain effective until the member is edited or reset.
func effectivePermissions(role string, restrictions []string, overrides ...map[string]bool) []string {
	allowed := []string{}
	defaults, known := roleSections[role]
	if !known && role != "owner" {
		return allowed
	}
	custom := map[string]bool{}
	if len(overrides) > 0 && overrides[0] != nil {
		custom = overrides[0]
	}
	for _, section := range permissionSections {
		// Old saved overrides cannot delegate the independently protected owner workspace.
		if section.OwnerOnly && role != "owner" {
			continue
		}
		inherited := slices.Contains(defaults, section.Key)
		legacy := section.Key
		if legacy == "support" || legacy == "custom" {
			legacy = "requests"
		}
		if legacy == "home" || legacy == "packaging" {
			legacy = "products"
		}
		restricted := slices.Contains(restrictions, legacy)
		view := inherited && !restricted
		if value, ok := custom[section.Key]; ok {
			view = value
		}
		if role == "owner" {
			view = true
		}
		if !view {
			continue
		}
		allowed = append(allowed, section.Key)
		for _, action := range section.Actions {
			key := section.Key + "." + action
			enabled := inherited && !restricted
			if key == "orders.manage" {
				enabled = role == "manager" && !restricted
			}
			if value, ok := custom[key]; ok {
				enabled = value
			}
			if enabled || role == "owner" {
				allowed = append(allowed, key)
			}
		}
	}
	// Compatibility for clients that use the old combined requests capability.
	if slices.Contains(allowed, "support") || slices.Contains(allowed, "custom") {
		allowed = append(allowed, "requests")
	}
	if role == "owner" {
		allowed = append(allowed, "omnisire")
	}
	return allowed
}
func can(r *http.Request, permission string) bool {
	return slices.Contains(current(r).Permissions, permission)
}
func requirePermission(w http.ResponseWriter, r *http.Request, permission string) bool {
	if !can(r, permission) {
		fail(w, 403, "به این بخش یا عملیات دسترسی ندارید")
		return false
	}
	return true
}
func (a *App) permit(h http.HandlerFunc, permission string, action ...string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		key := permission
		if len(action) > 0 {
			if action[0] != "view" {
				key += "." + action[0]
			}
		} else if r.Method != "GET" && r.Method != "HEAD" {
			key += ".edit"
		}
		if requirePermission(w, r, key) {
			h(w, r)
		}
	}
}
func (a *App) permitAny(h http.HandlerFunc, permissions ...string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		for _, p := range permissions {
			if can(r, p) {
				h(w, r)
				return
			}
		}
		fail(w, 403, "به این بخش یا عملیات دسترسی ندارید")
	}
}

// Request detail routes derive the section from the stored request, never from client input.
func (a *App) permitRequest(h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		kind := r.URL.Query().Get("kind")
		if id := r.PathValue("id"); id != "" {
			if !can(r, "support") && !can(r, "custom") {
				fail(w, 403, "به این بخش دسترسی ندارید")
				return
			}
			if e := a.Pool.QueryRow(r.Context(), "SELECT kind FROM customer_requests WHERE id=$1", id).Scan(&kind); e != nil {
				fail(w, 404, "درخواست پیدا نشد")
				return
			}
		}
		if kind != "support" && kind != "custom" {
			fail(w, 400, "نوع درخواست معتبر نیست")
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
