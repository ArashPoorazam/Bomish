package app

import (
	"net/http"
	"strings"

	"bomish/internal/httpx"
)

type session struct {
	Hash, CSRF, UserID, StaffID, Role string
	Permissions                       []string
	OmnisireVerified                  bool
}

type sessionKey struct{}

func current(r *http.Request) session { v, _ := r.Context().Value(sessionKey{}).(session); return v }

func sessionCookieName(r *http.Request) string {
	path := r.URL.Path
	if strings.HasPrefix(path, "/api/v1/staff/") || strings.HasPrefix(path, "/api/v1/omnisire/") || ((path == "/api/v1/session" || path == "/api/v1/logout") && r.URL.Query().Get("workspace") == "staff") {
		return "bomish_staff_session"
	}
	return "bomish_session"
}

func (a *App) cookie(w http.ResponseWriter, r *http.Request, value string) {
	http.SetCookie(w, &http.Cookie{Name: sessionCookieName(r), Value: value, Path: "/", HttpOnly: true, Secure: !a.Dev || strings.HasPrefix(a.Origin, "https://"), SameSite: http.SameSiteLaxMode, MaxAge: 30 * 86400})
}

func (a *App) sessionInfo(w http.ResponseWriter, r *http.Request) {
	s := current(r)
	var username, fullName string
	if s.StaffID != "" {
		if err := a.Pool.QueryRow(r.Context(), "SELECT username,full_name FROM staff WHERE id=$1", s.StaffID).Scan(&username, &fullName); err != nil {
			httpx.DatabaseError(w, err)
			return
		}
	}
	httpx.JSON(w, 200, map[string]any{"username": username, "fullName": fullName, "csrf": s.CSRF, "authenticated": s.UserID != "", "role": s.Role, "staffId": s.StaffID, "permissions": s.Permissions, "development": a.Dev, "omnisireVerified": s.Role == "owner" && s.OmnisireVerified, "catalogOnly": a.CatalogOnly})
}

func (a *App) logout(w http.ResponseWriter, r *http.Request) {
	a.logEvent(r.Context(), current(r).StaffID, "auth.logout", current(r).StaffID, map[string]string{})
	_, e := a.Pool.Exec(r.Context(), "UPDATE sessions SET user_id=NULL,staff_id=NULL,omnisire_verified=false WHERE token_hash=$1", current(r).Hash)
	if e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	httpx.JSON(w, 200, map[string]bool{"ok": true})
}

func requireCustomer(w http.ResponseWriter, r *http.Request) bool {
	if current(r).UserID == "" {
		httpx.Error(w, 401, "برای ادامه وارد حساب شوید")
		return false
	}
	return true
}
