package app

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
)

const chatImageLimit = 5 << 20

// Pictures are stored with the message and served only after checking thread access.
func decodeChat(w http.ResponseWriter, r *http.Request, v any) ([]byte, bool) {
	if !strings.HasPrefix(r.Header.Get("Content-Type"), "multipart/form-data") {
		return nil, decode(w, r, v)
	}
	r.Body = http.MaxBytesReader(w, r.Body, chatImageLimit+(64<<10))
	if err := r.ParseMultipartForm(chatImageLimit); err != nil {
		fail(w, 400, "حداکثر حجم تصویر ۵ مگابایت است")
		return nil, false
	}
	defer r.MultipartForm.RemoveAll()
	d := json.NewDecoder(strings.NewReader(r.FormValue("payload")))
	d.DisallowUnknownFields()
	if err := d.Decode(v); err != nil {
		fail(w, 400, "اطلاعات ارسالی معتبر نیست")
		return nil, false
	}
	file, _, err := r.FormFile("image")
	if err != nil {
		fail(w, 400, "تصویر انتخاب نشده است")
		return nil, false
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, chatImageLimit+1))
	if err != nil || len(data) == 0 || len(data) > chatImageLimit {
		fail(w, 400, "حداکثر حجم تصویر ۵ مگابایت است")
		return nil, false
	}
	switch http.DetectContentType(data) {
	case "image/jpeg", "image/png", "image/webp":
	default:
		fail(w, 400, "فقط تصویر JPEG، PNG یا WebP پذیرفته می‌شود")
		return nil, false
	}
	return data, true
}

func (a *App) messageImage(w http.ResponseWriter, r *http.Request, staff bool) {
	if !staff && !requireCustomer(w, r) {
		return
	}
	if !a.requestAccess(w, r, staff) {
		return
	}
	var data []byte
	err := a.Pool.QueryRow(r.Context(), `SELECT image FROM request_messages WHERE request_id=$1 AND id::text=$2 AND image IS NOT NULL`, r.PathValue("id"), r.PathValue("message")).Scan(&data)
	if err != nil {
		fail(w, 404, "تصویر پیدا نشد")
		return
	}
	w.Header().Set("Content-Type", http.DetectContentType(data))
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Write(data)
}

func (a *App) requestOrders(w http.ResponseWriter, r *http.Request) {
	var owner string
	if err := a.Pool.QueryRow(r.Context(), `SELECT user_id FROM customer_requests WHERE id=$1`, r.PathValue("id")).Scan(&owner); err != nil {
		fail(w, 404, "مشتری پیدا نشد")
		return
	}
	page, size := pageArgs(r)
	orders, err := loadOrderPage(r.Context(), a.Pool, owner, "", "", "", size, (page-1)*size, "", "")
	if err != nil {
		a.dbError(w, err)
		return
	}
	var total int64
	if err = a.Pool.QueryRow(r.Context(), `SELECT count(*) FROM orders WHERE user_id=$1`, owner).Scan(&total); err != nil {
		a.dbError(w, err)
		return
	}
	listResponse(w, r, orders, total)
}
