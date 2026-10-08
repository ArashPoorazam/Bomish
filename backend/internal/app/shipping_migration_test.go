package app

import (
	"bomish/internal/domain"
	"bomish/migrations"
	"context"
	"testing"
)

func TestShippingCatalogRepairMigration(t *testing.T) {
	for _, legacy := range []bool{true, false} {
		name := "complete_012"
		if legacy {
			name = "early_012"
		}
		t.Run(name, func(t *testing.T) {
			a := setup(t)
			ctx := context.Background()
			if legacy {
				// Reproduce the durable database created before 012 was extended.
				if _, err := a.Pool.Exec(ctx, `DROP FUNCTION shipping_measurements_complete(jsonb);
					ALTER TABLE order_reads DROP COLUMN last_delivery_event`); err != nil {
					t.Fatal(err)
				}
			}
			sql, err := migrations.Files.ReadFile("013_shipping_catalog_repair.sql")
			if err != nil {
				t.Fatal(err)
			}
			if _, err := a.Pool.Exec(ctx, string(sql)); err != nil {
				t.Fatal(err)
			}
			if _, err := a.Pool.Exec(ctx, "SELECT last_delivery_event FROM order_reads LIMIT 0"); err != nil {
				t.Fatal(err)
			}
			c := newClient(t, a.Handler())
			var products []domain.Product
			c.ok(t, "GET", "/products?pageSize=12", nil, &products)
			if len(products) == 0 {
				t.Fatal("repair must preserve the seeded catalog")
			}
			for _, collection := range []string{"bestsellers", "arrivals", "suggestions"} {
				c.ok(t, "GET", "/products?available=true&collection="+collection+"&pageSize=12", nil, &products)
			}
		})
	}
}
