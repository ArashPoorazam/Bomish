// Package app coordinates authenticated business workflows and their PostgreSQL
// transactions. Infrastructure and query modules must not import this package.
package app

import (
	"net/http"
	"net/netip"

	"bomish/internal/carrier"
	"bomish/internal/db"
	"bomish/internal/storage"

	"github.com/jackc/pgx/v5/pgxpool"
)

type App struct {
	ShippingProvider carrier.Courier
	Pool             *pgxpool.Pool
	Queries          *db.Queries
	Dev              bool
	CatalogOnly      bool
	TrustedProxies   []netip.Prefix
	TOTPKey          []byte
	Origin           string
	Uploads          storage.Store
	UploadHandler    http.Handler
}
