package app

import (
	"context"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"time"

	"bomish/internal/database"
	"bomish/internal/domain"
	"bomish/internal/httpx"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

type discountCode struct {
	Code               string     `json:"code"`
	Kind               string     `json:"kind"`
	Value              int64      `json:"value"`
	MinSubtotalRials   int64      `json:"minSubtotalRials"`
	MaxDiscountRials   int64      `json:"maxDiscountRials"`
	MaxUses            int64      `json:"maxUses"`
	MaxUsesPerCustomer int64      `json:"maxUsesPerCustomer"`
	ExpiresAt          *time.Time `json:"expiresAt"`
	Active             bool       `json:"active"`
	CreatedAt          time.Time  `json:"createdAt"`
	UsedCount          int64      `json:"usedCount"`
	ReservedCount      int64      `json:"reservedCount"`
}

var codePattern = regexp.MustCompile(`^[A-Z0-9][A-Z0-9_-]{2,31}$`)

func normalizeCode(code string) string {
	return strings.ToUpper(domain.Normalize(strings.TrimSpace(code)))
}

const codeColumns = `code,kind,value,min_subtotal_rials,max_discount_rials,max_uses,max_uses_per_customer,expires_at,active,created_at`

func scanCode(row pgx.Row) (discountCode, error) {
	var v discountCode
	e := row.Scan(&v.Code, &v.Kind, &v.Value, &v.MinSubtotalRials, &v.MaxDiscountRials, &v.MaxUses, &v.MaxUsesPerCustomer, &v.ExpiresAt, &v.Active, &v.CreatedAt)
	return v, e
}
func (a *App) listDiscountCodes(w http.ResponseWriter, r *http.Request) {
	rows, e := a.Pool.Query(r.Context(), `SELECT `+codeColumns+`,
 (SELECT count(*) FROM orders o WHERE o.discount_code=d.code AND o.status IN ('paid','packing','shipped','received','review')),
 (SELECT count(*) FROM orders o WHERE o.discount_code=d.code AND o.status='pending')
 FROM discount_codes d WHERE deleted_at IS NULL ORDER BY created_at DESC`)
	if e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	defer rows.Close()
	result := []discountCode{}
	for rows.Next() {
		var v discountCode
		if e = rows.Scan(&v.Code, &v.Kind, &v.Value, &v.MinSubtotalRials, &v.MaxDiscountRials, &v.MaxUses, &v.MaxUsesPerCustomer, &v.ExpiresAt, &v.Active, &v.CreatedAt, &v.UsedCount, &v.ReservedCount); e != nil {
			httpx.DatabaseError(w, e)
			return
		}
		result = append(result, v)
	}
	if e = rows.Err(); e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	httpx.JSON(w, 200, result)
}
func (a *App) createDiscountCode(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Code               string     `json:"code"`
		Kind               string     `json:"kind"`
		Value              int64      `json:"value"`
		MinSubtotalRials   int64      `json:"minSubtotalRials"`
		MaxDiscountRials   int64      `json:"maxDiscountRials"`
		MaxUses            int64      `json:"maxUses"`
		MaxUsesPerCustomer int64      `json:"maxUsesPerCustomer"`
		ExpiresAt          *time.Time `json:"expiresAt"`
	}
	if !httpx.Decode(w, r, &in) {
		return
	}
	in.Code = normalizeCode(in.Code)
	if !codePattern.MatchString(in.Code) {
		httpx.Error(w, 400, "کد باید ۳ تا ۳۲ حرف انگلیسی، عدد، خط تیره یا زیرخط باشد")
		return
	}
	if (in.Kind != "percent" && in.Kind != "fixed") || in.Value <= 0 || in.Value > 100000000000 || (in.Kind == "percent" && in.Value > 90) || (in.Kind == "fixed" && in.Value%10 != 0) || in.MinSubtotalRials < 0 || in.MinSubtotalRials > 100000000000 || in.MinSubtotalRials%10 != 0 || in.MaxDiscountRials < 0 || in.MaxDiscountRials > 100000000000 || in.MaxDiscountRials%10 != 0 || (in.Kind == "fixed" && in.MaxDiscountRials != 0) || in.MaxUses < 0 || in.MaxUses > 1000000000 || in.MaxUsesPerCustomer < 0 || in.MaxUsesPerCustomer > 1000000000 {
		httpx.Error(w, 400, "نوع، مبلغ، سقف تخفیف و تعداد استفاده را بررسی کنید")
		return
	}
	if in.ExpiresAt != nil && !in.ExpiresAt.After(time.Now()) {
		httpx.Error(w, 400, "زمان پایان باید در آینده باشد")
		return
	}
	tx, e := a.Pool.Begin(r.Context())
	if e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	defer tx.Rollback(r.Context())
	v, e := scanCode(tx.QueryRow(r.Context(), `INSERT INTO discount_codes(code,kind,value,min_subtotal_rials,max_discount_rials,max_uses,max_uses_per_customer,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING `+codeColumns, in.Code, in.Kind, in.Value, in.MinSubtotalRials, in.MaxDiscountRials, in.MaxUses, in.MaxUsesPerCustomer, in.ExpiresAt))
	if e != nil {
		var pe *pgconn.PgError
		if errors.As(e, &pe) && pe.Code == "23505" {
			httpx.Error(w, 409, "این کد قبلاً ساخته شده است؛ کد دیگری انتخاب کنید")
			return
		}
		httpx.DatabaseError(w, e)
		return
	}
	if e = audit(r, tx, "discount.create", in.Code); e == nil {
		e = tx.Commit(r.Context())
	}
	if e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	httpx.JSON(w, 201, v)
}
func (a *App) toggleDiscountCode(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Active *bool `json:"active"`
	}
	if !httpx.Decode(w, r, &in) {
		return
	}
	if in.Active == nil {
		httpx.Error(w, 400, "وضعیت کد را مشخص کنید")
		return
	}
	tx, e := a.Pool.Begin(r.Context())
	if e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	defer tx.Rollback(r.Context())
	code := normalizeCode(r.PathValue("code"))
	result, e := tx.Exec(r.Context(), "UPDATE discount_codes SET active=$2 WHERE code=$1 AND deleted_at IS NULL", code, *in.Active)
	if e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	if result.RowsAffected() == 0 {
		httpx.Error(w, 404, "کد پیدا نشد")
		return
	}
	if e = audit(r, tx, "discount.update", code); e == nil {
		e = tx.Commit(r.Context())
	}
	if e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	httpx.JSON(w, 200, map[string]bool{"ok": true})
}

// Checkout holds this code's row lock until its order reservation is committed.
// Pending orders consume capacity; cancellation/expiry release it automatically.
func applyDiscount(ctx context.Context, q database.Querier, v *quoteResult, code, userID string, lock bool) error {
	code = normalizeCode(code)
	if code == "" {
		return nil
	}
	query := `SELECT ` + codeColumns + ` FROM discount_codes WHERE code=$1 AND deleted_at IS NULL`
	if lock {
		query += " FOR UPDATE"
	}
	d, e := scanCode(q.QueryRow(ctx, query, code))
	if errors.Is(e, pgx.ErrNoRows) {
		return errors.New("کد تخفیف معتبر نیست")
	}
	if e != nil {
		return e
	}
	if !d.Active {
		return errors.New("این کد تخفیف غیرفعال شده است")
	}
	if d.ExpiresAt != nil && !d.ExpiresAt.After(time.Now()) {
		return errors.New("مهلت استفاده از این کد تخفیف تمام شده است")
	}
	if v.SubtotalRials < d.MinSubtotalRials {
		return errors.New("مبلغ محصولات به حداقل خرید این کد تخفیف نرسیده است")
	}
	if d.MaxUses > 0 {
		var count int64
		if e = q.QueryRow(ctx, `SELECT count(*) FROM orders WHERE discount_code=$1 AND status NOT IN ('cancelled','expired')`, code).Scan(&count); e != nil {
			return e
		}
		if count >= d.MaxUses {
			return errors.New("ظرفیت استفاده از این کد تخفیف تمام شده است")
		}
	}
	if d.MaxUsesPerCustomer > 0 {
		if userID == "" {
			return errors.New("برای استفاده از این کد وارد حساب کاربری شوید")
		}
		var count int64
		if e = q.QueryRow(ctx, `SELECT count(*) FROM orders WHERE discount_code=$1 AND user_id=$2 AND status NOT IN ('cancelled','expired')`, code, userID).Scan(&count); e != nil {
			return e
		}
		if count >= d.MaxUsesPerCustomer {
			return errors.New("سقف استفاده شما از این کد تخفیف تکمیل شده است؛ سفارش‌های در انتظار پرداخت هم محاسبه می‌شوند")
		}
	}

	amount := d.Value
	if d.Kind == "percent" {
		// Round down to a whole toman. Product sale discounts are already in subtotal.
		amount = (v.SubtotalRials/1000*d.Value + v.SubtotalRials%1000*d.Value/1000) * 10
		if d.MaxDiscountRials > 0 && amount > d.MaxDiscountRials {
			amount = d.MaxDiscountRials
		}
	}
	if amount > v.SubtotalRials {
		amount = v.SubtotalRials
	}
	if amount <= 0 {
		return errors.New("این کد برای مبلغ سبد خرید قابل استفاده نیست")
	}
	v.DiscountCode = code
	v.DiscountRials = amount
	v.TotalRials = v.SubtotalRials - amount + v.ShippingRials
	return nil
}

// A payment arriving after expiry must reclaim discount capacity.
func reclaimDiscount(ctx context.Context, tx pgx.Tx, code, userID string) (bool, error) {
	if code == "" {
		return true, nil
	}
	var limit, perCustomer, count int64
	if e := tx.QueryRow(ctx, "SELECT max_uses,max_uses_per_customer FROM discount_codes WHERE code=$1 FOR UPDATE", code).Scan(&limit, &perCustomer); e != nil {
		return false, e
	}
	if limit > 0 {
		if e := tx.QueryRow(ctx, `SELECT count(*) FROM orders WHERE discount_code=$1 AND status NOT IN ('cancelled','expired')`, code).Scan(&count); e != nil {
			return false, e
		}
		if count >= limit {
			return false, nil
		}
	}
	if perCustomer > 0 {
		if e := tx.QueryRow(ctx, `SELECT count(*) FROM orders WHERE discount_code=$1 AND user_id=$2 AND status NOT IN ('cancelled','expired')`, code, userID).Scan(&count); e != nil {
			return false, e
		}
		if userID == "" || count >= perCustomer {
			return false, nil
		}
	}
	return true, nil
}

// Keep the row for historic orders and pending payment capacity checks.
func (a *App) deleteDiscountCode(w http.ResponseWriter, r *http.Request) {
	tx, e := a.Pool.Begin(r.Context())
	if e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	defer tx.Rollback(r.Context())
	code := normalizeCode(r.PathValue("code"))
	result, e := tx.Exec(r.Context(), "UPDATE discount_codes SET active=false,deleted_at=now() WHERE code=$1 AND deleted_at IS NULL", code)
	if e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	if result.RowsAffected() == 0 {
		httpx.Error(w, 404, "کد پیدا نشد")
		return
	}
	if e = audit(r, tx, "discount.delete", code); e == nil {
		e = tx.Commit(r.Context())
	}
	if e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	httpx.JSON(w, 200, map[string]bool{"ok": true})
}
