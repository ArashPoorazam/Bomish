package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"

	"bomish/internal/domain"

	"github.com/jackc/pgx/v5"
)

var errPackagingUpdate = errors.New("به‌روزرسانی بسته‌بندی ممکن نیست")

func syncProductPackaging(r *http.Request, tx pgx.Tx, packaging domain.ProductPackaging) (int, error) {
	match, _ := json.Marshal([]map[string]string{{"packagingId": packaging.ID}})
	rows, err := tx.Query(r.Context(), `SELECT id FROM products
		WHERE content->'packages' @> $1::jsonb OR EXISTS (
			SELECT 1 FROM product_drafts WHERE product_id=products.id AND content->'packages' @> $1::jsonb
		) ORDER BY id FOR UPDATE`, match)
	if err != nil {
		return 0, err
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return 0, err
	}
	for _, id := range ids {
		for _, source := range []struct{ table, key string }{{"products", "id"}, {"product_drafts", "product_id"}} {
			var raw []byte
			err = tx.QueryRow(r.Context(), "SELECT content->'packages' FROM "+source.table+" WHERE "+source.key+"=$1 FOR UPDATE", id).Scan(&raw)
			if errors.Is(err, pgx.ErrNoRows) {
				continue
			}
			if err != nil {
				return 0, err
			}
			updated, changed, err := updatePackagingVariants(raw, packaging)
			if err != nil {
				return 0, err
			}
			if changed {
				if _, err = tx.Exec(r.Context(), "UPDATE "+source.table+" SET content=jsonb_set(content,'{packages}',$2::jsonb),updated_at=now() WHERE "+source.key+"=$1", id, updated); err != nil {
					return 0, err
				}
			}
		}
		if err = audit(r, tx, "product.packaging", id); err != nil {
			return 0, err
		}
	}
	return len(ids), nil
}

func updatePackagingVariants(raw []byte, packaging domain.ProductPackaging) ([]byte, bool, error) {
	if len(raw) == 0 {
		return raw, false, nil
	}
	var variants []json.RawMessage
	if err := json.Unmarshal(raw, &variants); err != nil {
		return nil, false, err
	}
	changed := false
	for index, encoded := range variants {
		var pack domain.Package
		if err := json.Unmarshal(encoded, &pack); err != nil {
			return nil, false, err
		}
		if pack.PackagingID != packaging.ID {
			continue
		}
		if err := pack.ApplyPackaging(packaging); err != nil {
			return nil, false, fmt.Errorf("%w: %s", errPackagingUpdate, err)
		}
		variants[index], _ = json.Marshal(pack)
		changed = true
	}
	if !changed {
		return raw, false, nil
	}
	updated, err := json.Marshal(variants)
	return updated, true, err
}
