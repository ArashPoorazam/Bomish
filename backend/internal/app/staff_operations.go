package app

import (
	"bomish/internal/domain"
	"crypto/rand"
	"encoding/base32"
	"fmt"
	"io"
	"net/http"
	"strings"
)

func (a *App) staffOrders(w http.ResponseWriter, r *http.Request) {
	v, e := loadOrders(r.Context(), a.Pool, "")
	if e != nil {
		a.dbError(w, e)
		return
	}
	write(w, 200, v)
}
func (a *App) updateOrder(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Status   string `json:"status"`
		Tracking string `json:"tracking"`
	}
	if !decode(w, r, &in) {
		return
	}
	if in.Status != "packing" && in.Status != "shipped" && in.Status != "received" {
		fail(w, 400, "وضعیت مجاز نیست")
		return
	}
	in.Tracking = domain.Normalize(strings.TrimSpace(in.Tracking))
	if in.Status == "shipped" && !validTracking(in.Tracking) {
		fail(w, 400, "کد رهگیری لازم است")
		return
	}
	tx, e := a.Pool.Begin(r.Context())
	if e != nil {
		a.dbError(w, e)
		return
	}
	defer tx.Rollback(r.Context())
	previous := "paid"
	if in.Status == "shipped" {
		previous = "packing"
	}
	if in.Status == "received" {
		previous = "shipped"
	}
	tag, e := tx.Exec(r.Context(), "UPDATE orders SET status=$1,tracking=CASE WHEN $1='shipped' THEN $2 ELSE tracking END WHERE id=$3 AND status=$4", in.Status, in.Tracking, r.PathValue("id"), previous)
	if e != nil || tag.RowsAffected() == 0 {
		fail(w, 409, "تغییر وضعیت سفارش مجاز نیست")
		return
	}
	if e = queueOrderSMS(r.Context(), tx, r.PathValue("id"), in.Status); e != nil {
		a.dbError(w, e)
		return
	}
	if e = audit(r, tx, "order."+in.Status, r.PathValue("id")); e == nil {
		e = tx.Commit(r.Context())
	}
	if e != nil {
		a.dbError(w, e)
		return
	}
	write(w, 200, map[string]bool{"ok": true})
}

type shippingRule struct {
	ID       string `json:"id"`
	Province string `json:"province"`
	MaxGrams int64  `json:"maxGrams"`
	FeeRials int64  `json:"feeRials"`
}
type shippingConfig struct {
	FreeShippingRials int64          `json:"freeShippingRials"`
	SupportURL        string         `json:"supportUrl"`
	PackagingGrams    int64          `json:"packagingGrams"`
	Rules             []shippingRule `json:"rules"`
}

func (a *App) shippingSettings(w http.ResponseWriter, r *http.Request) {
	v := shippingConfig{Rules: []shippingRule{}}
	e := a.Pool.QueryRow(r.Context(), "SELECT packaging_grams,free_shipping_rials,support_url FROM settings WHERE id=true").Scan(&v.PackagingGrams, &v.FreeShippingRials, &v.SupportURL)
	if e != nil {
		a.dbError(w, e)
		return
	}
	rows, e := a.Pool.Query(r.Context(), "SELECT id,province,max_grams,fee_rials FROM shipping_rules ORDER BY province,max_grams")
	if e != nil {
		a.dbError(w, e)
		return
	}
	defer rows.Close()
	for rows.Next() {
		var x shippingRule
		if e = rows.Scan(&x.ID, &x.Province, &x.MaxGrams, &x.FeeRials); e != nil {
			a.dbError(w, e)
			return
		}
		v.Rules = append(v.Rules, x)
	}
	write(w, 200, v)
}
func (a *App) saveShipping(w http.ResponseWriter, r *http.Request) {
	var v shippingConfig
	if !decode(w, r, &v) {
		return
	}
	if v.FreeShippingRials < 0 || v.FreeShippingRials > 100000000000 || !validSupportURL(v.SupportURL) || v.PackagingGrams < 0 || v.PackagingGrams > 10000 || len(v.Rules) > 500 {
		fail(w, 400, "تنظیمات ارسال معتبر نیست")
		return
	}
	seen := map[string]bool{}
	for i := range v.Rules {
		x := &v.Rules[i]
		key := fmt.Sprintf("%s/%d", x.Province, x.MaxGrams)
		if seen[key] || x.Province == "" || x.MaxGrams < 1 || x.MaxGrams > 10000000 || x.FeeRials < 0 || x.FeeRials > 10000000000 {
			fail(w, 400, "بازه‌ها و هزینه‌ها را بررسی کنید")
			return
		}
		seen[key] = true
		x.ID = token()
	}
	tx, e := a.Pool.Begin(r.Context())
	if e != nil {
		a.dbError(w, e)
		return
	}
	defer tx.Rollback(r.Context())
	_, e = tx.Exec(r.Context(), "DELETE FROM shipping_rules")
	if e == nil {
		_, e = tx.Exec(r.Context(), "UPDATE settings SET packaging_grams=$1,free_shipping_rials=$2,support_url=$3 WHERE id=true", v.PackagingGrams, v.FreeShippingRials, v.SupportURL)
	}
	for _, x := range v.Rules {
		if e == nil {
			_, e = tx.Exec(r.Context(), "INSERT INTO shipping_rules(id,province,max_grams,fee_rials) VALUES($1,$2,$3,$4)", x.ID, x.Province, x.MaxGrams, x.FeeRials)
		}
	}
	if e == nil {
		e = audit(r, tx, "shipping.update", "settings")
	}
	if e == nil {
		e = tx.Commit(r.Context())
	}
	if e != nil {
		a.dbError(w, e)
		return
	}
	write(w, 200, map[string]bool{"ok": true})
}
func (a *App) members(w http.ResponseWriter, r *http.Request) {
	rows, e := a.Pool.Query(r.Context(), "SELECT id,username,role,active FROM staff ORDER BY username")
	if e != nil {
		a.dbError(w, e)
		return
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var id, user, role string
		var active bool
		if e = rows.Scan(&id, &user, &role, &active); e != nil {
			a.dbError(w, e)
			return
		}
		out = append(out, map[string]any{"id": id, "username": user, "role": role, "active": active})
	}
	write(w, 200, out)
}
func (a *App) saveMember(w http.ResponseWriter, r *http.Request) {
	var in struct {
		ID       string `json:"id"`
		Username string `json:"username"`
		Password string `json:"password"`
		Role     string `json:"role"`
		Active   bool   `json:"active"`
	}
	if !decode(w, r, &in) {
		return
	}
	if in.Role != "owner" && in.Role != "editor" && in.Role != "operator" {
		fail(w, 400, "نقش معتبر نیست")
		return
	}
	if in.ID == current(r).StaffID {
		fail(w, 400, "حساب فعال خود را تغییر ندهید")
		return
	}
	if in.Username == "" {
		fail(w, 400, "نام کاربری لازم است")
		return
	}
	fresh := in.ID == ""
	if fresh && len(in.Password) < 12 {
		fail(w, 400, "گذرواژه باید حداقل ۱۲ نویسه باشد")
		return
	}
	if !fresh && in.Password != "" {
		fail(w, 400, "برای تغییر گذرواژه از فرایند بازیابی مالک استفاده کنید")
		return
	}
	tx, e := a.Pool.Begin(r.Context())
	if e != nil {
		a.dbError(w, e)
		return
	}
	defer tx.Rollback(r.Context())
	secret := ""
	if fresh {
		in.ID = token()
		b := make([]byte, 20)
		_, _ = rand.Read(b)
		secret = base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(b)
		_, e = tx.Exec(r.Context(), "INSERT INTO staff(id,username,password_hash,totp_secret,role,active) VALUES($1,$2,$3,$4,$5,$6)", in.ID, in.Username, PasswordHash(in.Password), secret, in.Role, in.Active)
	} else {
		_, e = tx.Exec(r.Context(), "UPDATE staff SET role=$1,active=$2 WHERE id=$3", in.Role, in.Active, in.ID)
		if e == nil {
			_, e = tx.Exec(r.Context(), "DELETE FROM sessions WHERE staff_id=$1", in.ID)
		}
	}
	if e == nil {
		e = audit(r, tx, "staff.update", in.ID)
	}
	if e == nil {
		e = tx.Commit(r.Context())
	}
	if e != nil {
		a.dbError(w, e)
		return
	}
	write(w, 200, map[string]string{"id": in.ID, "totpSecret": secret})
}
func (a *App) auditEvents(w http.ResponseWriter, r *http.Request) {
	rows, e := a.Pool.Query(r.Context(), "SELECT a.action,a.entity_id,a.created_at::text,s.username FROM audit_events a LEFT JOIN staff s ON s.id=a.staff_id ORDER BY a.id DESC LIMIT 100")
	if e != nil {
		a.dbError(w, e)
		return
	}
	defer rows.Close()
	out := []map[string]string{}
	for rows.Next() {
		var action, id, date, user string
		if e = rows.Scan(&action, &id, &date, &user); e != nil {
			a.dbError(w, e)
			return
		}
		out = append(out, map[string]string{"action": action, "entityId": id, "createdAt": date, "username": user})
	}
	write(w, 200, out)
}
func (a *App) upload(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 8<<20)
	if e := r.ParseMultipartForm(8 << 20); e != nil {
		fail(w, 400, "حجم تصویر باید کمتر از ۸ مگابایت باشد")
		return
	}
	defer r.MultipartForm.RemoveAll()
	file, _, e := r.FormFile("image")
	if e != nil {
		fail(w, 400, "تصویر انتخاب نشده است")
		return
	}
	defer file.Close()
	data, e := io.ReadAll(file)
	if e != nil {
		fail(w, 400, "تصویر قابل خواندن نیست")
		return
	}
	mime := http.DetectContentType(data)
	ext := ""
	switch mime {
	case "image/jpeg":
		ext = ".jpg"
	case "image/png":
		ext = ".png"
	case "image/webp":
		ext = ".webp"
	default:
		fail(w, 400, "فقط تصویر JPEG، PNG یا WebP پذیرفته می‌شود")
		return
	}
	url, e := a.Uploads.Put(r.Context(), token()+ext, data, mime)
	if e != nil {
		a.dbError(w, e)
		return
	}
	if !domain.ValidImage(url) {
		fail(w, 500, "نشانی تصویر معتبر نیست")
		return
	}
	write(w, 201, map[string]string{"url": url})
}
