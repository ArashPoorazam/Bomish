package domain

import (
	"regexp"
	"testing"
)

func TestPostalTracking(t *testing.T) {
	for _, tc := range []struct {
		code  string
		valid bool
	}{
		{"1234567890", true}, {"123456789012345678901234567890", true},
		{"123456789", false}, {"1234567890123456789012345678901", false},
		{"۱۲۳۴۵۶۷۸۹۰", false}, {"123456789x", false}, {"1234567890\n", false},
	} {
		if ValidPostalTracking(tc.code) != tc.valid {
			t.Fatal(tc.code)
		}
	}
	if got := PostalTrackingURL("1234567890", "https://evil.example/{tracking}"); got != "https://pishkhan24.com/posttracking/?barcode=1234567890" {
		t.Fatal(got)
	}
}

func BenchmarkPostalTracking(b *testing.B) {
	b.Run("previous_regexp_per_call", func(b *testing.B) {
		b.ReportAllocs()
		for b.Loop() {
			if !regexp.MustCompile(`^[0-9]{10,30}$`).MatchString("12345678901234567890") {
				b.Fatal("invalid")
			}
		}
	})
	b.Run("ascii_validation", func(b *testing.B) {
		b.ReportAllocs()
		for b.Loop() {
			if !ValidPostalTracking("12345678901234567890") {
				b.Fatal("invalid")
			}
		}
	})
}
