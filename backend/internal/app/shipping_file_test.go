package app

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"bomish/internal/security"
)

func TestShippingFileParsing(t *testing.T) {
	previous := shippingTechnical{Localities: []locality{}, Snapp: providerConfig{Service: "saved"}}
	for _, input := range []string{`null`, `[]`, `{"mode":null}`, `{"mod":"calculated"}`, `{"snapp":{"apiKey":"secret"}}`, `{} {}`} {
		if _, err := mergeShippingFile([]byte(input), previous); err == nil {
			t.Fatalf("accepted %s", input)
		}
	}
	next, err := mergeShippingFile([]byte(`{"snapp":{"shopId":"new"}}`), previous)
	if err != nil || next.Snapp.Service != "saved" || next.Snapp.ShopID != "new" {
		t.Fatal(next, err)
	}
	previous.Localities = []locality{{ID: "old", ProvinceID: "old-province", City: "old-city", Verified: true}}
	next, err = mergeShippingFile([]byte(`{"localities":[{"id":"new"}]}`), previous)
	if err != nil || next.Localities[0].City != "" || next.Localities[0].Verified {
		t.Fatal("array inherited old values", next, err)
	}
	for _, input := range []string{`{"mode":"legacy"}`, `{"mode":"calculated"}`, `{"rules":[]}`, `{"packagingGrams":200}`} {
		if _, err := mergeShippingFile([]byte(input), previous); err == nil {
			t.Fatalf("retired setting accepted: %s", input)
		}
	}

}

func TestShippingFileImportPreservesMerchantSettingsAndVersions(t *testing.T) {
	a, owner, customer, address := shippingFixture(t)
	ctx := context.Background()
	var before shippingConfig
	owner.ok(t, "GET", "/staff/shipping", nil, &before)
	var quote quoteResult
	customer.ok(t, "POST", "/checkout/quote", shippingQuoteInput{Address: address}, &quote)
	path := filepath.Join(t.TempDir(), "shipping.json")
	apply := func(raw []byte) error {
		t.Helper()
		if err := os.WriteFile(path, raw, 0600); err != nil {
			t.Fatal(err)
		}
		return a.ApplyShippingConfig(ctx, path)
	}
	if err := apply([]byte(`{"snapp":{"shopId":"file-account"}}`)); err != nil {
		t.Fatal(err)
	}
	var after shippingConfig
	owner.ok(t, "GET", "/staff/shipping", nil, &after)
	if after.Version != before.Version+1 || after.Snapp.ShopID != "file-account" {
		t.Fatal(after)
	}
	if !reflect.DeepEqual(after.Origin, before.Origin) || !reflect.DeepEqual(after.Boxes, before.Boxes) || after.FreeShippingRials != before.FreeShippingRials || after.SupportURL != before.SupportURL || after.OriginRevision != before.OriginRevision {
		t.Fatal("merchant settings overwritten")
	}
	if code, _ := owner.call("PUT", "/staff/shipping", before); code != 409 {
		t.Fatal("stale browser draft accepted", code)
	}
	body := map[string]any{"address": address, "shippingQuoteId": quote.ShippingQuoteID, "expectedTotalRials": quote.TotalRials, "idempotencyKey": security.Token()}
	if code, _ := customer.call("POST", "/checkout", body); code != 409 {
		t.Fatal("old quote accepted", code)
	}
	var exported bytes.Buffer
	if err := a.ExportShippingConfig(ctx, &exported); err != nil {
		t.Fatal(err)
	}
	if err := apply(exported.Bytes()); err != nil {
		t.Fatal(err)
	}
	if err := apply([]byte(`{}`)); err != nil {
		t.Fatal(err)
	}
	var unchanged shippingConfig
	owner.ok(t, "GET", "/staff/shipping", nil, &unchanged)
	if unchanged.Version != after.Version {
		t.Fatal("unchanged restart invalidates quotes")
	}
	if err := apply([]byte(`{"snapp":{"shopId":"must-rollback"},"rules":[{"province":"تهران","maxGrams":1,"feeRials":-1}]}`)); err == nil {
		t.Fatal("invalid file accepted")
	}
	owner.ok(t, "GET", "/staff/shipping", nil, &unchanged)
	if unchanged.Version != after.Version || unchanged.Snapp.ShopID != after.Snapp.ShopID {
		t.Fatal("failed import changed store")
	}
	// Even a crafted browser request can only update merchant-owned fields.
	after.Snapp.ShopID = "browser-account"
	after.FreeShippingRials = 2000000
	owner.ok(t, "PUT", "/staff/shipping", after, nil)
	owner.ok(t, "GET", "/staff/shipping", nil, &unchanged)
	if unchanged.Snapp.ShopID != "file-account" || unchanged.FreeShippingRials != 2000000 {
		t.Fatal("browser overwrote file-owned settings")
	}
	var count int
	if err := a.Pool.QueryRow(ctx, "SELECT count(*) FROM audit_events WHERE action='shipping.config_file'").Scan(&count); err != nil || count != 2 {
		t.Fatal("missing or duplicate import audit", count, err)
	}
	var snapshot shippingTechnical
	if err := json.Unmarshal(exported.Bytes(), &snapshot); err != nil || snapshot.Snapp.ShopID != "file-account" {
		t.Fatal("export mismatch", err)
	}
}

func TestShippingFileAllowsIncompleteSetup(t *testing.T) {
	a := setup(t)
	path := filepath.Join(t.TempDir(), "shipping.json")
	if err := os.WriteFile(path, []byte(`{"snapp":{"shopId":"setup-in-progress"}}`), 0600); err != nil {
		t.Fatal(err)
	}
	if err := a.ApplyShippingConfig(context.Background(), path); err != nil {
		t.Fatal(err)
	}
	c, err := readShippingConfig(context.Background(), a.Pool, false)
	if err != nil || c.Snapp.ShopID != "setup-in-progress" {
		t.Fatal(c, err)
	}
	if err := a.ApplyShippingConfig(context.Background(), path+".missing"); err == nil {
		t.Fatal("missing file ignored")
	}
}

func TestPostalBoxMappingsBelongToFile(t *testing.T) {
	a, owner, _, _ := shippingFixture(t)
	ctx := context.Background()
	var cfg shippingConfig
	owner.ok(t, "GET", "/staff/shipping", nil, &cfg)
	cfg.Boxes[0].PostalSizeID = "forged-browser-size"
	cfg.Boxes[0].Name = "renamed carton"
	owner.ok(t, "PUT", "/staff/shipping", cfg, nil)
	owner.ok(t, "GET", "/staff/shipping", nil, &cfg)
	if cfg.Boxes[0].PostalSizeID != "1" || cfg.Boxes[0].Name != "renamed carton" {
		t.Fatal("browser changed provider mapping or lost merchant edit")
	}
	path := filepath.Join(t.TempDir(), "shipping.json")
	apply := func(raw string) error {
		t.Helper()
		if err := os.WriteFile(path, []byte(raw), 0600); err != nil {
			t.Fatal(err)
		}
		return a.ApplyShippingConfig(ctx, path)
	}
	if err := apply(`{"postalBoxSizes":{"box-1":"provider-size-2"}}`); err != nil {
		t.Fatal(err)
	}
	owner.ok(t, "GET", "/staff/shipping", nil, &cfg)
	if cfg.Boxes[0].PostalSizeID != "provider-size-2" || cfg.Boxes[0].Name != "renamed carton" {
		t.Fatal("file failed to map existing carton")
	}
	version := cfg.Version
	if err := apply(`{"postalBoxSizes":{"box-1":"provider-size-2"}}`); err != nil {
		t.Fatal(err)
	}
	if err := apply(`{"postalBoxSizes":{"missing":"bad"}}`); err == nil {
		t.Fatal("unknown box accepted")
	}
	if err := apply(`{"postalBoxSizes":{"box-1":" spaced "}}`); err == nil {
		t.Fatal("invalid provider size accepted")
	}
	owner.ok(t, "GET", "/staff/shipping", nil, &cfg)
	if cfg.Version != version || cfg.Boxes[0].PostalSizeID != "provider-size-2" {
		t.Fatal("unchanged or rejected mapping changed settings")
	}
	var exported bytes.Buffer
	if err := a.ExportShippingConfig(ctx, &exported); err != nil {
		t.Fatal(err)
	}
	var technical shippingTechnical
	if err := json.Unmarshal(exported.Bytes(), &technical); err != nil || technical.PostalBoxSizes["box-1"] != "provider-size-2" {
		t.Fatal("export omitted mapping", err)
	}
	if err := apply(`{"postalBoxSizes":{"box-1":""}}`); err != nil {
		t.Fatal(err)
	}
	owner.ok(t, "GET", "/staff/shipping", nil, &cfg)
	if cfg.Boxes[0].PostalSizeID != "" {
		t.Fatal("mapping not cleared")
	}
}
