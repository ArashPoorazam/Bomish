package domain

import "testing"

func TestNormalizeAndPhones(t *testing.T) {
	for _, c := range [][2]string{{"كركم ي", "کرکم ی"}, {"  زرد‌چوبه  ", "زرد چوبه"}, {"۱۲٣٤۵", "12345"}} {
		if got := Normalize(c[0]); got != c[1] {
			t.Fatalf("%q -> %q", c[0], got)
		}
	}
	for _, s := range []string{"۰۹۱۲۱۲۳۴۵۶۷", "+989121234567", "00989121234567"} {
		if got := Phone(s); got != "09121234567" || !ValidPhone(got) {
			t.Fatal(got)
		}
	}
	if ValidPhone("0912abc4567") {
		t.Fatal("accepted non digits")
	}
}
func TestMoneyAndWeights(t *testing.T) {
	cases := []struct{ price, g, want int64 }{{2800000, 250, 700000}, {2800000, 1500, 4200000}, {2800000, 10000, 28000000}, {10001, 500, 5000}, {10010, 500, 5010}}
	for _, c := range cases {
		if got := Total(c.price, c.g); got != c.want {
			t.Fatalf("%+v got %d", c, got)
		}
	}
	p := Product{MinGrams: 100, StepGrams: 100, MaxGrams: 25000}
	for _, g := range []int64{100, 1500, 10000, 25000} {
		if e := ValidateWeight(p, g); e != nil {
			t.Fatal(e)
		}
	}
	for _, g := range []int64{-1, 0, 50, 250, 25001} {
		if ValidateWeight(p, g) == nil {
			t.Fatalf("accepted %d", g)
		}
	}
}
func TestPublishRequirements(t *testing.T) {
	p := Product{Name: "دارچین", Slug: "cinnamon", CategoryID: "spices", MinGrams: 100, StepGrams: 100, MaxGrams: 25000}
	if p.Validate(false) != nil {
		t.Fatal("draft rejected")
	}
	if p.Validate(true) == nil {
		t.Fatal("incomplete published")
	}
	p.PriceRials = 1000
	p.Description = "شرح"
	p.Summary = "خلاصه"
	p.Images = []string{"/images/spices.png"}
	if e := p.Validate(true); e != nil {
		t.Fatal(e)
	}
	p.Nutrients = []Nutrient{{Name: "پروتئین", Value: "۱ گرم"}}
	if p.Validate(true) == nil {
		t.Fatal("nutrient source required")
	}
	p.NutrientSource = "source"
	p.Images = []string{"javascript:alert(1)"}
	if p.Validate(true) == nil {
		t.Fatal("unsafe image accepted")
	}
}
