package app

import (
	"bomish/internal/domain"
	"crypto/rand"
	"encoding/base32"
	"github.com/jackc/pgx/v5"
	"net/http"
	"slices"
	"strings"
)

type memberInput struct {
	FullName     string   `json:"fullName"`
	Username     string   `json:"username"`
	Phone        string   `json:"phone"`
	BankCard     string   `json:"bankCard"`
	Role         string   `json:"role"`
	Active       bool     `json:"active"`
	Restrictions []string `json:"restrictions"`
	Password     string   `json:"password"`
}

func (v *memberInput) validate() bool {
	v.FullName = strings.TrimSpace(v.FullName)
	v.Username = strings.TrimSpace(v.Username)
	v.Phone = domain.Phone(v.Phone)
	v.BankCard = strings.NewReplacer(" ", "", "-", "").Replace(domain.Normalize(v.BankCard))
	if v.FullName == "" || len(v.FullName) > 200 || len(v.Username) < 2 || len(v.Username) > 80 || !domain.ValidPhone(v.Phone) || len(v.BankCard) != 16 || !slices.Contains([]string{"manager", "editor", "operator", "salesperson"}, v.Role) {
		return false
	}
	for _, c := range v.BankCard {
		if c < '0' || c > '9' {
			return false
		}
	}
	for _, p := range v.Restrictions {
		if !slices.Contains(staffSections, p) {
			return false
		}
	}
	if v.Restrictions == nil {
		v.Restrictions = []string{}
	}
	return true
}
func newTOTP() string {
	b := make([]byte, 20)
	if _, e := rand.Read(b); e != nil {
		panic(e)
	}
	return base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(b)
}

const memberColumns = `s.id,s.username,s.full_name AS "fullName",s.phone,s.role,s.active,s.restrictions,s.archived_at AS "archivedAt",s.created_at AS "createdAt",s.referral_code AS "referralCode",(s.bank_card='' OR s.full_name='' OR s.phone='') AS "profileIncomplete",coalesce(l.balance,0) AS "balanceRials"`
const memberJoin = ` FROM staff s LEFT JOIN (SELECT staff_id,sum(amount_rials)::bigint balance FROM member_ledger GROUP BY staff_id) l ON l.staff_id=s.id `

func (a *App) listMembers(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	sort := `"balanceRials" DESC,s.id`
	switch q.Get("sort") {
	case "name":
		sort = "s.full_name,s.id"
	case "newest":
		sort = "s.created_at DESC,s.id"
	case "balance-asc":
		sort = `"balanceRials",s.id`
	}
	a.paged(w, r, "SELECT "+memberColumns+memberJoin+`WHERE ($1='' OR s.full_name||' '||s.username||' '||s.phone ILIKE '%'||$1||'%') AND ($2='' OR s.role=$2) AND (($3='' AND s.archived_at IS NULL) OR ($3='active' AND s.active AND s.archived_at IS NULL) OR ($3='suspended' AND NOT s.active AND s.archived_at IS NULL) OR ($3='archived' AND s.archived_at IS NOT NULL) OR $3='all') AND ($4<>'true' OR coalesce(l.balance,0)>0)`, []any{q.Get("q"), q.Get("role"), q.Get("status"), q.Get("unpaid")}, sort)
}
func (a *App) memberDetail(w http.ResponseWriter, r *http.Request) {
	items, e := queryMaps(r.Context(), a.Pool, "SELECT "+memberColumns+`,s.bank_card AS "bankCard"`+memberJoin+"WHERE s.id=$1", r.PathValue("id"))
	if e != nil {
		a.dbError(w, e)
		return
	}
	if len(items) == 0 {
		fail(w, 404, "همکار پیدا نشد")
		return
	}
	write(w, 200, items[0])
}
func (a *App) createMember(w http.ResponseWriter, r *http.Request) {
	var v memberInput
	if !decode(w, r, &v) {
		return
	}
	if !v.validate() || len(v.Password) < 12 || len(v.Password) > 256 {
		fail(w, 400, "نام، شماره همراه، کارت ۱۶ رقمی، نقش و گذرواژه حداقل ۱۲ نویسه را بررسی کنید")
		return
	}
	id, secret := token(), newTOTP()
	tx, e := a.Pool.Begin(r.Context())
	if e != nil {
		a.dbError(w, e)
		return
	}
	defer tx.Rollback(r.Context())
	_, e = tx.Exec(r.Context(), `INSERT INTO staff(id,username,password_hash,totp_secret,role,active,full_name,phone,bank_card,restrictions) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, id, v.Username, PasswordHash(v.Password), secret, v.Role, v.Active, v.FullName, v.Phone, v.BankCard, v.Restrictions)
	if e != nil {
		fail(w, 409, "نام کاربری تکراری یا اطلاعات نامعتبر است")
		return
	}
	if e = auditDetail(r.Context(), tx, current(r).StaffID, "staff.create", id, map[string]any{"role": v.Role}); e == nil {
		e = tx.Commit(r.Context())
	}
	if e != nil {
		a.dbError(w, e)
		return
	}
	write(w, 201, map[string]string{"id": id, "totpSecret": secret})
}
func lockManagedMember(r *http.Request, tx pgx.Tx, id string) error {
	var role string
	e := tx.QueryRow(r.Context(), "SELECT role FROM staff WHERE id=$1 AND archived_at IS NULL FOR UPDATE", id).Scan(&role)
	if e != nil {
		return e
	}
	if role == "owner" {
		return pgx.ErrNoRows
	}
	return nil
}
func (a *App) editMember(w http.ResponseWriter, r *http.Request) {
	var v memberInput
	if !decode(w, r, &v) {
		return
	}
	if !v.validate() {
		fail(w, 400, "اطلاعات همکار معتبر نیست")
		return
	}
	tx, e := a.Pool.Begin(r.Context())
	if e != nil {
		a.dbError(w, e)
		return
	}
	defer tx.Rollback(r.Context())
	id := r.PathValue("id")
	if lockManagedMember(r, tx, id) != nil {
		fail(w, 403, "حساب مالک یا حساب بایگانی‌شده قابل تغییر نیست")
		return
	}
	before, e := queryMaps(r.Context(), tx, `SELECT role,active,restrictions FROM staff WHERE id=$1`, id)
	if e != nil {
		a.dbError(w, e)
		return
	}
	_, e = tx.Exec(r.Context(), `UPDATE staff SET username=$2,full_name=$3,phone=$4,bank_card=$5,role=$6,active=$7,restrictions=$8 WHERE id=$1`, id, v.Username, v.FullName, v.Phone, v.BankCard, v.Role, v.Active, v.Restrictions)
	if e == nil {
		_, e = tx.Exec(r.Context(), "DELETE FROM sessions WHERE staff_id=$1", id)
	}
	if e == nil {
		e = auditDetail(r.Context(), tx, current(r).StaffID, "staff.update", id, map[string]any{"before": before[0], "after": map[string]any{"role": v.Role, "active": v.Active, "restrictions": v.Restrictions}})
	}
	if e == nil {
		e = tx.Commit(r.Context())
	}
	if e != nil {
		fail(w, 409, "ذخیره اطلاعات انجام نشد؛ نام کاربری را بررسی کنید")
		return
	}
	write(w, 200, map[string]bool{"ok": true})
}
func (a *App) archiveMember(w http.ResponseWriter, r *http.Request) {
	tx, e := a.Pool.Begin(r.Context())
	if e != nil {
		a.dbError(w, e)
		return
	}
	defer tx.Rollback(r.Context())
	id := r.PathValue("id")
	if lockManagedMember(r, tx, id) != nil {
		fail(w, 403, "حساب مالک قابل حذف نیست یا حساب قبلاً بایگانی شده است")
		return
	}
	_, e = tx.Exec(r.Context(), "UPDATE staff SET active=false,archived_at=now() WHERE id=$1", id)
	if e == nil {
		_, e = tx.Exec(r.Context(), "DELETE FROM sessions WHERE staff_id=$1", id)
	}
	if e == nil {
		e = auditDetail(r.Context(), tx, current(r).StaffID, "staff.archive", id, map[string]bool{"archived": true})
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
func (a *App) resetMemberCredentials(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Password  string `json:"password"`
		ResetTOTP bool   `json:"resetTotp"`
	}
	if !decode(w, r, &in) {
		return
	}
	if (in.Password == "" && !in.ResetTOTP) || (in.Password != "" && (len(in.Password) < 12 || len(in.Password) > 256)) {
		fail(w, 400, "گذرواژه باید حداقل ۱۲ نویسه باشد")
		return
	}
	tx, e := a.Pool.Begin(r.Context())
	if e != nil {
		a.dbError(w, e)
		return
	}
	defer tx.Rollback(r.Context())
	id := r.PathValue("id")
	if lockManagedMember(r, tx, id) != nil {
		fail(w, 403, "این حساب قابل تغییر نیست")
		return
	}
	secret := ""
	if in.Password != "" {
		_, e = tx.Exec(r.Context(), "UPDATE staff SET password_hash=$2 WHERE id=$1", id, PasswordHash(in.Password))
	}
	if e == nil && in.ResetTOTP {
		secret = newTOTP()
		_, e = tx.Exec(r.Context(), "UPDATE staff SET totp_secret=$2,last_totp_step=0 WHERE id=$1", id, secret)
	}
	if e == nil {
		_, e = tx.Exec(r.Context(), "DELETE FROM sessions WHERE staff_id=$1", id)
	}
	if e == nil {
		e = auditDetail(r.Context(), tx, current(r).StaffID, "staff.credentials", id, map[string]bool{"password": in.Password != "", "totp": in.ResetTOTP})
	}
	if e == nil {
		e = tx.Commit(r.Context())
	}
	if e != nil {
		a.dbError(w, e)
		return
	}
	write(w, 200, map[string]string{"totpSecret": secret})
}
