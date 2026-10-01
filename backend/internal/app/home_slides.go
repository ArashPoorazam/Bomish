package app

import (
	"bomish/internal/domain"
	"net/http"
	"strings"
)

type homeSlide struct {
	Image string `json:"image"`
	Alt   string `json:"alt"`
}

func (a *App) homeSlides(w http.ResponseWriter, r *http.Request) {
	rows, err := a.Pool.Query(r.Context(), `SELECT image,alt FROM home_slides ORDER BY position`)
	if err != nil {
		a.dbError(w, err)
		return
	}
	defer rows.Close()
	slides := []homeSlide{}
	for rows.Next() {
		var slide homeSlide
		if err = rows.Scan(&slide.Image, &slide.Alt); err != nil {
			a.dbError(w, err)
			return
		}
		slides = append(slides, slide)
	}
	if err = rows.Err(); err != nil {
		a.dbError(w, err)
		return
	}
	write(w, 200, slides)
}

func (a *App) saveHomeSlides(w http.ResponseWriter, r *http.Request) {
	var slides []homeSlide
	if !decode(w, r, &slides) {
		return
	}
	if slides == nil {
		fail(w, 400, "فهرست تصاویر معتبر نیست")
		return
	}
	for i := range slides {
		slides[i].Alt = strings.TrimSpace(slides[i].Alt)
		if !domain.ValidImage(slides[i].Image) || !validText(slides[i].Alt, 300) {
			fail(w, 400, "نشانی تصویر و توضیح کوتاه (حداکثر ۳۰۰ نویسه) را بررسی کنید")
			return
		}
	}
	tx, err := a.Pool.Begin(r.Context())
	if err != nil {
		a.dbError(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	// Serialize even empty replacements, using the same store configuration lock.
	if _, err = tx.Exec(r.Context(), `SELECT id FROM settings WHERE id=true FOR UPDATE`); err != nil {
		a.dbError(w, err)
		return
	}
	if _, err = tx.Exec(r.Context(), `DELETE FROM home_slides`); err != nil {
		a.dbError(w, err)
		return
	}
	for i, slide := range slides {
		if _, err = tx.Exec(r.Context(), `INSERT INTO home_slides(position,image,alt) VALUES($1,$2,$3)`, i, slide.Image, slide.Alt); err != nil {
			a.dbError(w, err)
			return
		}
	}
	if err = auditDetail(r.Context(), tx, current(r).StaffID, "store.home_slides", "home", slides); err == nil {
		err = tx.Commit(r.Context())
	}
	if err != nil {
		a.dbError(w, err)
		return
	}
	write(w, 200, map[string]bool{"ok": true})
}
