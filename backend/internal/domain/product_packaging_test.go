package domain

import "testing"

func TestProductPackagingGrossWeight(t *testing.T) {
	packaging := ProductPackaging{ID: "jar", Name: "شیشه", EmptyGrams: 150, LengthMm: 80, WidthMm: 80, HeightMm: 100, VolumeCm3: 640}
	for _, scenario := range []struct {
		unit   string
		amount float64
		net    int64
	}{
		{"g", 500, 500}, {"kg", .5, 500}, {"ml", 500, 450}, {"l", .5, 450},
	} {
		t.Run(scenario.unit, func(t *testing.T) {
			pack := Package{ID: "unit", Unit: scenario.unit, Amount: scenario.amount, NetGrams: scenario.net, ShippingGrams: 999999}
			for range 2 {
				if err := pack.ApplyPackaging(packaging); err != nil {
					t.Fatal(err)
				}
				gross, err := pack.GrossWeight()
				if err != nil || gross != scenario.net+150 {
					t.Fatalf("weight = %d, error = %v", gross, err)
				}
				item := pack.PackingItem("product", "Product", 0, 100000)
				if item.Grams != gross || item.Size.Length != 80 || item.Size.Width != 80 || item.Size.Height != 100 {
					t.Fatal(item)
				}
			}
		})
	}
	for _, pack := range []Package{{Unit: "l", Amount: 1}, {Unit: "ml", Amount: 500, NetGrams: -1}, {Unit: "g", Amount: 1000000}} {
		if err := pack.ApplyPackaging(packaging); err == nil {
			t.Fatal("invalid net or total weight accepted", pack)
		}
	}
}

func TestProductPackagingValidation(t *testing.T) {
	valid := ProductPackaging{ID: "jar", Name: "Jar", EmptyGrams: 150, LengthMm: 80, WidthMm: 80, HeightMm: 100, VolumeCm3: 640}
	for _, mutate := range []func(*ProductPackaging){
		func(item *ProductPackaging) { item.Name = "  " },
		func(item *ProductPackaging) { item.EmptyGrams = 0 },
		func(item *ProductPackaging) { item.EmptyGrams = 1000001 },
		func(item *ProductPackaging) { item.WidthMm = -1 },
		func(item *ProductPackaging) { item.LengthMm = 3001 },
		func(item *ProductPackaging) { item.HeightMm = 0 },
		func(item *ProductPackaging) { item.VolumeCm3 = 0 },
		func(item *ProductPackaging) { item.VolumeCm3 = 27000001 },
	} {
		item := valid
		mutate(&item)
		if err := item.Validate(); err == nil {
			t.Fatal("invalid packaging accepted", item)
		}
	}
}
