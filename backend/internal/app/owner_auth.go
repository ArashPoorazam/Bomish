package app

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"net/http"
	"strings"
	"time"

	"bomish/internal/domain"
)

// Owner authenticator secrets are encrypted with a key stored outside PostgreSQL.
func (a *App) sealTOTP(secret string) (string, error) {
	if len(a.TOTPKey) != 32 {
		return "", errors.New("TOTP encryption key must be 32 bytes")
	}
	block, err := aes.NewCipher(a.TOTPKey)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err = rand.Read(nonce); err != nil {
		return "", err
	}
	return "v1:" + hex.EncodeToString(gcm.Seal(nonce, nonce, []byte(secret), []byte("bomish-owner-totp-v1"))), nil
}
func (a *App) openTOTP(stored string) (string, error) {
	if !strings.HasPrefix(stored, "v1:") {
		if a.Dev {
			return stored, nil
		}
		return "", errors.New("unencrypted owner authenticator")
	}
	block, err := aes.NewCipher(a.TOTPKey)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	raw, err := hex.DecodeString(strings.TrimPrefix(stored, "v1:"))
	if err != nil || len(raw) < gcm.NonceSize() {
		return "", errors.New("invalid authenticator ciphertext")
	}
	plain, err := gcm.Open(nil, raw[:gcm.NonceSize()], raw[gcm.NonceSize():], []byte("bomish-owner-totp-v1"))
	return string(plain), err
}
func validTOTPStep(secret, code string, last int64) int64 {
	code = domain.Normalize(code)
	if len(code) != 6 || secret == "" {
		return 0
	}
	step := time.Now().Unix() / 30
	for _, candidate := range []int64{step - 1, step, step + 1} {
		if candidate > last && subtle.ConstantTimeCompare([]byte(TOTP(secret, candidate)), []byte(code)) == 1 {
			return candidate
		}
	}
	return 0
}
func (a *App) unlockOmnisire(w http.ResponseWriter, r *http.Request) {
	s := current(r)
	if s.Role != "owner" {
		fail(w, 403, "این بخش فقط برای مالک است")
		return
	}
	var in struct {
		Code string `json:"code"`
	}
	if !decode(w, r, &in) {
		return
	}
	if !a.limit(r, "owner-totp:"+s.StaffID, 10, 15*time.Minute) || !a.limit(r, "owner-totp-ip:"+a.clientIP(r), 20, 15*time.Minute) {
		fail(w, 429, "تلاش‌های ورود زیاد است")
		return
	}
	tx, err := a.Pool.Begin(r.Context())
	if err != nil {
		a.dbError(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	var stored string
	var last int64
	err = tx.QueryRow(r.Context(), "SELECT totp_secret,last_totp_step FROM staff WHERE id=$1 AND role='owner' AND active AND archived_at IS NULL FOR UPDATE", s.StaffID).Scan(&stored, &last)
	if err != nil {
		fail(w, 403, "این حساب در دسترس نیست")
		return
	}
	secret, err := a.openTOTP(stored)
	if err != nil {
		fail(w, 503, "تنظیمات رمزساز نیاز به بررسی دارد")
		return
	}
	valid := validTOTPStep(secret, in.Code, last)
	if valid == 0 {
		_ = tx.Rollback(r.Context())
		a.logEvent(r.Context(), s.StaffID, "auth.omnisire_failed", s.StaffID, map[string]string{})
		fail(w, 401, "کد ورود معتبر نیست یا قبلاً استفاده شده است")
		return
	}
	if _, err = tx.Exec(r.Context(), "UPDATE staff SET last_totp_step=$1 WHERE id=$2", valid, s.StaffID); err == nil {
		// Rotate the session on elevation, preserving its original expiry and CSRF token.
		raw := token()
		tag, insertErr := tx.Exec(r.Context(), `INSERT INTO sessions(token_hash,csrf,staff_id,expires_at,omnisire_verified)
   SELECT $1,csrf,staff_id,expires_at,true FROM sessions WHERE token_hash=$2 AND staff_id=$3 AND expires_at>now()`, hash(raw), s.Hash, s.StaffID)
		err = insertErr
		if err == nil && tag.RowsAffected() != 1 {
			fail(w, 401, "نشست منقضی شده است")
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
			write(w, 200, map[string]bool{"ok": true})
			return
		}
	}
	a.dbError(w, err)
}

// BootstrapOwner is only called by the local CLI, never exposed through HTTP.
func (a *App) BootstrapOwner(ctx context.Context, name, username, password, secret, code string, recoverOwner bool) error {
	if len(strings.TrimSpace(name)) == 0 || len(name) > 200 || len(username) < 2 || len(username) > 80 || len(password) < 12 || len(password) > 256 || password == DemoPassword {
		return errors.New("name, username and a unique password of 12–256 characters are required")
	}
	step := validTOTPStep(secret, code, 0)
	if step == 0 {
		return errors.New("authenticator confirmation failed")
	}
	encrypted, err := a.sealTOTP(secret)
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
	id := token()
	action := "owner.bootstrap"
	if recoverOwner {
		action = "owner.recovery"
		if err = tx.QueryRow(ctx, "SELECT id FROM staff WHERE username=$1 AND role='owner' AND archived_at IS NULL FOR UPDATE", username).Scan(&id); err != nil {
			return errors.New("owner username not found")
		}
		_, err = tx.Exec(ctx, "UPDATE staff SET full_name=$2,password_hash=$3,totp_secret=$4,last_totp_step=$5,active=true WHERE id=$1", id, name, PasswordHash(password), encrypted, step)
		if err == nil {
			_, err = tx.Exec(ctx, "DELETE FROM sessions WHERE staff_id=$1", id)
		}
	} else {
		if count != 0 {
			return errors.New("an owner already exists; bootstrap refused")
		}
		_, err = tx.Exec(ctx, "INSERT INTO staff(id,username,full_name,password_hash,totp_secret,last_totp_step,role) VALUES($1,$2,$3,$4,$5,$6,'owner')", id, username, name, PasswordHash(password), encrypted, step)
	}
	if err == nil {
		err = auditDetail(ctx, tx, id, action, id, map[string]string{})
	}
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func NewOwnerSecret() string { return newTOTP() }
