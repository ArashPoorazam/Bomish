package app

import (
	"context"
	"errors"
	"github.com/jackc/pgx/v5"
	"net/http"
	"strings"
	"time"
)

// Money remains integer rials; round 7% upwards to a 10,000 rial increment.
func commission(net int64) int64 {
	if net <= 0 {
		return 0
	}
	return ((net*7 + 999999) / 1000000) * 10000
}
func (a *App) captureReferral(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Code string `json:"code"`
	}
	if !decode(w, r, &in) {
		return
	}
	s := current(r)
	if s.UserID != "" || s.StaffID != "" {
		write(w, 200, map[string]bool{"ok": true})
		return
	}
	if len(in.Code) > 100 {
		fail(w, 400, "کد معرف معتبر نیست")
		return
	}
	_, e := a.Pool.Exec(r.Context(), `UPDATE sessions SET referral_staff_id=t.id,referral_seen_at=now() FROM staff t WHERE token_hash=$1 AND t.referral_code=$2 AND t.active AND t.archived_at IS NULL`, s.Hash, in.Code)
	if e != nil {
		a.dbError(w, e)
		return
	}
	write(w, 200, map[string]bool{"ok": true})
}
func creditCommission(ctx context.Context, tx pgx.Tx, orderID, userID string, paidAt time.Time) error {
	var staffID string
	var active bool
	e := tx.QueryRow(ctx, `SELECT s.id,s.active AND s.archived_at IS NULL FROM customer_referrals r JOIN staff s ON s.id=r.staff_id WHERE r.user_id=$1 AND r.created_at<=$2 AND r.expires_at>$2 FOR UPDATE OF s`, userID, paidAt).Scan(&staffID, &active)
	if e == pgx.ErrNoRows {
		return nil
	}
	if e != nil {
		return e
	}
	if !active {
		return nil
	}
	var net int64
	if e = tx.QueryRow(ctx, "SELECT subtotal_rials-discount_rials FROM orders WHERE id=$1", orderID).Scan(&net); e != nil {
		return e
	}
	amount := commission(net)
	tag, e := tx.Exec(ctx, `INSERT INTO commission_sales(order_id,staff_id,user_id,net_rials,commission_rials,created_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(order_id) DO NOTHING`, orderID, staffID, userID, net, amount, paidAt)
	if e != nil || tag.RowsAffected() == 0 {
		return e
	}
	_, e = tx.Exec(ctx, `INSERT INTO member_ledger(id,staff_id,kind,amount_rials,order_id,idempotency_key,occurred_at) VALUES($1,$2,'commission',$3,$4,$5,$6)`, token(), staffID, amount, orderID, "commission:"+orderID, paidAt)
	if e != nil {
		return e
	}
	return auditDetail(ctx, tx, "", "commission.earned", orderID, map[string]any{"staffId": staffID, "amountRials": amount})
}
func (a *App) personalSales(w http.ResponseWriter, r *http.Request) {
	a.salesData(w, r, current(r).StaffID, false)
}
func (a *App) ownerSales(w http.ResponseWriter, r *http.Request) {
	a.salesData(w, r, r.PathValue("id"), true)
}
func (a *App) salesData(w http.ResponseWriter, r *http.Request, id string, owner bool) {
	switch r.URL.Query().Get("part") {
	case "customers":
		phone := `left(u.phone,4)||'••••'||right(u.phone,3)`
		if owner {
			phone = "u.phone"
		}
		a.paged(w, r, `SELECT u.id,`+phone+` AS phone,r.created_at AS "createdAt",r.expires_at AS "expiresAt",count(o.id) AS orders,coalesce(sum(o.subtotal_rials-o.discount_rials),0)::bigint AS "salesRials",coalesce(sum(c.commission_rials),0)::bigint AS "commissionRials" FROM customer_referrals r JOIN users u ON u.id=r.user_id LEFT JOIN orders o ON o.user_id=u.id AND o.status IN ('paid','packing','shipped','received') LEFT JOIN commission_sales c ON c.order_id=o.id AND c.staff_id=r.staff_id WHERE r.staff_id=$1 GROUP BY u.id,r.created_at,r.expires_at`, []any{id}, `r.created_at DESC,u.id`)
	case "orders":
		a.paged(w, r, `SELECT o.id,o.paid_at AS "createdAt",o.status,o.subtotal_rials-o.discount_rials AS "salesRials",coalesce(c.commission_rials,0)::bigint AS "commissionRials",coalesce(c.refunded_rials,0)::bigint AS "refundedRials",c.order_id IS NOT NULL AS eligible,(SELECT jsonb_agg(jsonb_build_object('name',i.name,'quantity',i.quantity,'packageLabel',i.package_label)) FROM order_items i WHERE i.order_id=o.id) AS items FROM customer_referrals r JOIN orders o ON o.user_id=r.user_id AND o.status IN ('paid','packing','shipped','received') LEFT JOIN commission_sales c ON c.order_id=o.id AND c.staff_id=r.staff_id WHERE r.staff_id=$1 AND ($2='' OR r.user_id=$2)`, []any{id, r.URL.Query().Get("customer")}, "o.paid_at DESC,o.id")
	case "ledger":
		a.paged(w, r, `SELECT l.id,l.kind,l.amount_rials AS "amountRials",l.order_id AS "orderId",l.transaction_number AS "transactionNumber",l.note,l.occurred_at AS "occurredAt",l.created_at AS "createdAt",l.reverses_id AS "reversesId",EXISTS(SELECT 1 FROM member_ledger x WHERE x.reverses_id=l.id) AS reversed FROM member_ledger l WHERE l.staff_id=$1`, []any{id}, "l.created_at DESC,l.id")
	default:
		v, e := queryMaps(r.Context(), a.Pool, `SELECT s.referral_code AS "referralCode",(SELECT count(*) FROM customer_referrals WHERE staff_id=s.id) AS customers,(SELECT coalesce(sum(o.subtotal_rials-o.discount_rials),0)::bigint FROM customer_referrals r JOIN orders o ON o.user_id=r.user_id AND o.status IN ('paid','packing','shipped','received') WHERE r.staff_id=s.id) AS "salesRials",coalesce(sum(l.amount_rials) FILTER(WHERE l.kind IN ('commission','commission_correction')),0)::bigint AS "earnedRials",-coalesce(sum(l.amount_rials) FILTER(WHERE l.kind IN ('payment','payment_reversal')),0)::bigint AS "paidRials",coalesce(sum(l.amount_rials),0)::bigint AS "balanceRials" FROM staff s LEFT JOIN member_ledger l ON l.staff_id=s.id WHERE s.id=$1 GROUP BY s.id`, id)
		if e != nil {
			a.dbError(w, e)
			return
		}
		if len(v) == 0 {
			fail(w, 404, "همکار پیدا نشد")
			return
		}
		v[0]["referralLink"] = a.Origin + "/?ref=" + v[0]["referralCode"].(string)
		write(w, 200, v[0])
	}
}

var errLedger = errors.New("اطلاعات تراکنش معتبر نیست، تکراری است یا مبلغ از مانده بیشتر است")

func lockLedger(ctx context.Context, tx pgx.Tx, id string) error {
	var v string
	return tx.QueryRow(ctx, "SELECT id FROM staff WHERE id=$1 FOR UPDATE", id).Scan(&v)
}
func ledgerExists(ctx context.Context, tx pgx.Tx, id, key string) (bool, error) {
	var exists bool
	e := tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM member_ledger WHERE staff_id=$1 AND idempotency_key=$2)", id, key).Scan(&exists)
	return exists, e
}
func (a *App) recordMemberPayment(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Amount      int64     `json:"amountRials"`
		Transaction string    `json:"transactionNumber"`
		OccurredAt  time.Time `json:"occurredAt"`
		Note        string    `json:"note"`
		Key         string    `json:"idempotencyKey"`
	}
	if !decode(w, r, &in) {
		return
	}
	in.Transaction = strings.TrimSpace(in.Transaction)
	if in.Amount <= 0 || in.Amount%10 != 0 || in.Amount > 100000000000000 || in.Key == "" || len(in.Key) > 100 || in.Transaction == "" || len(in.Transaction) > 100 || len(in.Note) > 1000 || in.OccurredAt.IsZero() || in.OccurredAt.After(time.Now().Add(time.Minute)) {
		fail(w, 400, errLedger.Error())
		return
	}
	tx, e := a.Pool.Begin(r.Context())
	if e != nil {
		a.dbError(w, e)
		return
	}
	defer tx.Rollback(r.Context())
	id := r.PathValue("id")
	if e = lockLedger(r.Context(), tx, id); e != nil {
		fail(w, 404, "همکار پیدا نشد")
		return
	}
	exists, e := ledgerExists(r.Context(), tx, id, in.Key)
	if e != nil {
		a.dbError(w, e)
		return
	}
	if exists {
		write(w, 200, map[string]bool{"ok": true})
		return
	}
	var balance int64
	var card string
	e = tx.QueryRow(r.Context(), "SELECT bank_card,(SELECT coalesce(sum(amount_rials),0) FROM member_ledger WHERE staff_id=$1) FROM staff WHERE id=$1", id).Scan(&card, &balance)
	if e != nil || card == "" || in.Amount > balance {
		fail(w, 409, "ابتدا کارت همکار را تکمیل کنید و مبلغ را با مانده قابل پرداخت تطبیق دهید")
		return
	}
	entry := token()
	_, e = tx.Exec(r.Context(), `INSERT INTO member_ledger(id,staff_id,kind,amount_rials,transaction_number,note,occurred_at,actor_id,idempotency_key) VALUES($1,$2,'payment',$3,$4,$5,$6,$7,$8)`, entry, id, -in.Amount, in.Transaction, in.Note, in.OccurredAt, current(r).StaffID, in.Key)
	if e == nil {
		e = auditDetail(r.Context(), tx, current(r).StaffID, "payment.recorded", id, map[string]any{"entryId": entry, "amountRials": in.Amount})
	}
	if e == nil {
		e = tx.Commit(r.Context())
	}
	if e != nil {
		fail(w, 409, errLedger.Error())
		return
	}
	write(w, 201, map[string]string{"id": entry})
}
func (a *App) reverseMemberPayment(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Reason string `json:"reason"`
		Key    string `json:"idempotencyKey"`
	}
	if !decode(w, r, &in) {
		return
	}
	if strings.TrimSpace(in.Reason) == "" || in.Key == "" || len(in.Reason) > 1000 {
		fail(w, 400, "دلیل اصلاح لازم است")
		return
	}
	tx, e := a.Pool.Begin(r.Context())
	if e != nil {
		a.dbError(w, e)
		return
	}
	defer tx.Rollback(r.Context())
	id := r.PathValue("id")
	if lockLedger(r.Context(), tx, id) != nil {
		fail(w, 404, "همکار پیدا نشد")
		return
	}
	exists, e := ledgerExists(r.Context(), tx, id, in.Key)
	if e != nil {
		a.dbError(w, e)
		return
	}
	if exists {
		write(w, 200, map[string]bool{"ok": true})
		return
	}
	tag, e := tx.Exec(r.Context(), `INSERT INTO member_ledger(id,staff_id,kind,amount_rials,reverses_id,note,actor_id,idempotency_key) SELECT $1,staff_id,'payment_reversal',-amount_rials,id,$2,$3,$4 FROM member_ledger WHERE id=$5 AND staff_id=$6 AND kind='payment'`, token(), in.Reason, current(r).StaffID, in.Key, r.PathValue("entry"), id)
	if e != nil || tag.RowsAffected() != 1 {
		fail(w, 409, "تراکنش پیدا نشد یا قبلاً اصلاح شده است")
		return
	}
	if e = auditDetail(r.Context(), tx, current(r).StaffID, "payment.reversed", id, map[string]string{"entryId": r.PathValue("entry"), "reason": in.Reason}); e == nil {
		e = tx.Commit(r.Context())
	}
	if e != nil {
		a.dbError(w, e)
		return
	}
	write(w, 200, map[string]bool{"ok": true})
}
func (a *App) refundCommission(w http.ResponseWriter, r *http.Request) {
	var in struct {
		OrderID string `json:"orderId"`
		Amount  int64  `json:"amountRials"`
		Reason  string `json:"reason"`
		Key     string `json:"idempotencyKey"`
	}
	if !decode(w, r, &in) {
		return
	}
	if in.Amount <= 0 || in.Amount%10 != 0 || in.Key == "" || strings.TrimSpace(in.Reason) == "" || len(in.Reason) > 1000 {
		fail(w, 400, "مبلغ و دلیل استرداد را وارد کنید")
		return
	}
	tx, e := a.Pool.Begin(r.Context())
	if e != nil {
		a.dbError(w, e)
		return
	}
	defer tx.Rollback(r.Context())
	id := r.PathValue("id")
	if lockLedger(r.Context(), tx, id) != nil {
		fail(w, 404, "همکار پیدا نشد")
		return
	}
	exists, e := ledgerExists(r.Context(), tx, id, in.Key)
	if e != nil {
		a.dbError(w, e)
		return
	}
	if exists {
		write(w, 200, map[string]bool{"ok": true})
		return
	}
	var net, refunded, old int64
	e = tx.QueryRow(r.Context(), "SELECT net_rials,refunded_rials,commission_rials FROM commission_sales WHERE staff_id=$1 AND order_id=$2 FOR UPDATE", id, in.OrderID).Scan(&net, &refunded, &old)
	if e != nil || in.Amount > net-refunded {
		fail(w, 409, "مبلغ از کالای قابل استرداد بیشتر است یا سفارش پیدا نشد")
		return
	}
	next := commission(net - refunded - in.Amount)
	_, e = tx.Exec(r.Context(), "UPDATE commission_sales SET refunded_rials=refunded_rials+$1,commission_rials=$2 WHERE order_id=$3", in.Amount, next, in.OrderID)
	if e == nil {
		_, e = tx.Exec(r.Context(), `INSERT INTO member_ledger(id,staff_id,kind,amount_rials,order_id,note,actor_id,idempotency_key) VALUES($1,$2,'commission_correction',$3,$4,$5,$6,$7)`, token(), id, next-old, in.OrderID, in.Reason, current(r).StaffID, in.Key)
	}
	if e == nil {
		e = auditDetail(r.Context(), tx, current(r).StaffID, "commission.refund", in.OrderID, map[string]any{"staffId": id, "refundRials": in.Amount, "adjustmentRials": next - old, "reason": in.Reason})
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
