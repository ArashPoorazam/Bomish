package app

import (
	"bomish/internal/domain"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"
)

type productPackagingEntry struct {
	domain.ProductPackaging
	UsedByProducts int `json:"usedByProducts"`
}

func (a *App) productPackaging(w http.ResponseWriter, r *http.Request) {
	rows, err := a.Pool.Query(r.Context(), `SELECT packaging.content,
		(SELECT count(*) FROM (
			SELECT id FROM products WHERE content->'packages' @> jsonb_build_array(jsonb_build_object('packagingId',packaging.id))
			UNION SELECT product_id FROM product_drafts WHERE content->'packages' @> jsonb_build_array(jsonb_build_object('packagingId',packaging.id))
		) linked)::int
		FROM product_packaging packaging ORDER BY packaging.content->>'name',packaging.id`)
	if err != nil {
		a.dbError(w, err)
		return
	}
	defer rows.Close()
	items := []productPackagingEntry{}
	for rows.Next() {
		var raw []byte
		var item productPackagingEntry
		if err = rows.Scan(&raw, &item.UsedByProducts); err == nil {
			err = json.Unmarshal(raw, &item.ProductPackaging)
		}
		if err != nil {
			a.dbError(w, err)
			return
		}
		items = append(items, item)
	}
	if err = rows.Err(); err != nil {
		a.dbError(w, err)
		return
	}
	write(w, 200, items)
}

func (a *App) saveProductPackaging(w http.ResponseWriter, r *http.Request) {
	var item domain.ProductPackaging
	if !decode(w, r, &item) {
		return
	}
	item.ID = r.PathValue("id")
	item.Name = strings.TrimSpace(item.Name)
	if err := item.Validate(); err != nil {
		fail(w, 400, err.Error())
		return
	}
	tx, err := a.Pool.Begin(r.Context())
	if err != nil {
		a.dbError(w, err)
		return
	}
	defer tx.Rollback(r.Context())
	if _, err = tx.Exec(r.Context(), "SELECT pg_advisory_xact_lock(hashtextextended('product-packaging-sync',0))"); err != nil {
		a.dbError(w, err)
		return
	}
	var exists bool
	if err = tx.QueryRow(r.Context(), "SELECT EXISTS(SELECT 1 FROM product_packaging WHERE id=$1)", item.ID).Scan(&exists); err != nil {
		a.dbError(w, err)
		return
	}
	permission := "packaging.create"
	if exists {
		permission = "packaging.edit"
	}
	if !requirePermission(w, r, permission) {
		return
	}
	raw, _ := json.Marshal(item)
	_, err = tx.Exec(r.Context(), "INSERT INTO product_packaging(id,content) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET content=excluded.content,updated_at=now()", item.ID, raw)
	updated := 0
	if err == nil {
		_, err = tx.Exec(r.Context(), "SELECT set_config('bomish.actor',$1,true)", current(r).StaffID)
	}
	if err == nil {
		updated, err = syncProductPackaging(r, tx, item)
	}
	if errors.Is(err, errPackagingUpdate) {
		fail(w, 422, err.Error())
		return
	}
	if err == nil {
		err = audit(r, tx, "product_packaging.save", item.ID)
	}
	if err == nil {
		err = tx.Commit(r.Context())
	}
	if err != nil {
		a.dbError(w, err)
		return
	}
	write(w, 200, productPackagingEntry{ProductPackaging: item, UsedByProducts: updated})
}

func resolveProductPackaging(r *http.Request, tx pgx.Tx, product *domain.Product) (string, error) {
	cache := map[string]domain.ProductPackaging{}
	for index := range product.Packages {
		pack := &product.Packages[index]
		pack.Packaging = nil
		if pack.PackagingID == "" {
			pack.NetGrams = 0
			continue
		}
		packaging, found := cache[pack.PackagingID]
		if !found {
			var raw []byte
			err := tx.QueryRow(r.Context(), "SELECT content FROM product_packaging WHERE id=$1 FOR SHARE", pack.PackagingID).Scan(&raw)
			if errors.Is(err, pgx.ErrNoRows) {
				return "بسته‌بندی انتخاب‌شده پیدا نشد", nil
			}
			if err != nil {
				return "", err
			}
			if err = json.Unmarshal(raw, &packaging); err != nil {
				return "", err
			}
			cache[pack.PackagingID] = packaging
		}
		if err := pack.ApplyPackaging(packaging); err != nil {
			return err.Error(), nil
		}
	}
	return "", nil
}
