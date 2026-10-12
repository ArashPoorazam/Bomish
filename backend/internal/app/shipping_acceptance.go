package app

import (
	"bomish/internal/domain"
	"encoding/json"
	"net/http"
	"time"
)

// Accept precisely the displayed quote without contacting the carrier or extending expiry.
func (a *App) acceptPostalQuote(w http.ResponseWriter, r *http.Request, c domain.Cart, in shippingQuoteInput, cfg calculatedConfig) {
	var raw []byte
	var binding string
	var expires time.Time
	var version int64
	var order *string
	err := a.Pool.QueryRow(r.Context(), "SELECT snapshot,binding,expires_at,config_version,order_id FROM shipping_quotes WHERE id=$1 AND user_id=$2", in.AcceptedQuoteID, current(r).UserID).Scan(&raw, &binding, &expires, &version, &order)
	var s shippingSnapshot
	if err != nil || json.Unmarshal(raw, &s) != nil || order != nil || version != cfg.Version || time.Now().After(expires) || s.Method != "post" || in.Method != "post" || binding != quoteBinding(c, in.Address, in.DiscountCode, "post", cfg.Version) {
		shippingError(w, 409, "quote_expired", "پیشنهاد پستی تغییر کرده یا منقضی شده؛ دوباره محاسبه کنید")
		return
	}
	s.FallbackAccepted = true
	s.Totals.RequiresAcceptance = false
	raw, _ = json.Marshal(s)
	tag, err := a.Pool.Exec(r.Context(), "UPDATE shipping_quotes SET snapshot=$1 WHERE id=$2 AND user_id=$3 AND order_id IS NULL AND expires_at>now()", raw, in.AcceptedQuoteID, current(r).UserID)
	if err != nil {
		a.dbError(w, err)
		return
	}
	if tag.RowsAffected() != 1 {
		shippingError(w, 409, "quote_expired", "استعلام منقضی شده؛ دوباره محاسبه کنید")
		return
	}
	write(w, 200, s.Totals)
}
