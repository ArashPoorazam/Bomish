package app

import (
	"net/http"
	"strings"

	"bomish/internal/domain"
	"bomish/internal/httpx"
)

type homeSlide struct {
	Image      string `json:"image"`
	Alt        string `json:"alt"`
	Title      string `json:"title,omitempty"`
	Caption    string `json:"caption,omitempty"`
	Collection string `json:"collection,omitempty"`
}

func (a *App) homeSlides(w http.ResponseWriter, r *http.Request) {
	rows, err := a.Pool.Query(r.Context(), `SELECT image,alt,title,caption,collection FROM home_slides ORDER BY position`)
	if err != nil {
		httpx.DatabaseError(w, err)
		return
	}
	defer rows.Close()
	slides := []homeSlide{}
	for rows.Next() {
		var slide homeSlide
		if err = rows.Scan(&slide.Image, &slide.Alt, &slide.Title, &slide.Caption, &slide.Collection); err != nil {
			httpx.DatabaseError(w, err)
			return
		}
		slides = append(slides, slide)
	}
	if err = rows.Err(); err != nil {
		httpx.DatabaseError(w, err)
		return
	}
	httpx.JSON(w, 200, slides)
}

func (a *App) saveHomeSlides(w http.ResponseWriter, r *http.Request) {
	var slides []homeSlide
	if !httpx.Decode(w, r, &slides) {
		return
	}
	if slides == nil {
		httpx.Error(w, 400, "فهرست تصاویر معتبر نیست")
		return
	}
	for i := range slides {
		slides[i].Alt = strings.TrimSpace(slides[i].Alt)
		slides[i].Title = strings.TrimSpace(slides[i].Title)
		slides[i].Caption = strings.TrimSpace(slides[i].Caption)
		if !domain.ValidImage(slides[i].Image) || !validText(slides[i].Alt, 300) {
			httpx.Error(w, 400, "نشانی تصویر و توضیح کوتاه (حداکثر ۳۰۰ نویسه) را بررسی کنید")
			return
		}
		if (slides[i].Title != "" && !validText(slides[i].Title, 80)) || (slides[i].Caption != "" && !validText(slides[i].Caption, 160)) {
			httpx.Error(w, 400, "عنوان حداکثر ۸۰ و متن کوتاه حداکثر ۱۶۰ نویسه باشد")
			return
		}
		switch slides[i].Collection {
		case "", "products", "spices", "herbs", "seeds", "arrivals", "bestsellers", "suggestions":
		default:
			httpx.Error(w, 400, "مجموعه انتخاب‌شده معتبر نیست")
			return
		}
	}
	tx, err := a.Pool.Begin(r.Context())
	if err != nil {
		httpx.DatabaseError(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	// Serialize even empty replacements, using the same store configuration lock.
	if _, err = tx.Exec(r.Context(), `SELECT id FROM settings WHERE id=true FOR UPDATE`); err != nil {
		httpx.DatabaseError(w, err)
		return
	}
	if _, err = tx.Exec(r.Context(), `DELETE FROM home_slides`); err != nil {
		httpx.DatabaseError(w, err)
		return
	}
	for i, slide := range slides {
		if _, err = tx.Exec(r.Context(), `INSERT INTO home_slides(position,image,alt,title,caption,collection) VALUES($1,$2,$3,$4,$5,$6)`, i, slide.Image, slide.Alt, slide.Title, slide.Caption, slide.Collection); err != nil {
			httpx.DatabaseError(w, err)
			return
		}
	}
	if err = auditDetail(r.Context(), tx, current(r).StaffID, "store.home_slides", "home", slides); err == nil {
		err = tx.Commit(r.Context())
	}
	if err != nil {
		httpx.DatabaseError(w, err)
		return
	}
	httpx.JSON(w, 200, map[string]bool{"ok": true})
}
