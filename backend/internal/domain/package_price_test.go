package domain

import "testing"

func TestDiscountedPackageRoundsUpToThousandToman(t *testing.T) {
	for _, tt := range []struct {
		name                 string
		price, percent, want int64
	}{
		{"fractional thousand", 470000, 10, 430000},
		{"exact thousand", 500000, 10, 450000},
		{"round per package", 470000, 17, 400000},
		{"undiscounted unchanged", 473210, 0, 473210},
		{"never exceeds original", 9990, 1, 9990},
		{"zero", 0, 10, 0},
		{"maximum supported package price", 100000000000, 1, 99000000000},
	} {
		t.Run(tt.name, func(t *testing.T) {
			p := Product{DiscountPercent: tt.percent}
			if got := p.PackagePrice(Package{PriceRials: tt.price}); got != tt.want {
				t.Fatalf("got %d, want %d", got, tt.want)
			}
		})
	}
}
