package app

import (
	"net/http"
	"time"
)

func (a *App) changeStaffPassword(w http.ResponseWriter, r *http.Request) {
	s := current(r)
	if s.StaffID == "" {
		fail(w, 401, "ابتدا وارد حساب همکار شوید")
		return
	}
	if !a.limit(r, "staff-password:"+s.StaffID, 10, time.Hour) {
		fail(w, 429, "تعداد تلاش‌ها بیش از حد مجاز است")
		return
	}
	var in struct {
		Current string `json:"currentPassword"`
		New     string `json:"newPassword"`
	}
	if !decode(w, r, &in) {
		return
	}
	if len(in.Current) > 256 || len(in.New) < 12 || len(in.New) > 256 {
		fail(w, 400, "گذرواژه جدید باید بین ۱۲ تا ۲۵۶ نویسه باشد")
		return
	}
	tx, err := a.Pool.Begin(r.Context())
	if err != nil {
		a.dbError(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	var stored string
	err = tx.QueryRow(r.Context(), "SELECT password_hash FROM staff WHERE id=$1 AND active AND archived_at IS NULL FOR UPDATE", s.StaffID).Scan(&stored)
	if err != nil {
		a.dbError(w, err)
		return
	}
	if !checkPassword(stored, in.Current) {
		fail(w, 400, "گذرواژه فعلی نادرست است")
		return
	}
	if in.Current == in.New {
		fail(w, 400, "گذرواژه جدید باید با گذرواژه فعلی متفاوت باشد")
		return
	}
	_, err = tx.Exec(r.Context(), "UPDATE staff SET password_hash=$2 WHERE id=$1", s.StaffID, PasswordHash(in.New))
	if err == nil {
		_, err = tx.Exec(r.Context(), "DELETE FROM sessions WHERE staff_id=$1 AND token_hash<>$2", s.StaffID, s.Hash)
	}
	if err == nil {
		err = auditDetail(r.Context(), tx, s.StaffID, "staff.password_changed", s.StaffID, map[string]bool{"password": true})
	}
	if err == nil {
		err = tx.Commit(r.Context())
	}
	if err != nil {
		a.dbError(w, err)
		return
	}
	write(w, 200, map[string]bool{"ok": true})
}
