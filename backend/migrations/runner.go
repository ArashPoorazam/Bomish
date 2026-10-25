package migrations

import (
	"context"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

func Apply(ctx context.Context, pool *pgxpool.Pool) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(7234109)"); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, "SET LOCAL lock_timeout = '15s'"); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, "CREATE TABLE IF NOT EXISTS schema_migrations(version text PRIMARY KEY)"); err != nil {
		return err
	}
	entries, err := Files.ReadDir(".")
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if !strings.HasSuffix(entry.Name(), ".sql") {
			continue
		}
		version, _, _ := strings.Cut(entry.Name(), "_")
		var exists bool
		if err = tx.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version=$1)", version).Scan(&exists); err != nil {
			return err
		}
		if exists {
			continue
		}
		sql, err := Files.ReadFile(entry.Name())
		if err != nil {
			return err
		}
		if _, err = tx.Exec(ctx, string(sql)); err != nil {
			return fmt.Errorf("migration %s: %w", entry.Name(), err)
		}
		if _, err = tx.Exec(ctx, "INSERT INTO schema_migrations(version) VALUES($1)", version); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}
func Check(ctx context.Context, pool *pgxpool.Pool) error {
	entries, err := Files.ReadDir(".")
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if !strings.HasSuffix(entry.Name(), ".sql") {
			continue
		}
		var exists bool
		if err = pool.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM schema_migrations WHERE version=$1)", strings.SplitN(entry.Name(), "_", 2)[0]).Scan(&exists); err != nil {
			return err
		}
		if !exists {
			return fmt.Errorf("migration %s missing: run the migrate command before starting", entry.Name())
		}
	}
	return nil
}
