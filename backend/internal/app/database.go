package app

import (
	"context"
	"github.com/jackc/pgx/v5"
)

type querier interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
	QueryRow(context.Context, string, ...any) pgx.Row
}

func queryMaps(ctx context.Context, q querier, sql string, args ...any) ([]map[string]any, error) {
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
		row := map[string]any{}
		for i, f := range fields {
			row[string(f.Name)] = vals[i]
		}
		out = append(out, row)
	}
	return out, rows.Err()
}
