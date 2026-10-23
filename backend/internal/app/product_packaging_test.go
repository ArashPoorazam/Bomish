package app

import (
	"bomish/internal/domain"
	"bomish/migrations"
	"bytes"
	"context"
	"encoding/json"
	"reflect"
	"testing"
)

func TestProductPackagingReplacesLegacyMeasurements(t *testing.T) {
	app, owner, customer, address := shippingFixture(t)
	packaging := domain.ProductPackaging{ID: "glass", Name: "شیشه", EmptyGrams: 150, LengthMm: 80, WidthMm: 80, HeightMm: 100, VolumeCm3: 640}
	var original domain.Product
	owner.ok(t, "GET", "/products/turmeric", nil, &original)
	owner.ok(t, "PUT", "/staff/product-packaging/glass", packaging, nil)
	var unchanged domain.Product
	owner.ok(t, "GET", "/products/turmeric", nil, &unchanged)
	if !reflect.DeepEqual(original, unchanged) {
		t.Fatal("adding packaging changed legacy product")
	}
	owner.ok(t, "PUT", "/staff/products/turmeric", original, nil)
	if status, _ := owner.call("POST", "/staff/products/turmeric/publish", nil); status != 422 {
		t.Fatal("unassigned packaging published", status)
	}
	product := original
	product.Packages = append([]domain.Package(nil), original.Packages...)
	for index := range product.Packages {
		product.Packages[index].PackagingID = packaging.ID
		product.Packages[index].ShippingGrams = 1
		product.Packages[index].LengthMm = 1
		product.Packages[index].Packaging = &domain.ProductPackaging{ID: "forged", EmptyGrams: 1}
	}
	owner.ok(t, "PUT", "/staff/products/turmeric", product, nil)
	owner.ok(t, "POST", "/staff/products/turmeric/publish", nil, nil)
	owner.ok(t, "GET", "/products/turmeric", nil, &product)
	for _, pack := range product.Packages {
		if pack.ShippingGrams != pack.Weight()+150 || pack.Packaging == nil || *pack.Packaging != packaging || pack.LengthMm != 80 {
			t.Fatal("server trusted forged measurements", pack)
		}
	}
	_, quote, _ := quoteAndCheckout(t, customer, address, "post")
	var raw []byte
	if err := app.Pool.QueryRow(context.Background(), "SELECT snapshot FROM shipping_quotes WHERE id=$1", quote.ShippingQuoteID).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	var snapshot shippingSnapshot
	if err := json.Unmarshal(raw, &snapshot); err != nil {
		t.Fatal(err)
	}
	if len(snapshot.Items) != 2 || len(snapshot.Parcels) != 1 {
		t.Fatalf("unexpected packing: %+v", snapshot)
	}
	for _, item := range snapshot.Items {
		if item.Grams != 650 {
			t.Fatal("packaging not included once per unit", item)
		}
	}
	if snapshot.Parcels[0].GrossGrams != 1400 {
		t.Fatal("expected 2*(500+150)+100 carton", snapshot.Parcels[0].GrossGrams)
	}
	var pending quoteResult
	customer.ok(t, "POST", "/checkout/quote", shippingQuoteInput{Address: address, Method: "post"}, &pending)
	packaging.EmptyGrams = 200
	owner.ok(t, "PUT", "/staff/product-packaging/glass", packaging, nil)
	owner.ok(t, "GET", "/products/turmeric", nil, &product)
	for _, pack := range product.Packages {
		if pack.ShippingGrams != pack.Weight()+200 {
			t.Fatal("packaging edit did not refresh published product", pack)
		}
	}
	var preserved []byte
	if err := app.Pool.QueryRow(context.Background(), "SELECT snapshot FROM shipping_quotes WHERE id=$1", quote.ShippingQuoteID).Scan(&preserved); err != nil || !bytes.Equal(raw, preserved) {
		t.Fatal("existing shipping snapshot changed", err)
	}
	if status, _ := customer.call("POST", "/checkout", map[string]any{"address": address, "shippingQuoteId": pending.ShippingQuoteID, "method": pending.Method, "expectedTotalRials": pending.TotalRials, "idempotencyKey": token()}); status != 409 {
		t.Fatal("stale shipping quote accepted", status)
	}
	product.Packages[0].PackagingID = "missing"
	if status, _ := owner.call("PUT", "/staff/products/turmeric", product); status != 400 {
		t.Fatal("unknown packaging accepted", status)
	}
}

func TestManualMeasurementCleanupMigration(t *testing.T) {
	app, owner, customer, address := shippingFixture(t)
	ctx := context.Background()
	orderID, quote, _ := quoteAndCheckout(t, customer, address, "post")
	var orderBefore, quoteBefore, deliveryBefore []byte
	for _, snapshot := range []struct {
		query       string
		id          string
		destination *[]byte
	}{
		{"SELECT to_jsonb(orders) FROM orders WHERE id=$1", orderID, &orderBefore},
		{"SELECT snapshot FROM shipping_quotes WHERE id=$1", quote.ShippingQuoteID, &quoteBefore},
		{"SELECT to_jsonb(order_shipping) FROM order_shipping WHERE order_id=$1", orderID, &deliveryBefore},
	} {
		if err := app.Pool.QueryRow(ctx, snapshot.query, snapshot.id).Scan(snapshot.destination); err != nil {
			t.Fatal(err)
		}
	}
	var original domain.Product
	owner.ok(t, "GET", "/products/turmeric", nil, &original)
	assigned := original.Packages[0]
	assigned.ID = "assigned"
	definition := domain.ProductPackaging{ID: "kept", Name: "Keep", EmptyGrams: 100, LengthMm: 80, WidthMm: 80, HeightMm: 100, VolumeCm3: 640}
	owner.ok(t, "PUT", "/staff/product-packaging/kept", definition, nil)
	if err := assigned.ApplyPackaging(definition); err != nil {
		t.Fatal(err)
	}
	original.Packages = append(original.Packages, assigned)
	original.Packages[0].NetGrams = 500
	original.Packages[0].Packaging = &definition
	raw, _ := json.Marshal(original)
	if _, err := app.Pool.Exec(ctx, `UPDATE products SET content=$1 WHERE id='turmeric';`, raw); err != nil {
		t.Fatal(err)
	}
	if _, err := app.Pool.Exec(ctx, `INSERT INTO product_drafts(product_id,content) VALUES('turmeric',$1)`, raw); err != nil {
		t.Fatal(err)
	}
	cleanup, err := migrations.Files.ReadFile("024_remove_manual_product_measurements.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = app.Pool.Exec(ctx, string(cleanup)); err != nil {
		t.Fatal(err)
	}
	expected := original
	expected.Packages = append([]domain.Package(nil), original.Packages...)
	expected.Packages[0].LengthMm, expected.Packages[0].WidthMm, expected.Packages[0].HeightMm = 0, 0, 0
	expected.Packages[0].ShippingGrams, expected.Packages[0].NetGrams = 0, 0
	expected.Packages[0].ShippingVerified, expected.Packages[0].Packaging = false, nil
	for _, query := range []string{"SELECT content FROM products WHERE id='turmeric'", "SELECT content FROM product_drafts WHERE product_id='turmeric'"} {
		var result domain.Product
		if err = app.Pool.QueryRow(ctx, query).Scan(&raw); err != nil {
			t.Fatal(err)
		}
		if err = json.Unmarshal(raw, &result); err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(expected, result) {
			t.Fatalf("cleanup changed unrelated product data: %+v", result)
		}
	}
	var ready bool
	if err = app.Pool.QueryRow(ctx, "SELECT shipping_measurements_complete(content) FROM products WHERE id='turmeric'").Scan(&ready); err != nil || ready {
		t.Fatal("unassigned product still purchasable", ready, err)
	}
	if status, _ := customer.call("POST", "/checkout/quote", shippingQuoteInput{Address: address, Method: "post"}); status == 200 {
		t.Fatal("unassigned product quoted")
	}
	for _, snapshot := range []struct {
		query    string
		id       string
		expected []byte
	}{
		{"SELECT to_jsonb(orders) FROM orders WHERE id=$1", orderID, orderBefore},
		{"SELECT snapshot FROM shipping_quotes WHERE id=$1", quote.ShippingQuoteID, quoteBefore},
		{"SELECT to_jsonb(order_shipping) FROM order_shipping WHERE order_id=$1", orderID, deliveryBefore},
	} {
		if err = app.Pool.QueryRow(ctx, snapshot.query, snapshot.id).Scan(&raw); err != nil || !bytes.Equal(raw, snapshot.expected) {
			t.Fatal("historical record changed", err)
		}
	}
	if _, err = app.Pool.Exec(ctx, string(cleanup)); err != nil {
		t.Fatal("cleanup not repeatable", err)
	}
}

func TestPackagingUpdatesAllLinkedProductsAndDraftsAtomically(t *testing.T) {
	app, owner, _, _ := shippingFixture(t)
	packaging := domain.ProductPackaging{ID: "shared", Name: "Shared", EmptyGrams: 150, LengthMm: 80, WidthMm: 80, HeightMm: 100, VolumeCm3: 640}
	owner.ok(t, "PUT", "/staff/product-packaging/shared", packaging, nil)
	var product domain.Product
	owner.ok(t, "GET", "/products/turmeric", nil, &product)
	for _, id := range []string{"turmeric", "shared-second"} {
		product.ID, product.Slug = id, id
		product.Name = "Published " + id
		product.Packages[0].PackagingID = packaging.ID
		product.Packages[0].Amount = 500
		owner.ok(t, "PUT", "/staff/products/"+id, product, nil)
		owner.ok(t, "POST", "/staff/products/"+id+"/publish", nil, nil)
		product.Name = "Pending " + id
		product.Packages[0].Amount = 750
		owner.ok(t, "PUT", "/staff/products/"+id, product, nil)
	}
	packaging.Name = "Updated shared"
	packaging.EmptyGrams = 200
	packaging.WidthMm = 90
	packaging.VolumeCm3 = 720
	var result productPackagingEntry
	owner.ok(t, "PUT", "/staff/product-packaging/shared", packaging, &result)
	if result.UsedByProducts != 2 {
		t.Fatal("wrong distinct product count", result)
	}
	for _, id := range []string{"turmeric", "shared-second"} {
		var live domain.Product
		owner.ok(t, "GET", "/products/"+id, nil, &live)
		if live.Name != "Published "+id || live.Status != "published" || live.Packages[0].ShippingGrams != 700 || live.Packages[0].WidthMm != 90 || *live.Packages[0].Packaging != packaging {
			t.Fatal("live product not synchronized", live)
		}
		var draftRaw []byte
		if err := app.Pool.QueryRow(context.Background(), "SELECT content FROM product_drafts WHERE product_id=$1", id).Scan(&draftRaw); err != nil {
			t.Fatal(err)
		}
		var draft domain.Product
		if err := json.Unmarshal(draftRaw, &draft); err != nil {
			t.Fatal(err)
		}
		if draft.Name != "Pending "+id || draft.Packages[0].ShippingGrams != 950 || draft.Packages[0].WidthMm != 90 {
			t.Fatal("draft content lost or not synchronized", draft)
		}
	}
	var entries []productPackagingEntry
	owner.ok(t, "GET", "/staff/product-packaging", nil, &entries)
	if len(entries) != 1 || entries[0].UsedByProducts != 2 {
		t.Fatal(entries)
	}
	invalid := packaging
	invalid.EmptyGrams = 999400
	if status, _ := owner.call("PUT", "/staff/product-packaging/shared", invalid); status != 422 {
		t.Fatal("invalid draft gross weight did not block update", status)
	}
	owner.ok(t, "GET", "/staff/product-packaging", nil, &entries)
	if entries[0].EmptyGrams != 200 {
		t.Fatal("failed update changed catalog", entries)
	}
	owner.ok(t, "GET", "/products/turmeric", nil, &product)
	if product.Packages[0].ShippingGrams != 700 {
		t.Fatal("failed update partially changed product", product)
	}
	owner.ok(t, "POST", "/staff/products/turmeric/publish", nil, nil)
	owner.ok(t, "GET", "/products/turmeric", nil, &product)
	if product.Packages[0].ShippingGrams != 950 || product.Name != "Pending turmeric" {
		t.Fatal("publishing restored stale packaging", product)
	}
}

func TestProductPackagingPermissionsAndValidation(t *testing.T) {
	app := setup(t)
	editor := newClient(t, app.Handler())
	editor.staff(t, "editor")
	operator := newClient(t, app.Handler())
	operator.staff(t, "operator")
	packaging := domain.ProductPackaging{ID: "jar", Name: "Jar", EmptyGrams: 150, LengthMm: 80, WidthMm: 80, HeightMm: 100, VolumeCm3: 640}
	for _, method := range []string{"GET", "PUT"} {
		path := "/staff/product-packaging"
		if method == "PUT" {
			path += "/jar"
		}
		if status, _ := operator.call(method, path, packaging); status != 403 {
			t.Fatal("unauthorized packaging access", method, status)
		}
	}
	editor.ok(t, "PUT", "/staff/product-packaging/jar", packaging, nil)
	var items []domain.ProductPackaging
	editor.ok(t, "GET", "/staff/product-packaging", nil, &items)
	if len(items) != 1 || items[0] != packaging {
		t.Fatal(items)
	}
	packaging.EmptyGrams = -1
	if status, _ := editor.call("PUT", "/staff/product-packaging/jar", packaging); status != 400 {
		t.Fatal("negative weight accepted", status)
	}
	var product domain.Product
	editor.ok(t, "GET", "/products/turmeric", nil, &product)
	product.Packages[0].PackagingID = "jar"
	product.Packages[0].Unit = "l"
	product.Packages[0].Amount = .5
	product.Packages[0].NetGrams = 0
	if status, _ := editor.call("PUT", "/staff/products/turmeric", product); status != 400 {
		t.Fatal("liquid without net weight accepted", status)
	}
	product.Packages[0].NetGrams = 450
	editor.ok(t, "PUT", "/staff/products/turmeric", product, nil)
	var draft []byte
	if err := app.Pool.QueryRow(context.Background(), "SELECT content FROM product_drafts WHERE product_id='turmeric'").Scan(&draft); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(draft, &product); err != nil {
		t.Fatal(err)
	}
	if product.Packages[0].ShippingGrams != 600 {
		t.Fatal("liquid net weight not used", product.Packages[0])
	}
}

func TestPackagingPermissionsAreIndependentOfProducts(t *testing.T) {
	a := setup(t)
	owner := couponOwner(t, a)
	packaging := domain.ProductPackaging{ID: "existing", Name: "Jar", EmptyGrams: 150, LengthMm: 80, WidthMm: 80, HeightMm: 100, VolumeCm3: 640}
	owner.ok(t, "PUT", "/staff/product-packaging/existing", packaging, nil)
	for _, tc := range []struct {
		name               string
		overrides          map[string]bool
		read, create, edit int
	}{
		{"products only", map[string]bool{"products": true, "products.create": true, "products.edit": true}, 200, 403, 403},
		{"packaging view", map[string]bool{"packaging": true}, 200, 403, 403},
		{"packaging create", map[string]bool{"packaging": true, "packaging.create": true}, 200, 200, 403},
		{"packaging edit", map[string]bool{"packaging": true, "packaging.edit": true}, 200, 403, 200},
		{"section denied", map[string]bool{"packaging": false, "packaging.create": true, "packaging.edit": true}, 403, 403, 403},
	} {
		t.Run(tc.name, func(t *testing.T) {
			staff, id := testStaff(t, a, "salesperson", nil)
			raw, _ := json.Marshal(tc.overrides)
			if _, err := a.Pool.Exec(context.Background(), "UPDATE staff SET permission_overrides=$1 WHERE id=$2", raw, id); err != nil {
				t.Fatal(err)
			}
			for _, request := range []struct {
				method, path string
				want         int
			}{
				{"GET", "/staff/product-packaging", tc.read},
				{"PUT", "/staff/product-packaging/" + id, tc.create},
				{"PUT", "/staff/product-packaging/existing", tc.edit},
			} {
				if status, _ := staff.call(request.method, request.path, packaging); status != request.want {
					t.Fatalf("%s %s: got %d, want %d", request.method, request.path, status, request.want)
				}
			}
		})
	}
}
