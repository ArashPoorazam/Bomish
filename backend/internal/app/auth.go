package app

import (
	"bomish/internal/domain"
	"crypto/hmac"
	"crypto/pbkdf2"
	"crypto/rand"
	"crypto/sha1"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base32"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"math/big"
	"net"
	"net/http"
	"strings"
	"time"
)

func (a *App) limit(r *http.Request, key string, max int, window time.Duration) bool {
	var n int
	e := a.Pool.QueryRow(r.Context(), `INSERT INTO rate_limits(key,hits,expires_at) VALUES($1,1,now()+$2::interval) ON CONFLICT(key) DO UPDATE SET hits=CASE WHEN rate_limits.expires_at<now() THEN 1 ELSE rate_limits.hits+1 END, expires_at=CASE WHEN rate_limits.expires_at<now() THEN excluded.expires_at ELSE rate_limits.expires_at END RETURNING hits`, key, fmt.Sprintf("%d seconds", int(window.Seconds()))).Scan(&n)
	return e == nil && n <= max
}
func ip(r *http.Request) string { v, _, _ := net.SplitHostPort(r.RemoteAddr); return v }
func (a *App) requestOTP(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Phone string `json:"phone"`
	}
	if !decode(w, r, &in) {
		return
	}
	in.Phone = domain.Phone(in.Phone)
	if !domain.ValidPhone(in.Phone) {
		fail(w, 400, "شماره همراه معتبر وارد کنید")
		return
	}
	if !a.Dev && !smsEnabled() {
		fail(w, 503, "سرویس پیامک هنوز فعال نشده است")
		return
	}
	if !a.limit(r, "sms-ip:"+ip(r), 20, time.Hour) || !a.limit(r, "sms-phone:"+in.Phone, 5, time.Hour) {
		fail(w, 429, "درخواست‌ها زیاد است؛ بعداً تلاش کنید")
		return
	}
	n, e := rand.Int(rand.Reader, big.NewInt(1000000))
	if e != nil {
		a.dbError(w, e)
		return
	}
	code := fmt.Sprintf("%06d", n.Int64())
	tag, e := a.Pool.Exec(r.Context(), `INSERT INTO otp_challenges(phone,code_hash,expires_at,sent_at) VALUES($1,$2,now()+interval '5 minutes',now()) ON CONFLICT(phone) DO UPDATE SET code_hash=excluded.code_hash,expires_at=excluded.expires_at,sent_at=now(),attempts=0 WHERE otp_challenges.sent_at<now()-interval '60 seconds'`, in.Phone, hash(in.Phone+code))
	if e != nil {
		a.dbError(w, e)
		return
	}
	if tag.RowsAffected() == 0 {
		fail(w, 429, "برای ارسال دوباره یک دقیقه صبر کنید")
		return
	}
	if smsEnabled() {
		if e := sendSMS(r.Context(), in.Phone, "", code); e != nil {
			a.Pool.Exec(r.Context(), "DELETE FROM otp_challenges WHERE phone=$1 AND code_hash=$2", in.Phone, hash(in.Phone+code))
			fail(w, 502, "ارسال پیامک انجام نشد؛ دوباره تلاش کنید")
			return
		}
		write(w, 200, map[string]any{"ok": true, "expiresIn": 300, "resendAfter": 60})
		return
	}
	write(w, 200, map[string]any{"ok": true, "devCode": code, "expiresIn": 300, "resendAfter": 60})
}
func (a *App) verifyOTP(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Phone string `json:"phone"`
		Code  string `json:"code"`
	}
	if !decode(w, r, &in) {
		return
	}
	in.Phone = domain.Phone(in.Phone)
	in.Code = domain.Normalize(in.Code)
	if !a.limit(r, "verify:"+ip(r), 40, time.Hour) {
		fail(w, 429, "تعداد تلاش‌ها بیش از حد مجاز است")
		return
	}
	tx, e := a.Pool.Begin(r.Context())
	if e != nil {
		a.dbError(w, e)
		return
	}
	defer tx.Rollback(r.Context())
	var expected string
	var until time.Time
	var attempts int
	e = tx.QueryRow(r.Context(), "SELECT code_hash,expires_at,attempts FROM otp_challenges WHERE phone=$1 FOR UPDATE", in.Phone).Scan(&expected, &until, &attempts)
	if e != nil || attempts >= 5 || time.Now().After(until) {
		fail(w, 400, "کد نامعتبر یا منقضی است")
		return
	}
	if subtle.ConstantTimeCompare([]byte(expected), []byte(hash(in.Phone+in.Code))) != 1 {
		_, e = tx.Exec(r.Context(), "UPDATE otp_challenges SET attempts=attempts+1 WHERE phone=$1", in.Phone)
		if e == nil {
			e = tx.Commit(r.Context())
		}
		if e != nil {
			a.dbError(w, e)
			return
		}
		fail(w, 400, "کد نامعتبر یا منقضی است")
		return
	}
	var uid string
	e = tx.QueryRow(r.Context(), "INSERT INTO users(id,phone) VALUES($1,$2) ON CONFLICT(phone) DO UPDATE SET phone=excluded.phone RETURNING id", token(), in.Phone).Scan(&uid)
	if e != nil {
		a.dbError(w, e)
		return
	}
	s := current(r)
	raw := token()
	newHash := hash(raw)
	_, e = tx.Exec(r.Context(), "INSERT INTO sessions(token_hash,csrf,user_id,expires_at) VALUES($1,$2,$3,now()+interval '30 days')", newHash, s.CSRF, uid)
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
		e = tx.Commit(r.Context())
	}
	if e != nil {
		a.dbError(w, e)
		return
	}
	a.cookie(w, raw)
	write(w, 200, map[string]bool{"ok": true})
}
func PasswordHash(password string) string {
	salt := token()
	key, _ := pbkdf2.Key(sha256.New, password, []byte(salt), 600000, 32)
	return salt + ":" + hex.EncodeToString(key)
}
func checkPassword(stored, password string) bool {
	v := strings.Split(stored, ":")
	if len(v) != 2 {
		return false
	}
	key, e := pbkdf2.Key(sha256.New, password, []byte(v[0]), 600000, 32)
	return e == nil && subtle.ConstantTimeCompare([]byte(hex.EncodeToString(key)), []byte(v[1])) == 1
}
func TOTP(secret string, step int64) string {
	key, e := base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(strings.ToUpper(secret))
	if e != nil {
		return ""
	}
	b := make([]byte, 8)
	binary.BigEndian.PutUint64(b, uint64(step))
	m := hmac.New(sha1.New, key)
	m.Write(b)
	sum := m.Sum(nil)
	off := sum[len(sum)-1] & 15
	v := binary.BigEndian.Uint32(sum[off:off+4]) & 0x7fffffff
	return fmt.Sprintf("%06d", v%1000000)
}
func (a *App) staffLogin(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Username string `json:"username"`
		Password string `json:"password"`
		Code     string `json:"code"`
	}
	if !decode(w, r, &in) {
		return
	}
	if !a.limit(r, "staff-ip:"+ip(r), 15, 15*time.Minute) || !a.limit(r, "staff-user:"+in.Username, 10, 15*time.Minute) {
		fail(w, 429, "تلاش‌های ورود زیاد است")
		return
	}
	var id, pw, secret string
	var last int64
	e := a.Pool.QueryRow(r.Context(), "SELECT id,password_hash,totp_secret,last_totp_step FROM staff WHERE username=$1 AND active", in.Username).Scan(&id, &pw, &secret, &last)
	if e != nil || !checkPassword(pw, in.Password) {
		fail(w, 401, "اطلاعات ورود معتبر نیست")
		return
	}
	step := time.Now().Unix() / 30
	valid := int64(0)
	for _, s := range []int64{step - 1, step, step + 1} {
		if s > last && subtle.ConstantTimeCompare([]byte(TOTP(secret, s)), []byte(domain.Normalize(in.Code))) == 1 {
			valid = s
		}
	}
	if valid == 0 {
		fail(w, 401, "کد ورود معتبر نیست یا قبلاً استفاده شده است")
		return
	}
	tx, e := a.Pool.Begin(r.Context())
	if e != nil {
		a.dbError(w, e)
		return
	}
	defer tx.Rollback(r.Context())
	tag, e := tx.Exec(r.Context(), "UPDATE staff SET last_totp_step=$1 WHERE id=$2 AND last_totp_step<$1", valid, id)
	if e != nil || tag.RowsAffected() == 0 {
		fail(w, 401, "کد ورود قبلاً استفاده شده است")
		return
	}
	raw := token()
	s := current(r)
	_, e = tx.Exec(r.Context(), "INSERT INTO sessions(token_hash,csrf,staff_id,expires_at) VALUES($1,$2,$3,now()+interval '8 hours')", hash(raw), s.CSRF, id)
	if e == nil {
		_, e = tx.Exec(r.Context(), "DELETE FROM sessions WHERE token_hash=$1", s.Hash)
	}
	if e == nil {
		e = tx.Commit(r.Context())
	}
	if e != nil {
		a.dbError(w, e)
		return
	}
	a.cookie(w, raw)
	write(w, 200, map[string]bool{"ok": true})
}
