package app

import (
	"github.com/jackc/pgx/v5"
	"net/http"
)

func (a *App) staffOrder(w http.ResponseWriter, r *http.Request) {
	orders, e := loadOrderPage(r.Context(), a.Pool, "", r.PathValue("id"), "", "", 1, 0)
	if e != nil {
		a.dbError(w, e)
		return
	}
	if len(orders) == 0 {
		fail(w, 404, "سفارش پیدا نشد")
		return
	}
	write(w, 200, orders[0])
}

func (a *App) packOrderItem(w http.ResponseWriter, r *http.Request) {
	var in struct {
		ProductID string `json:"productId"`
		PackageID string `json:"packageId"`
		Packed    *bool  `json:"packed"`
	}
	if !decode(w, r, &in) {
		return
	}
	if in.ProductID == "" || in.PackageID == "" || in.Packed == nil {
		fail(w, 400, "محصول، بسته و وضعیت بسته‌بندی را مشخص کنید")
		return
	}
	tx, e := a.Pool.Begin(r.Context())
	if e != nil {
		a.dbError(w, e)
		return
	}
	defer tx.Rollback(r.Context())
	id := r.PathValue("id")
	var status string
	e = tx.QueryRow(r.Context(), "SELECT status FROM orders WHERE id=$1 FOR UPDATE", id).Scan(&status)
	if e == pgx.ErrNoRows {
		fail(w, 404, "سفارش پیدا نشد")
		return
	}
	if e != nil {
		a.dbError(w, e)
		return
	}
	if status != "paid" && status != "packing" {
		fail(w, 409, "چک‌لیست فقط پیش از ارسال سفارش پرداخت‌شده قابل ویرایش است")
		return
	}
	result, e := tx.Exec(r.Context(), "UPDATE order_items SET packed=$4 WHERE order_id=$1 AND product_id=$2 AND package_id=$3", id, in.ProductID, in.PackageID, *in.Packed)
	if e != nil {
		a.dbError(w, e)
		return
	}
	if result.RowsAffected() == 0 {
		fail(w, 404, "این بسته در سفارش وجود ندارد")
		return
	}
	if e = auditDetail(r.Context(), tx, current(r).StaffID, "order.pack-item", id, map[string]any{"productId": in.ProductID, "packageId": in.PackageID, "packed": *in.Packed}); e == nil {
		e = tx.Commit(r.Context())
	}
	if e != nil {
		a.dbError(w, e)
		return
	}
	write(w, 200, map[string]bool{"ok": true})
}
