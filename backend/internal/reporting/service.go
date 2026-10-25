// Package reporting owns read-only business reports and workbook generation.
// Its HTTP handlers must be mounted behind the owner's authorization boundary.
package reporting

import (
	"iter"
	"maps"
	"sync"
	"time"
	_ "time/tzdata"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Service struct{ Pool *pgxpool.Pool }

func Sections() iter.Seq[string] { return maps.Keys(reportSpecs) }

// Load once instead of reopening timezone data for each exported date cell.
var tehran = sync.OnceValue(func() *time.Location {
	zone, err := time.LoadLocation("Asia/Tehran")
	if err != nil {
		panic(err)
	}
	return zone
})
