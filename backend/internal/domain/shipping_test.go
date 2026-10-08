package domain

import "testing"

func TestGrossWeightIsDistinctAndValidated(t *testing.T) {
	p := Package{ID: "a", Amount: .5, Unit: "kg", ShippingGrams: 650, LengthMm: 100, WidthMm: 90, HeightMm: 80, ShippingVerified: true}
	if p.Weight() != 500 {
		t.Fatal("net weight changed")
	}
	if w, e := p.GrossWeight(); e != nil || w != 650 {
		t.Fatal(w, e)
	}
	for _, mutate := range []func(*Package){func(p *Package) { p.ShippingGrams = 499 }, func(p *Package) { p.LengthMm = 0 }, func(p *Package) { p.WidthMm = 3001 }, func(p *Package) { p.HeightMm = -1 }, func(p *Package) { p.ShippingGrams = 1000001 }, func(p *Package) { p.ShippingVerified = false }} {
		v := p
		mutate(&v)
		if _, e := v.GrossWeight(); e == nil {
			t.Fatalf("invalid accepted %+v", v)
		}
	}
	legacy := Package{ID: "legacy", Amount: 100, Unit: "g"}
	if legacy.ValidateMeasurements(false) != nil {
		t.Fatal("blank draft rejected")
	}
	if _, e := legacy.GrossWeight(); e == nil {
		t.Fatal("legacy fabricated readiness")
	}
	legacy.LengthMm = 30
	if legacy.ValidateMeasurements(false) != nil {
		t.Fatal("partial draft rejected")
	}
}
