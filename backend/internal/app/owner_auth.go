package app

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"bomish/internal/domain"
	"bomish/internal/httpx"
	"bomish/internal/security"
)

func (a *App) unlockOmnisire(w http.ResponseWriter, r *http.Request) {
	s := current(r)
	if s.Role != "owner" {
		httpx.Error(w, 403, "این بخش فقط برای مالک است")
		return
	}
	var in struct {
		Code string `json:"code"`
	}
	if !httpx.Decode(w, r, &in) {
		return
	}
	if !a.limit(r, "owner-totp:"+s.StaffID, 10, 15*time.Minute) || !a.limit(r, "owner-totp-ip:"+httpx.ClientIP(r, a.TrustedProxies), 20, 15*time.Minute) {
		httpx.Error(w, 429, "تلاش‌های ورود زیاد است")
		return
	}
	tx, err := a.Pool.Begin(r.Context())
	if err != nil {
		httpx.DatabaseError(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	var stored string
	var last int64
	err = tx.QueryRow(r.Context(), "SELECT totp_secret,last_totp_step FROM staff WHERE id=$1 AND role='owner' AND active AND archived_at IS NULL FOR UPDATE", s.StaffID).Scan(&stored, &last)
	if err != nil {
		httpx.Error(w, 403, "این حساب در دسترس نیست")
		return
	}
	secret, err := security.OpenTOTP(a.TOTPKey, a.Dev, stored)
	if err != nil {
		httpx.Error(w, 503, "تنظیمات رمزساز نیاز به بررسی دارد")
		return
	}
	valid := security.ValidTOTPStep(secret, domain.Normalize(in.Code), last, time.Now())
	if valid == 0 {
		_ = tx.Rollback(r.Context())
		a.logEvent(r.Context(), s.StaffID, "auth.omnisire_failed", s.StaffID, map[string]string{})
		httpx.Error(w, 401, "کد ورود معتبر نیست یا قبلاً استفاده شده است")
		return
	}
	if _, err = tx.Exec(r.Context(), "UPDATE staff SET last_totp_step=$1 WHERE id=$2", valid, s.StaffID); err == nil {
		// Rotate the session on elevation, preserving its original expiry and CSRF token.
		raw := security.Token()
		tag, insertErr := tx.Exec(r.Context(), `INSERT INTO sessions(token_hash,csrf,staff_id,expires_at,omnisire_verified)
   SELECT $1,csrf,staff_id,expires_at,true FROM sessions WHERE token_hash=$2 AND staff_id=$3 AND expires_at>now()`, security.Hash(raw), s.Hash, s.StaffID)
		err = insertErr
		if err == nil && tag.RowsAffected() != 1 {
			httpx.Error(w, 401, "نشست منقضی شده است")
			return
		}
		if err == nil {
			_, err = tx.Exec(r.Context(), "DELETE FROM sessions WHERE token_hash=$1", s.Hash)
		}
		if err == nil {
			err = auditDetail(r.Context(), tx, s.StaffID, "auth.omnisire_unlock", s.StaffID, map[string]string{})
		}
		if err == nil {
			err = tx.Commit(r.Context())
		}
		if err == nil {
			a.cookie(w, r, raw)
			httpx.JSON(w, 200, map[string]bool{"ok": true})
			return
		}
	}
	httpx.DatabaseError(w, err)
}

// BootstrapOwner is only called by the local CLI, never exposed through HTTP.
func (a *App) BootstrapOwner(ctx context.Context, name, username, password, secret, code string, recoverOwner bool) error {
	if len(strings.TrimSpace(name)) == 0 || len(name) > 200 || len(username) < 2 || len(username) > 80 || len(password) < 12 || len(password) > 256 || password == DemoPassword {
		return errors.New("name, username and a unique password of 12–256 characters are required")
	}
	step := security.ValidTOTPStep(secret, domain.Normalize(code), 0, time.Now())
	if step == 0 {
		return errors.New("authenticator confirmation failed")
	}
	encrypted, err := security.SealTOTP(a.TOTPKey, secret)
	if err != nil {
		return err
	}
	tx, err := a.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(7234111)"); err != nil {
		return err
	}
	var count int
	if err = tx.QueryRow(ctx, "SELECT count(*) FROM staff WHERE role='owner'").Scan(&count); err != nil {
		return err
	}
	id := security.Token()
	action := "owner.bootstrap"
	if recoverOwner {
		action = "owner.recovery"
		if err = tx.QueryRow(ctx, "SELECT id FROM staff WHERE username=$1 AND role='owner' AND archived_at IS NULL FOR UPDATE", username).Scan(&id); err != nil {
			return errors.New("owner username not found")
		}
		_, err = tx.Exec(ctx, "UPDATE staff SET full_name=$2,password_hash=$3,totp_secret=$4,last_totp_step=$5,active=true WHERE id=$1", id, name, security.PasswordHash(password), encrypted, step)
		if err == nil {
			_, err = tx.Exec(ctx, "DELETE FROM sessions WHERE staff_id=$1", id)
		}
	} else {
		if count != 0 {
			return errors.New("an owner already exists; bootstrap refused")
		}
		_, err = tx.Exec(ctx, "INSERT INTO staff(id,username,full_name,password_hash,totp_secret,last_totp_step,role) VALUES($1,$2,$3,$4,$5,$6,'owner')", id, username, name, security.PasswordHash(password), encrypted, step)
	}
	if err == nil {
		err = auditDetail(ctx, tx, id, action, id, map[string]string{})
	}
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}
