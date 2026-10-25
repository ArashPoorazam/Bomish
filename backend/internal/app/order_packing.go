package app

import (
	"net/http"
	"os"

	"bomish/internal/httpx"
	"bomish/internal/orderquery"

	"github.com/jackc/pgx/v5"
)

func (a *App) staffOrder(w http.ResponseWriter, r *http.Request) {
	orders, e := orderquery.Load(r.Context(), a.Pool, orderquery.Filter{ID: r.PathValue("id"), Limit: 1, TrackingTemplate: os.Getenv("POST_TRACKING_URL_TEMPLATE")})
	if e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	if len(orders) == 0 {
		httpx.Error(w, 404, "سفارش پیدا نشد")
		return
	}
	httpx.JSON(w, 200, orders[0])
}

func (a *App) packOrderItem(w http.ResponseWriter, r *http.Request) {
	var in struct {
		ProductID string `json:"productId"`
		PackageID string `json:"packageId"`
		Packed    *bool  `json:"packed"`
	}
	if !httpx.Decode(w, r, &in) {
		return
	}
	if in.ProductID == "" || in.PackageID == "" || in.Packed == nil {
		httpx.Error(w, 400, "محصول، بسته و وضعیت بسته‌بندی را مشخص کنید")
		return
	}
	tx, e := a.Pool.Begin(r.Context())
	if e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	defer tx.Rollback(r.Context())
	id := r.PathValue("id")
	var status string
	e = tx.QueryRow(r.Context(), "SELECT status FROM orders WHERE id=$1 FOR UPDATE", id).Scan(&status)
	if e == pgx.ErrNoRows {
		httpx.Error(w, 404, "سفارش پیدا نشد")
		return
	}
	if e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	if status != "paid" && status != "packing" {
		httpx.Error(w, 409, "چک‌لیست فقط پیش از ارسال سفارش پرداخت‌شده قابل ویرایش است")
		return
	}
	d, err := loadDelivery(r.Context(), tx, id, true)
	if err != nil && err != pgx.ErrNoRows {
		httpx.DatabaseError(w, err)
		return
	}
	if err == nil {
		if deliveryLocked(d.Status) {
			shippingError(w, 409, "booking_uncertain", "چک‌لیست هنگام درخواست فعال یا نامشخص قابل تغییر نیست")
			return
		}
		d.Ready = false
		d.Review = nil
		if e = saveDelivery(r.Context(), tx, d); e != nil {
			httpx.DatabaseError(w, e)
			return
		}
	}
	result, e := tx.Exec(r.Context(), "UPDATE order_items SET packed=$4 WHERE order_id=$1 AND product_id=$2 AND package_id=$3", id, in.ProductID, in.PackageID, *in.Packed)
	if e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	if result.RowsAffected() == 0 {
		httpx.Error(w, 404, "این بسته در سفارش وجود ندارد")
		return
	}
	if e = auditDetail(r.Context(), tx, current(r).StaffID, "order.pack-item", id, map[string]any{"productId": in.ProductID, "packageId": in.PackageID, "packed": *in.Packed}); e == nil {
		e = tx.Commit(r.Context())
	}
	if e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	httpx.JSON(w, 200, map[string]bool{"ok": true})
}
