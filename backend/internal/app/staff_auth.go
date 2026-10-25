package app

import (
	"net/http"
	"time"

	"bomish/internal/httpx"
	"bomish/internal/security"
)

func (a *App) staffLogin(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if !httpx.Decode(w, r, &in) {
		return
	}
	if !a.limit(r, "staff-ip:"+httpx.ClientIP(r, a.TrustedProxies), 15, 15*time.Minute) || !a.limit(r, "staff-user:"+in.Username, 10, 15*time.Minute) {
		httpx.Error(w, 429, "تلاش‌های ورود زیاد است")
		return
	}
	var id, pw string
	e := a.Pool.QueryRow(r.Context(), "SELECT id,password_hash FROM staff WHERE username=$1 AND active AND archived_at IS NULL", in.Username).Scan(&id, &pw)
	if e != nil || !security.CheckPassword(pw, in.Password) {
		a.logEvent(r.Context(), "", "auth.failed", "staff", map[string]string{})
		httpx.Error(w, 401, "اطلاعات ورود معتبر نیست")
		return
	}
	tx, e := a.Pool.Begin(r.Context())
	if e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	defer tx.Rollback(r.Context())
	// Serialize with suspension/credential changes before creating the session.
	var lockedID string
	if e = tx.QueryRow(r.Context(), "SELECT id FROM staff WHERE id=$1 AND password_hash=$2 AND active AND archived_at IS NULL FOR UPDATE", id, pw).Scan(&lockedID); e != nil {
		httpx.Error(w, 401, "اطلاعات ورود معتبر نیست")
		return
	}
	raw := security.Token()
	s := current(r)
	_, e = tx.Exec(r.Context(), "INSERT INTO sessions(token_hash,csrf,staff_id,expires_at) VALUES($1,$2,$3,now()+interval '8 hours')", security.Hash(raw), s.CSRF, id)
	if e == nil {
		_, e = tx.Exec(r.Context(), "DELETE FROM sessions WHERE token_hash=$1", s.Hash)
	}
	if e == nil {
		e = auditDetail(r.Context(), tx, id, "auth.login", id, map[string]string{})
	}
	if e == nil {
		e = tx.Commit(r.Context())
	}
	if e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	a.cookie(w, r, raw)
	httpx.JSON(w, 200, map[string]bool{"ok": true})
}
