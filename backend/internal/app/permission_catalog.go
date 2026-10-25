package app

import (
	"net/http"

	"bomish/internal/access"
	"bomish/internal/httpx"
)

func (a *App) permissionOptions(w http.ResponseWriter, r *http.Request) {
	defaults := map[string][]string{}
	for role := range access.Roles() {
		defaults[role] = access.Effective(role, nil)
	}
	sections := []access.Section{}
	for _, section := range access.Sections() {
		if !section.OwnerOnly {
			sections = append(sections, section)
		}
	}
	httpx.JSON(w, 200, map[string]any{"sections": sections, "defaults": defaults})
}
