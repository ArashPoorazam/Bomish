package migrations

import (
	"context"
	"crypto/rand"
	"fmt"
	"os"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestFreshMigrationsAndCategoryPreservation(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL required")
	}
	ctx := context.Background()
	base, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer base.Close()
	tx, err := base.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(7234109)"); err != nil {
		t.Fatal(err)
	}
	if _, err = tx.Exec(ctx, "CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public"); err != nil {
		t.Fatal(err)
	}
	if err = tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}

	id := make([]byte, 8)
	if _, err = rand.Read(id); err != nil {
		t.Fatal(err)
	}
	schema := fmt.Sprintf("migration_test_%x", id)
	if _, err = base.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	defer base.Exec(ctx, "DROP SCHEMA "+schema+" CASCADE")
	config, err := pgxpool.ParseConfig(url)
	if err != nil {
		t.Fatal(err)
	}
	config.ConnConfig.RuntimeParams["search_path"] = schema + ",public"
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	if err = Apply(ctx, pool); err != nil {
		t.Fatal(err)
	}
	var count int
	if err = pool.QueryRow(ctx, "SELECT count(*) FROM categories WHERE id IN ('spices','herbs','seeds')").Scan(&count); err != nil || count != 3 {
		t.Fatal(count, err)
	}
	if err = pool.QueryRow(ctx, "SELECT count(*) FROM staff").Scan(&count); err != nil || count != 0 {
		t.Fatal("migrations seeded staff", count, err)
	}
	if _, err = pool.Exec(ctx, "UPDATE categories SET name='Merchant name' WHERE id='spices'"); err != nil {
		t.Fatal(err)
	}
	if err = Apply(ctx, pool); err != nil {
		t.Fatal(err)
	}
	if err = Check(ctx, pool); err != nil {
		t.Fatal(err)
	}
	var name string
	if err = pool.QueryRow(ctx, "SELECT name FROM categories WHERE id='spices'").Scan(&name); err != nil || name != "Merchant name" {
		t.Fatal("migration overwrote merchant", name, err)
	}
}
