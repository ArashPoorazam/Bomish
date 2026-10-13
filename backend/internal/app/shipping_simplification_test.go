package app

import (
	"bomish/internal/domain"
	"context"
	"encoding/json"
	"testing"
)

func TestTehranCourierIndependentOfPostalMappings(t *testing.T) {
	a, owner, customer, address := shippingFixture(t)
	var cfg shippingConfig
	owner.ok(t, "GET", "/staff/shipping", nil, &cfg)
	cfg.Localities[0].TapinCity = ""
	cfg.Localities[0].TapinProvince = ""
	cfg.Localities[0].Verified = false
	cfg.Boxes[0].PostalSizeID = ""
	owner.ok(t, "PUT", "/staff/shipping", cfg, nil)
	applyTechnicalFixture(t, a, cfg)
	var q quoteResult
	customer.ok(t, "POST", "/checkout/quote", shippingQuoteInput{Address: address}, &q)
	if q.Method != "snapp" || q.RequiresAcceptance {
		t.Fatalf("postal mapping blocked courier: %+v", q)
	}
	address.PinConfirmed = false
	if status, _ := customer.call("POST", "/checkout/quote", shippingQuoteInput{Address: address}); status != 422 {
		t.Fatal("unmapped postal fallback accepted", status)
	}
}

func TestOtherCityInTehranProvinceUsesPost(t *testing.T) {
	a, owner, customer, address := shippingFixture(t)
	var cfg shippingConfig
	owner.ok(t, "GET", "/staff/shipping", nil, &cfg)
	l := cfg.Localities[0]
	l.ID = "shahriyar"
	l.City = "شهریار"
	l.TapinCity = "3"
	cfg.Localities = append(cfg.Localities, l)
	owner.ok(t, "PUT", "/staff/shipping", cfg, nil)
	applyTechnicalFixture(t, a, cfg)
	address.CityID = l.ID
	address.City = l.City
	var q quoteResult
	customer.ok(t, "POST", "/checkout/quote", shippingQuoteInput{Address: address}, &q)
	if q.Method != "post" || q.RequiresAcceptance {
		t.Fatalf("province confused with city: %+v", q)
	}
}

func TestPostalAcceptancePreservesExactQuote(t *testing.T) {
	a, _, customer, address := shippingFixture(t)
	address.PinConfirmed = false
	var q quoteResult
	customer.ok(t, "POST", "/checkout/quote", shippingQuoteInput{Address: address, AcceptFallback: true}, &q)
	if !q.RequiresAcceptance {
		t.Fatal("boolean accepted unseen quote")
	}
	original := q
	input := shippingQuoteInput{Address: address, Method: "post", AcceptFallback: true, AcceptedQuoteID: q.ShippingQuoteID}
	stranger := newClient(t, a.Handler())
	stranger.login(t, "09121110008")
	if status, _ := stranger.call("POST", "/checkout/quote", input); status != 409 {
		t.Fatal("foreign acceptance", status)
	}
	changed := input
	changed.Address.Street += " واحد دو"
	if status, _ := customer.call("POST", "/checkout/quote", changed); status != 409 {
		t.Fatal("changed address accepted", status)
	}
	customer.ok(t, "POST", "/checkout/quote", input, &q)
	if q.RequiresAcceptance || q.TotalRials != original.TotalRials || q.ExpiresAt != original.ExpiresAt || q.ShippingQuoteID != original.ShippingQuoteID {
		t.Fatal("acceptance changed quoted terms", q)
	}
	customer.ok(t, "POST", "/checkout/quote", input, &q)
	a.Pool.Exec(context.Background(), "UPDATE shipping_quotes SET expires_at=now()-interval '1 second' WHERE id=$1", q.ShippingQuoteID)
	if status, _ := customer.call("POST", "/checkout/quote", input); status != 409 {
		t.Fatal("expired acceptance", status)
	}
}

func TestPackageEditorConfirmationIsExplicit(t *testing.T) {
	a, owner, _, _ := shippingFixture(t)
	var p domain.Product
	owner.ok(t, "GET", "/products/turmeric", nil, &p)
	for i := range p.Packages {
		p.Packages[i].ShippingVerified = false
	}
	owner.ok(t, "PUT", "/staff/products/"+p.ID, p, nil)
	read := func() domain.Product {
		var raw []byte
		if err := a.Pool.QueryRow(context.Background(), "SELECT content FROM product_drafts WHERE product_id=$1", p.ID).Scan(&raw); err != nil {
			t.Fatal(err)
		}
		var draft domain.Product
		json.Unmarshal(raw, &draft)
		return draft
	}
	if read().Packages[0].ShippingVerified {
		t.Fatal("ordinary save certified old estimates")
	}
	raw, _ := json.Marshal(p)
	var body map[string]any
	json.Unmarshal(raw, &body)
	body["confirmMeasurements"] = []string{p.Packages[0].ID}
	owner.ok(t, "PUT", "/staff/products/"+p.ID, body, nil)
	if !read().Packages[0].ShippingVerified {
		t.Fatal("explicit valid measurements not recorded")
	}
	p.Packages[0].LengthMm = 0
	raw, _ = json.Marshal(p)
	json.Unmarshal(raw, &body)
	if status, _ := owner.call("PUT", "/staff/products/"+p.ID, body); status != 400 {
		t.Fatal("incomplete measurements confirmed", status)
	}
}

func TestCatalogIsSourcedAndDoesNotCertifyPhysicalBoxes(t *testing.T) {
	entries := shippingBoxCatalog()
	if len(entries) != 9 {
		t.Fatal("missing researched range")
	}
	for _, entry := range entries {
		if entry.SourceURL == "" || entry.Version == "" || !entry.NominalOutside.Valid() {
			t.Fatal("missing catalog provenance", entry)
		}
	}
}

func TestPostalPackingSkipsCourierOnlyBoxes(t *testing.T) {
	_, owner, customer, address := shippingFixture(t)
	var cfg shippingConfig
	owner.ok(t, "GET", "/staff/shipping", nil, &cfg)
	smaller := cfg.Boxes[0]
	smaller.ID = "courier-only"
	smaller.PostalSizeID = ""
	smaller.Inside.Length = 180
	smaller.Inside.Width = 180
	smaller.Inside.Height = 180
	smaller.Outside = smaller.Inside
	cfg.Boxes = append(cfg.Boxes, smaller)
	owner.ok(t, "PUT", "/staff/shipping", cfg, nil)
	address.CityID = "karaj-city"
	address.ProvinceID = "alborz-province"
	address.City = "کرج"
	address.Province = "البرز"
	var q quoteResult
	customer.ok(t, "POST", "/checkout/quote", shippingQuoteInput{Address: address}, &q)
	if q.Method != "post" {
		t.Fatal(q)
	}
}
