package app

import (
	"encoding/json"
	"errors"
	"net/http"

	"bomish/internal/domain"
	"bomish/internal/httpx"
	"bomish/internal/security"

	"github.com/jackc/pgx/v5"
)

type quoteResult struct {
	ShippingQuoteID    string `json:"shippingQuoteId,omitempty"`
	ExpiresAt          string `json:"expiresAt,omitempty"`
	Method             string `json:"method,omitempty"`
	Service            string `json:"service,omitempty"`
	ParcelCount        int    `json:"parcelCount,omitempty"`
	Simulated          bool   `json:"simulated"`
	FallbackReason     string `json:"fallbackReason,omitempty"`
	RequiresAcceptance bool   `json:"requiresAcceptance"`
	DiscountCode       string `json:"discountCode"`
	DiscountRials      int64  `json:"discountRials"`
	SubtotalRials      int64  `json:"subtotalRials"`
	ShippingRials      int64  `json:"shippingRials"`
	TotalRials         int64  `json:"totalRials"`
	WeightGrams        int64  `json:"weightGrams"`
}

func (a *App) quote(w http.ResponseWriter, r *http.Request) {
	if !requireCustomer(w, r) {
		return
	}
	var in shippingQuoteInput
	if !httpx.Decode(w, r, &in) {
		return
	}
	c, e := loadCart(r.Context(), a.Pool, current(r).Hash)
	if e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	cfg, e := readShippingConfig(r.Context(), a.Pool, false)
	if e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	a.calculatedQuote(w, r, c, in, cfg)
}

func (a *App) checkout(w http.ResponseWriter, r *http.Request) {
	if !requireCustomer(w, r) {
		return
	}
	var in struct {
		Address            domain.Address `json:"address"`
		ShippingQuoteID    string         `json:"shippingQuoteId"`
		Method             string         `json:"method"`
		DiscountCode       string         `json:"discountCode"`
		ExpectedTotalRials int64          `json:"expectedTotalRials"`
		IdempotencyKey     string         `json:"idempotencyKey"`
	}
	if !httpx.Decode(w, r, &in) {
		return
	}
	in.Address.Phone = domain.Phone(in.Address.Phone)
	in.Address.PostalCode = domain.Normalize(in.Address.PostalCode)
	if e := in.Address.Validate(); e != nil {
		httpx.Error(w, 400, e.Error())
		return
	}
	if len(in.IdempotencyKey) < 16 || len(in.IdempotencyKey) > 100 {
		httpx.Error(w, 400, "شناسه درخواست معتبر نیست")
		return
	}
	tx, e := a.Pool.Begin(r.Context())
	if e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	defer tx.Rollback(r.Context())
	s := current(r)
	// Serialize checkout requests for this user, including retries from different tabs.
	_, e = tx.Exec(r.Context(), "SELECT id FROM users WHERE id=$1 FOR UPDATE", s.UserID)
	if e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	var existing string
	e = tx.QueryRow(r.Context(), "SELECT id FROM orders WHERE user_id=$1 AND idempotency_key=$2", s.UserID, in.IdempotencyKey).Scan(&existing)
	if e == nil {
		httpx.JSON(w, 200, map[string]string{"orderId": existing})
		return
	}
	if !errors.Is(e, pgx.ErrNoRows) {
		httpx.DatabaseError(w, e)
		return
	}
	// Coordinate with cart mutations so the purchased snapshot cannot change while checking product availability.
	_, e = tx.Exec(r.Context(), "SELECT token_hash FROM sessions WHERE token_hash=$1 FOR UPDATE", s.Hash)
	if e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	c, e := loadCart(r.Context(), tx, s.Hash)
	if e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	cfg, e := readShippingConfig(r.Context(), tx, true)
	if e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	for _, item := range c.Items {
		_, e = tx.Exec(r.Context(), "SELECT p.id FROM products p WHERE p.id=$1 FOR UPDATE OF p", item.Product.ID)
		if e != nil {
			httpx.DatabaseError(w, e)
			return
		}
	}
	c, e = loadCart(r.Context(), tx, s.Hash)
	if e != nil {
		httpx.DatabaseError(w, e)
		return
	}

	snapshot, e := validateCheckoutQuote(r.Context(), tx, s.UserID, in.ShippingQuoteID, in.Method, c, in.Address, in.DiscountCode, cfg)
	v := snapshot.Totals
	if e != nil {
		shippingError(w, 409, "stale_quote", e.Error())
		return
	}
	if e == nil {
		v.DiscountRials = 0
		v.DiscountCode = ""
		v.TotalRials = v.SubtotalRials + v.ShippingRials
		e = applyDiscount(r.Context(), tx, &v, in.DiscountCode, s.UserID, true)
	}
	if e != nil {
		httpx.Error(w, 409, e.Error())
		return
	}
	if v.TotalRials != in.ExpectedTotalRials {
		httpx.Error(w, 409, "قیمت تغییر کرده است؛ جمع سفارش را دوباره بررسی کنید")
		return
	}
	id := security.Token()
	address, _ := json.Marshal(in.Address)
	_, e = tx.Exec(r.Context(), `INSERT INTO orders(id,user_id,idempotency_key,status,address,subtotal_rials,shipping_rials,total_rials,reservation_expires_at,discount_code,discount_rials) VALUES($1,$2,$3,'pending',$4,$5,$6,$7,now()+interval '15 minutes',nullif($8,''),$9)`, id, s.UserID, in.IdempotencyKey, address, v.SubtotalRials, v.ShippingRials, v.TotalRials, v.DiscountCode, v.DiscountRials)
	if e != nil {
		httpx.DatabaseError(w, e)
		return
	}

	raw, _ := json.Marshal(snapshot)
	parcels, _ := json.Marshal(snapshot.Parcels)
	_, e = tx.Exec(r.Context(), "INSERT INTO order_shipping(order_id,method,snapshot,parcels) VALUES($1,$2,$3,$4)", id, snapshot.Method, raw, parcels)
	if e == nil {
		_, e = tx.Exec(r.Context(), "UPDATE shipping_quotes SET order_id=$1 WHERE id=$2", id, in.ShippingQuoteID)
	}
	if e != nil {
		httpx.DatabaseError(w, e)
		return
	}

	for _, item := range c.Items {
		_, e = tx.Exec(r.Context(), "INSERT INTO order_items(order_id,product_id,name,grams,price_rials,total_rials,package_id,package_label,quantity) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)", id, item.Product.ID, item.Product.Name, item.Grams, item.Product.PackagePrice(item.Package), item.TotalRials, item.Package.ID, item.Package.Label(), item.Quantity)
		if e != nil {
			httpx.DatabaseError(w, e)
			return
		}
	}
	_, e = tx.Exec(r.Context(), "INSERT INTO payment_attempts(id,order_id,provider) VALUES($1,$2,'simulator')", security.Token(), id)
	if e == nil {
		e = tx.Commit(r.Context())
	}
	if e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	httpx.JSON(w, 201, map[string]string{"orderId": id})
}
