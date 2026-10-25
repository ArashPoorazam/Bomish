package database

import (
	"context"

	"github.com/jackc/pgx/v5"
)

type Querier interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
	QueryRow(context.Context, string, ...any) pgx.Row
}

func QueryMaps(ctx context.Context, q Querier, sql string, args ...any) ([]map[string]any, error) {
	rows, e := q.Query(ctx, sql, args...)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	out := []map[string]any{}
	fields := rows.FieldDescriptions()
	for rows.Next() {
		vals, e := rows.Values()
		if e != nil {
			return nil, e
		}
		row := make(map[string]any, len(fields))
		for i, f := range fields {
			row[string(f.Name)] = vals[i]
		}
		out = append(out, row)
	}
	return out, rows.Err()
}
