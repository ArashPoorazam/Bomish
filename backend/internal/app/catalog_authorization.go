package app

import (
	"net/http"

	"bomish/internal/domain"
	"bomish/internal/httpx"

	"github.com/jackc/pgx/v5"
)

func samePricing(a, b domain.Product) bool {
	if a.PriceRials != b.PriceRials || a.DiscountPercent != b.DiscountPercent {
		return false
	}
	for _, p := range b.Packages {
		old, ok := a.Package(p.ID)
		if (!ok && p.PriceRials != 0) || (ok && old.PriceRials != p.PriceRials) {
			return false
		}
	}
	return true
}

// The table is selected only by the three catalog handlers above.
func authorizeCatalogSave(w http.ResponseWriter, r *http.Request, tx pgx.Tx, section, table, id string) bool {
	if _, err := tx.Exec(r.Context(), "SELECT pg_advisory_xact_lock(hashtextextended($1,0))", table+":"+id); err != nil {
		httpx.Error(w, 500, "ذخیره انجام نشد")
		return false
	}
	var exists bool
	if err := tx.QueryRow(r.Context(), "SELECT EXISTS(SELECT 1 FROM "+table+" WHERE id=$1)", id).Scan(&exists); err != nil {
		httpx.Error(w, 500, "دریافت اطلاعات انجام نشد")
		return false
	}
	action := "create"
	if exists {
		action = "edit"
	}
	return requirePermission(w, r, section+"."+action)
}
