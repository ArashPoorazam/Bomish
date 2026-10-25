package app

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"fmt"
	"math/big"
	"net/http"
	"time"

	"bomish/internal/domain"
	"bomish/internal/httpx"
	"bomish/internal/security"

	"github.com/jackc/pgx/v5"
)

func (a *App) requestOTP(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Phone string `json:"phone"`
	}
	if !httpx.Decode(w, r, &in) {
		return
	}
	in.Phone = domain.Phone(in.Phone)
	if !domain.ValidPhone(in.Phone) {
		httpx.Error(w, 400, "شماره همراه معتبر وارد کنید")
		return
	}
	if !a.Dev && !smsEnabled() {
		httpx.Error(w, 503, "سرویس پیامک هنوز فعال نشده است")
		return
	}
	if !a.limit(r, "sms-ip:"+httpx.ClientIP(r, a.TrustedProxies), 20, time.Hour) || !a.limit(r, "sms-phone:"+in.Phone, 5, time.Hour) {
		httpx.Error(w, 429, "درخواست‌ها زیاد است؛ بعداً تلاش کنید")
		return
	}
	n, e := rand.Int(rand.Reader, big.NewInt(1000000))
	if e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	code := fmt.Sprintf("%06d", n.Int64())
	tag, e := a.Pool.Exec(r.Context(), `INSERT INTO otp_challenges(phone,code_hash,expires_at,sent_at) VALUES($1,$2,now()+interval '5 minutes',now()) ON CONFLICT(phone) DO UPDATE SET code_hash=excluded.code_hash,expires_at=excluded.expires_at,sent_at=now(),attempts=0 WHERE otp_challenges.sent_at<now()-interval '60 seconds'`, in.Phone, security.Hash(in.Phone+code))
	if e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	if tag.RowsAffected() == 0 {
		httpx.Error(w, 429, "برای ارسال دوباره یک دقیقه صبر کنید")
		return
	}
	if smsEnabled() {
		if e := a.sendLoginSMS(r.Context(), in.Phone, code); e != nil {
			cleanupCtx, cancel := context.WithTimeout(context.WithoutCancel(r.Context()), 5*time.Second)
			a.Pool.Exec(cleanupCtx, "DELETE FROM otp_challenges WHERE phone=$1 AND code_hash=$2", in.Phone, security.Hash(in.Phone+code))
			cancel()
			httpx.Error(w, 502, "ارسال پیامک انجام نشد؛ دوباره تلاش کنید")
			return
		}
		httpx.JSON(w, 200, map[string]any{"ok": true, "expiresIn": 300, "resendAfter": 60})
		return
	}
	httpx.JSON(w, 200, map[string]any{"ok": true, "devCode": code, "expiresIn": 300, "resendAfter": 60})
}

func (a *App) verifyOTP(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Phone string `json:"phone"`
		Code  string `json:"code"`
	}
	if !httpx.Decode(w, r, &in) {
		return
	}
	in.Phone = domain.Phone(in.Phone)
	in.Code = domain.Normalize(in.Code)
	if !a.limit(r, "verify:"+httpx.ClientIP(r, a.TrustedProxies), 40, time.Hour) {
		httpx.Error(w, 429, "تعداد تلاش‌ها بیش از حد مجاز است")
		return
	}
	tx, e := a.Pool.Begin(r.Context())
	if e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	defer tx.Rollback(r.Context())
	var expected string
	var until time.Time
	var attempts int
	e = tx.QueryRow(r.Context(), "SELECT code_hash,expires_at,attempts FROM otp_challenges WHERE phone=$1 FOR UPDATE", in.Phone).Scan(&expected, &until, &attempts)
	if e != nil || attempts >= 5 || time.Now().After(until) {
		httpx.Error(w, 400, "کد نامعتبر یا منقضی است")
		return
	}
	if subtle.ConstantTimeCompare([]byte(expected), []byte(security.Hash(in.Phone+in.Code))) != 1 {
		_, e = tx.Exec(r.Context(), "UPDATE otp_challenges SET attempts=attempts+1 WHERE phone=$1", in.Phone)
		if e == nil {
			e = tx.Commit(r.Context())
		}
		if e != nil {
			httpx.DatabaseError(w, e)
			return
		}
		httpx.Error(w, 400, "کد نامعتبر یا منقضی است")
		return
	}
	var uid string
	candidate := security.Token()
	e = tx.QueryRow(r.Context(), "INSERT INTO users(id,phone) VALUES($1,$2) ON CONFLICT(phone) DO UPDATE SET phone=excluded.phone RETURNING id", candidate, in.Phone).Scan(&uid)
	if e == nil && uid == candidate {
		var ref string
		err := tx.QueryRow(r.Context(), `SELECT t.id FROM sessions s JOIN staff t ON t.id=s.referral_staff_id WHERE s.token_hash=$1 AND s.referral_seen_at>now()-interval '720 hours' AND t.active AND t.archived_at IS NULL FOR SHARE OF t`, current(r).Hash).Scan(&ref)
		if err == nil {
			_, e = tx.Exec(r.Context(), "INSERT INTO customer_referrals(user_id,staff_id) VALUES($1,$2)", uid, ref)
			if e == nil {
				e = auditDetail(r.Context(), tx, "", "referral.signup", uid, map[string]string{"staffId": ref})
			}
		} else if err != pgx.ErrNoRows {
			e = err
		}
	}
	if e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	s := current(r)
	raw := security.Token()
	newHash := security.Hash(raw)
	_, e = tx.Exec(r.Context(), "INSERT INTO sessions(token_hash,csrf,user_id,expires_at) VALUES($1,$2,$3,now()+interval '720 hours')", newHash, s.CSRF, uid)
	if e == nil {
		_, e = tx.Exec(r.Context(), "UPDATE carts SET session_hash=$1 WHERE session_hash=$2", newHash, s.Hash)
	}
	if e == nil {
		_, e = tx.Exec(r.Context(), "DELETE FROM sessions WHERE token_hash=$1", s.Hash)
	}
	if e == nil {
		_, e = tx.Exec(r.Context(), "DELETE FROM otp_challenges WHERE phone=$1", in.Phone)
	}
	if e == nil {
		e = auditDetail(r.Context(), tx, "", "auth.customer_login", uid, map[string]bool{"newAccount": uid == candidate})
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
