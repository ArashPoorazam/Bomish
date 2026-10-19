package app

import (
	"bomish/internal/domain"
	"bomish/internal/packing"
	"context"
	"encoding/json"
	"testing"
)

// Older commerce scenarios use the same calculated-shipping contract as the
// carrier tests. They no longer depend on the removed province tariff API.
func commerceAddress() domain.Address {
	return domain.Address{Recipient: "مشتری", Phone: "09123334444", Province: "البرز", City: "کرج", ProvinceID: "alborz-province", CityID: "karaj-city", Street: "خیابان آزمایشی، پلاک ۱", PostalCode: "1234567890"}
}
func commerceQuote(code string) shippingQuoteInput {
	return shippingQuoteInput{Address: commerceAddress(), Method: "post", DiscountCode: code}
}
func measuredPackages(p []domain.Package) []domain.Package {
	for i := range p {
		p[i].LengthMm = 80
		p[i].WidthMm = 80
		p[i].HeightMm = 100
		p[i].ShippingVerified = true
		if p[i].ShippingGrams == 0 {
			p[i].ShippingGrams = 1500
		}
	}
	return p
}
func setupCommerce(t *testing.T) *App {
	t.Helper()
	a := setup(t)
	t.Setenv("SHIPPING_SIMULATED", "true")
	lat, lng := 35.7, 51.4
	origin := commerceAddress()
	origin.Latitude = &lat
	origin.Longitude = &lng
	origin.PinConfirmed = true
	cfg := calculatedConfig{Version: 2, OriginRevision: 1, Origin: origin,
		Localities: []locality{{ID: "karaj-city", ProvinceID: "alborz-province", Province: "البرز", City: "کرج", TapinCity: "2", TapinProvince: "2", Verified: true}},
		Boxes:      []packing.Box{{ID: "test-box", Name: "کارتن", Inside: packing.Size{Length: 400, Width: 400, Height: 400}, Outside: packing.Size{Length: 412, Width: 412, Height: 412}, EmptyGrams: 100, MaxGrams: 30000, PostalSizeID: "1", Active: true, Verified: true}},
		Tapin:      providerConfig{Enabled: true, Service: "0", ShopID: "sim-shop", Currency: "rial", Verified: true, MaxGrams: 30000, MaxSize: packing.Size{Length: 1000, Width: 1000, Height: 1000}}}
	raw, err := json.Marshal(cfg)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = a.Pool.Exec(context.Background(), "UPDATE shipping_configuration SET version=2,content=$1 WHERE id=true", raw); err != nil {
		t.Fatal(err)
	}
	return a
}

func readyPostal(t *testing.T, staff *client, id string) {
	t.Helper()
	var d deliveryRecord
	staff.ok(t, "GET", "/staff/orders/"+id+"/delivery", nil, &d)
	for i := range d.Parcels {
		d.Parcels[i].Confirmed = true
		d.Parcels[i].MeasuredGrams = d.Parcels[i].GrossGrams
	}
	staff.ok(t, "PUT", "/staff/orders/"+id+"/parcels", map[string]any{"version": d.Version, "parcels": d.Parcels, "reason": "test packing checked"}, &d)
	staff.ok(t, "POST", "/staff/orders/"+id+"/ready", map[string]any{"version": d.Version}, &d)
	for _, parcel := range d.Parcels {
		staff.ok(t, "PATCH", "/staff/orders/"+id+"/parcels/"+parcel.ID, map[string]any{"version": d.Version, "tracking": "123456789012345678901234"}, &d)
	}
}
