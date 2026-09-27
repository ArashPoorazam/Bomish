package app

import (
	"bomish/internal/domain"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/jackc/pgx/v5"
	"net/http"
	"time"
)

type quoteResult struct {
	DiscountCode  string `json:"discountCode"`
	DiscountRials int64  `json:"discountRials"`
	SubtotalRials int64  `json:"subtotalRials"`
	ShippingRials int64  `json:"shippingRials"`
	TotalRials    int64  `json:"totalRials"`
	WeightGrams   int64  `json:"weightGrams"`
}

func calculateQuote(ctx context.Context, q querier, c domain.Cart, province string) (quoteResult, error) {
	v := quoteResult{SubtotalRials: c.SubtotalRials}
	if len(c.Items) == 0 {
		return v, errors.New("سبد خرید خالی است")
	}
	totals := map[string]int64{}
	for _, item := range c.Items {
		totals[item.Product.ID] += item.Grams
		if item.Quantity < 1 || item.Quantity > item.Package.MaxQuantity || item.Grams <= 0 || item.Product.Status != "published" || item.Product.AvailableGrams < totals[item.Product.ID] {
			return v, errUnavailable
		}
		v.WeightGrams += item.Grams
	}
	var packaging, threshold int64
	e := q.QueryRow(ctx, "SELECT packaging_grams,free_shipping_rials FROM settings WHERE id=true").Scan(&packaging, &threshold)
	if e != nil {
		return v, e
	}
	v.WeightGrams += packaging
	e = q.QueryRow(ctx, "SELECT fee_rials FROM shipping_rules WHERE province=$1 AND max_grams >= $2 ORDER BY max_grams LIMIT 1", province, v.WeightGrams).Scan(&v.ShippingRials)
	if e != nil {
		return v, errors.New("برای این استان یا وزن، روش ارسال تعریف نشده است")
	}
	if threshold > 0 && v.SubtotalRials >= threshold {
		v.ShippingRials = 0
	}
	v.TotalRials = v.SubtotalRials + v.ShippingRials
	return v, nil
}
func (a *App) quote(w http.ResponseWriter, r *http.Request) {
	if !requireCustomer(w, r) {
		return
	}
	var in struct {
		Province     string `json:"province"`
		DiscountCode string `json:"discountCode"`
	}
	if !decode(w, r, &in) {
		return
	}
	c, e := loadCart(r.Context(), a.Pool, current(r).Hash)
	if e != nil {
		a.dbError(w, e)
		return
	}
	v, e := calculateQuote(r.Context(), a.Pool, c, in.Province)
	if e == nil {
		e = applyDiscount(r.Context(), a.Pool, &v, in.DiscountCode, false)
	}
	if e != nil {
		fail(w, 400, e.Error())
		return
	}
	write(w, 200, v)
}
func (a *App) checkout(w http.ResponseWriter, r *http.Request) {
	if !requireCustomer(w, r) {
		return
	}
	var in struct {
		Address            domain.Address `json:"address"`
		DiscountCode       string         `json:"discountCode"`
		ExpectedTotalRials int64          `json:"expectedTotalRials"`
		IdempotencyKey     string         `json:"idempotencyKey"`
	}
	if !decode(w, r, &in) {
		return
	}
	in.Address.Phone = domain.Phone(in.Address.Phone)
	in.Address.PostalCode = domain.Normalize(in.Address.PostalCode)
	if e := in.Address.Validate(); e != nil {
		fail(w, 400, e.Error())
		return
	}
	if len(in.IdempotencyKey) < 16 || len(in.IdempotencyKey) > 100 {
		fail(w, 400, "شناسه درخواست معتبر نیست")
		return
	}
	tx, e := a.Pool.Begin(r.Context())
	if e != nil {
		a.dbError(w, e)
		return
	}
	defer tx.Rollback(r.Context())
	s := current(r)
	// Serialize checkout requests for this user, including retries from different tabs.
	_, e = tx.Exec(r.Context(), "SELECT id FROM users WHERE id=$1 FOR UPDATE", s.UserID)
	if e != nil {
		a.dbError(w, e)
		return
	}
	var existing string
	e = tx.QueryRow(r.Context(), "SELECT id FROM orders WHERE user_id=$1 AND idempotency_key=$2", s.UserID, in.IdempotencyKey).Scan(&existing)
	if e == nil {
		write(w, 200, map[string]string{"orderId": existing})
		return
	}
	if !errors.Is(e, pgx.ErrNoRows) {
		a.dbError(w, e)
		return
	}
	// Coordinate with cart mutations so the purchased snapshot cannot change while locking stock.
	_, e = tx.Exec(r.Context(), "SELECT token_hash FROM sessions WHERE token_hash=$1 FOR UPDATE", s.Hash)
	if e != nil {
		a.dbError(w, e)
		return
	}
	c, e := loadCart(r.Context(), tx, s.Hash)
	if e != nil {
		a.dbError(w, e)
		return
	}
	for _, item := range c.Items {
		_, e = tx.Exec(r.Context(), "SELECT p.id FROM products p JOIN inventory i ON p.id=i.product_id WHERE p.id=$1 FOR UPDATE OF p,i", item.Product.ID)
		if e != nil {
			a.dbError(w, e)
			return
		}
	}
	c, e = loadCart(r.Context(), tx, s.Hash)
	if e != nil {
		a.dbError(w, e)
		return
	}
	v, e := calculateQuote(r.Context(), tx, c, in.Address.Province)
	if e == nil {
		e = applyDiscount(r.Context(), tx, &v, in.DiscountCode, true)
	}
	if e != nil {
		fail(w, 409, e.Error())
		return
	}
	if v.TotalRials != in.ExpectedTotalRials {
		fail(w, 409, "قیمت تغییر کرده است؛ جمع سفارش را دوباره بررسی کنید")
		return
	}
	id := token()
	address, _ := json.Marshal(in.Address)
	_, e = tx.Exec(r.Context(), `INSERT INTO orders(id,user_id,idempotency_key,status,address,subtotal_rials,shipping_rials,total_rials,reservation_expires_at,discount_code,discount_rials) VALUES($1,$2,$3,'pending',$4,$5,$6,$7,now()+interval '15 minutes',nullif($8,''),$9)`, id, s.UserID, in.IdempotencyKey, address, v.SubtotalRials, v.ShippingRials, v.TotalRials, v.DiscountCode, v.DiscountRials)
	if e != nil {
		a.dbError(w, e)
		return
	}
	for _, item := range c.Items {
		_, e = tx.Exec(r.Context(), "UPDATE inventory SET reserved_grams=reserved_grams+$1 WHERE product_id=$2", item.Grams, item.Product.ID)
		if e == nil {
			_, e = tx.Exec(r.Context(), "INSERT INTO order_items(order_id,product_id,name,grams,price_rials,total_rials,package_id,package_label,quantity) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)", id, item.Product.ID, item.Product.Name, item.Grams, item.Product.PackagePrice(item.Package), item.TotalRials, item.Package.ID, item.Package.Label(), item.Quantity)
		}
		if e != nil {
			a.dbError(w, e)
			return
		}
	}
	_, e = tx.Exec(r.Context(), "INSERT INTO payment_attempts(id,order_id,provider) VALUES($1,$2,'simulator')", token(), id)
	if e == nil {
		e = tx.Commit(r.Context())
	}
	if e != nil {
		a.dbError(w, e)
		return
	}
	write(w, 201, map[string]string{"orderId": id})
}
func loadOrders(ctx context.Context, q querier, user string, ids ...string) ([]domain.Order, error) {
	id := ""
	if len(ids) > 0 {
		id = ids[0]
	}
	rows, e := q.Query(ctx, "SELECT id,status,address,subtotal_rials,shipping_rials,total_rials,tracking,created_at,coalesce(discount_code,''),discount_rials FROM orders WHERE ($1='' OR user_id=$1) AND ($2='' OR id=$2) ORDER BY created_at DESC LIMIT 100", user, id)
	if e != nil {
		return nil, e
	}
	out := []domain.Order{}
	for rows.Next() {
		var v domain.Order
		var raw []byte
		var date time.Time
		if e = rows.Scan(&v.ID, &v.Status, &raw, &v.SubtotalRials, &v.ShippingRials, &v.TotalRials, &v.Tracking, &date, &v.DiscountCode, &v.DiscountRials); e != nil {
			rows.Close()
			return nil, e
		}
		_ = json.Unmarshal(raw, &v.Address)
		v.CreatedAt = date.Format(time.RFC3339)
		v.Items = []domain.OrderItem{}
		out = append(out, v)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return nil, e
	}
	for i := range out {
		items, e := q.Query(ctx, "SELECT product_id,name,grams,price_rials,total_rials,package_id,package_label,quantity FROM order_items WHERE order_id=$1 ORDER BY product_id", out[i].ID)
		if e != nil {
			return nil, e
		}
		for items.Next() {
			var it domain.OrderItem
			if e = items.Scan(&it.ProductID, &it.Name, &it.Grams, &it.PriceRials, &it.TotalRials, &it.PackageID, &it.PackageLabel, &it.Quantity); e != nil {
				items.Close()
				return nil, e
			}
			out[i].Items = append(out[i].Items, it)
		}
		e = items.Err()
		items.Close()
		if e != nil {
			return nil, e
		}
	}
	for i := range out {
		out[i].Events = []domain.OrderEvent{}
		rows, e := q.Query(ctx, "SELECT status,created_at FROM order_events WHERE order_id=$1 ORDER BY created_at", out[i].ID)
		if e != nil {
			return nil, e
		}
		for rows.Next() {
			var v domain.OrderEvent
			var t time.Time
			if e = rows.Scan(&v.Status, &t); e != nil {
				rows.Close()
				return nil, e
			}
			v.CreatedAt = t.Format(time.RFC3339)
			out[i].Events = append(out[i].Events, v)
		}
		e = rows.Err()
		rows.Close()
		if e != nil {
			return nil, e
		}
	}
	return out, nil
}
func (a *App) orders(w http.ResponseWriter, r *http.Request) {
	if !requireCustomer(w, r) {
		return
	}
	v, e := loadOrders(r.Context(), a.Pool, current(r).UserID)
	if e != nil {
		a.dbError(w, e)
		return
	}
	write(w, 200, v)
}
func (a *App) simulatePayment(w http.ResponseWriter, r *http.Request) {
	if !a.Dev {
		fail(w, 404, "یافت نشد")
		return
	}
	if !requireCustomer(w, r) {
		return
	}
	var in struct {
		Success bool `json:"success"`
	}
	if !decode(w, r, &in) {
		return
	}
	status, e := a.settle(r.Context(), r.PathValue("id"), current(r).UserID, in.Success)
	if e != nil {
		fail(w, 409, e.Error())
		return
	}
	write(w, 200, map[string]string{"status": status})
}
func (a *App) settle(ctx context.Context, id, user string, success bool) (string, error) {
	tx, e := a.Pool.Begin(ctx)
	if e != nil {
		return "", e
	}
	defer tx.Rollback(ctx)
	var status, discountCode string
	var expires time.Time
	e = tx.QueryRow(ctx, "SELECT status,reservation_expires_at,coalesce(discount_code,'') FROM orders WHERE id=$1 AND user_id=$2 FOR UPDATE", id, user).Scan(&status, &expires, &discountCode)
	if e != nil {
		return "", errors.New("سفارش پیدا نشد")
	}
	if status != "pending" && status != "expired" {
		return status, nil
	}
	var paymentStatus string
	e = tx.QueryRow(ctx, "SELECT status FROM payment_attempts WHERE order_id=$1 FOR UPDATE", id).Scan(&paymentStatus)
	if e != nil {
		return "", e
	}
	if paymentStatus != "pending" {
		return status, nil
	}
	rows, e := tx.Query(ctx, "SELECT product_id,sum(grams) FROM order_items WHERE order_id=$1 GROUP BY product_id ORDER BY product_id", id)
	if e != nil {
		return "", e
	}
	type item struct {
		id string
		g  int64
	}
	items := []item{}
	for rows.Next() {
		var it item
		if e = rows.Scan(&it.id, &it.g); e != nil {
			rows.Close()
			return "", e
		}
		items = append(items, it)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return "", e
	}
	available := true
	for _, it := range items {
		var stock, reserved int64
		e = tx.QueryRow(ctx, "SELECT stock_grams,reserved_grams FROM inventory WHERE product_id=$1 FOR UPDATE", it.id).Scan(&stock, &reserved)
		if e != nil {
			return "", e
		}
		if status == "expired" && stock-reserved < it.g {
			available = false
		}
	}
	if success && status == "expired" {
		capacity, err := reclaimDiscount(ctx, tx, discountCode)
		if err != nil {
			return "", err
		}
		available = available && capacity
	}
	final := "cancelled"
	if success {
		final = "paid"
		if !available {
			final = "review"
		}
	}
	for _, it := range items {
		reservedDelta, stockDelta := int64(0), int64(0)
		if status == "pending" {
			reservedDelta = it.g
		}
		if final == "paid" {
			stockDelta = it.g
		}
		_, e = tx.Exec(ctx, "UPDATE inventory SET stock_grams=stock_grams-$1,reserved_grams=reserved_grams-$2 WHERE product_id=$3", stockDelta, reservedDelta, it.id)
		if e != nil {
			return "", e
		}
		if final == "paid" {
			_, e = tx.Exec(ctx, "INSERT INTO stock_movements(product_id,delta_grams,reason,order_id) VALUES($1,$2,'sale',$3)", it.id, -it.g, id)
			if e != nil {
				return "", e
			}

		}
	}
	if final == "paid" {
		_, e = tx.Exec(ctx, `DELETE FROM carts c USING order_items oi,sessions s WHERE oi.order_id=$1 AND c.product_id=oi.product_id AND c.package_id=oi.package_id AND c.quantity=oi.quantity AND c.session_hash=s.token_hash AND s.user_id=$2`, id, user)
		if e != nil {
			return "", e
		}
		if e = queueOrderSMS(ctx, tx, id, final); e != nil {
			return "", e
		}
	}
	_, e = tx.Exec(ctx, "UPDATE orders SET status=$1 WHERE id=$2", final, id)
	if e == nil {
		ps := "failed"
		if success {
			ps = "verified"
		}
		_, e = tx.Exec(ctx, "UPDATE payment_attempts SET status=$1,reference=$2 WHERE order_id=$3", ps, "sim-"+id, id)
	}
	if e == nil {
		e = tx.Commit(ctx)
	}
	return final, e
}
func (a *App) ExpireReservations(ctx context.Context) error {
	tx, e := a.Pool.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	rows, e := tx.Query(ctx, "SELECT id FROM orders WHERE status='pending' AND reservation_expires_at<now() ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 100")
	if e != nil {
		return e
	}
	ids := []string{}
	for rows.Next() {
		var id string
		if e = rows.Scan(&id); e != nil {
			rows.Close()
			return e
		}
		ids = append(ids, id)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		return e
	}
	for _, id := range ids {
		_, e = tx.Exec(ctx, `UPDATE inventory i SET reserved_grams=i.reserved_grams-oi.grams FROM (SELECT product_id,sum(grams) grams FROM order_items WHERE order_id=$1 GROUP BY product_id) oi WHERE oi.product_id=i.product_id`, id)
		if e != nil {
			return e
		}
		_, e = tx.Exec(ctx, "UPDATE orders SET status='expired' WHERE id=$1", id)
		if e != nil {
			return e
		}
	}
	if e = tx.Commit(ctx); e != nil {
		return fmt.Errorf("expiry: %w", e)
	}
	return nil
}
