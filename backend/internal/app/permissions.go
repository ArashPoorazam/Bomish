package app

import (
	"net/http"
	"slices"
)

var staffSections = []string{"products", "articles", "categories", "pricing", "orders", "requests", "shipping", "sales"}

func effectivePermissions(role string, restrictions []string) []string {
	var allowed []string
	switch role {
	case "owner", "manager":
		allowed = append([]string{}, staffSections...)
	case "editor":
		allowed = []string{"products", "articles", "categories", "pricing", "sales"}
	case "operator":
		allowed = []string{"orders", "requests", "sales"}
	case "salesperson":
		allowed = []string{"sales"}
	default:
		return []string{}
	}
	if role == "owner" {
		return append(allowed, "omnisire")
	}
	return slices.DeleteFunc(allowed, func(p string) bool { return slices.Contains(restrictions, p) })
}
func can(r *http.Request, permission string) bool {
	return slices.Contains(current(r).Permissions, permission)
}
func (a *App) permit(h http.HandlerFunc, permission string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !can(r, permission) {
			fail(w, 403, "به این بخش دسترسی ندارید")
			return
		}
		h(w, r)
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
		fail(w, 403, "به این بخش دسترسی ندارید")
	}
}
