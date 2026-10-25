package app

import (
	"io"
	"net/http"

	"bomish/internal/domain"
	"bomish/internal/httpx"
	"bomish/internal/security"
)

func (a *App) upload(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 8<<20)
	if e := r.ParseMultipartForm(8 << 20); e != nil {
		httpx.Error(w, 400, "حجم تصویر باید کمتر از ۸ مگابایت باشد")
		return
	}
	defer r.MultipartForm.RemoveAll()
	file, _, e := r.FormFile("image")
	if e != nil {
		httpx.Error(w, 400, "تصویر انتخاب نشده است")
		return
	}
	defer file.Close()
	data, e := io.ReadAll(file)
	if e != nil {
		httpx.Error(w, 400, "تصویر قابل خواندن نیست")
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
		httpx.Error(w, 400, "فقط تصویر JPEG، PNG یا WebP پذیرفته می‌شود")
		return
	}
	url, e := a.Uploads.Put(r.Context(), security.Token()+ext, data, mime)
	if e != nil {
		httpx.DatabaseError(w, e)
		return
	}
	if !domain.ValidImage(url) {
		httpx.Error(w, 500, "نشانی تصویر معتبر نیست")
		return
	}
	httpx.JSON(w, 201, map[string]string{"url": url})
}
