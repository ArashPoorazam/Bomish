package domain

import (
	"bomish/internal/packing"
	"fmt"
	"strings"
)

func (p Package) MeasurementIssues() []string {
	out := []string{}
	for _, v := range []struct {
		name string
		n    int64
	}{{"طول", p.LengthMm}, {"عرض", p.WidthMm}, {"ارتفاع", p.HeightMm}} {
		if v.n < 1 || v.n > 3000 {
			out = append(out, v.name)
		}
	}
	if p.ShippingGrams < 1 || p.ShippingGrams > 1000000 || ((p.Unit == "g" || p.Unit == "kg") && float64(p.ShippingGrams) < p.Amount*map[string]float64{"g": 1, "kg": 1000}[p.Unit]) {
		out = append(out, "وزن بسته آماده ارسال")
	}
	if !p.ShippingVerified {
		out = append(out, "تأیید اندازه‌گیری")
	}
	return out
}
func (p Package) GrossWeight() (int64, error) {
	if e := p.ValidateMeasurements(true); e != nil {
		return 0, e
	}
	return p.ShippingGrams, nil
}
func (p Package) ValidateMeasurements(complete bool) error {
	if complete {
		if issues := p.MeasurementIssues(); len(issues) > 0 {
			return fmt.Errorf("بسته %s: %s", p.Label(), strings.Join(issues, "، "))
		}
		return nil
	}
	if p.LengthMm < 0 || p.LengthMm > 3000 || p.WidthMm < 0 || p.WidthMm > 3000 || p.HeightMm < 0 || p.HeightMm > 3000 || p.ShippingGrams < 0 || p.ShippingGrams > 1000000 {
		return fmt.Errorf("بسته %s: ابعاد باید ۱ تا ۳۰۰۰ میلی‌متر و وزن ۱ تا ۱۰۰۰۰۰۰ گرم باشد", p.Label())
	}
	if p.ShippingGrams > 0 && (p.Unit == "g" || p.Unit == "kg") && float64(p.ShippingGrams) < p.Amount*map[string]float64{"g": 1, "kg": 1000}[p.Unit] {
		return fmt.Errorf("بسته %s: وزن ناخالص کمتر از وزن محصول است", p.Label())
	}
	return nil
}

type DeliveryEvent struct {
	Status    string `json:"status"`
	CreatedAt string `json:"createdAt"`
}
type CustomerParcel struct {
	ID          string `json:"id"`
	Tracking    string `json:"tracking"`
	TrackingURL string `json:"trackingUrl"`
}

// Delivery is the allowlisted customer projection. Staff-only financial/operational data lives elsewhere.
type CourierContact struct {
	Name  string `json:"name"`
	Phone string `json:"phone"`
}

type Delivery struct {
	Courier   *CourierContact  `json:"courier,omitempty"`
	Method    string           `json:"method"`
	Service   string           `json:"service"`
	Status    string           `json:"status"`
	Simulated bool             `json:"simulated"`
	Parcels   []CustomerParcel `json:"parcels"`
	Events    []DeliveryEvent  `json:"events"`
}

func (p Package) PackingItem(productID, label string, unit int, price int64) packing.Item {
	return packing.Item{ProductID: productID, PackageID: p.ID, Label: label + " · " + p.Label(), Unit: unit, Size: packing.Size{Length: p.LengthMm, Width: p.WidthMm, Height: p.HeightMm}, Grams: p.ShippingGrams, PriceRials: price}
}
