package packing

import (
	"encoding/json"
	"testing"
)

func box(l, w, h int64) Box {
	return Box{ID: "box", Name: "test", Inside: Size{l, w, h}, Outside: Size{l, w, h}, EmptyGrams: 10, MaxGrams: 5000, FillerGrams: 5, Active: true, Verified: true, PostalSizeID: "1"}
}
func item(id string, l, w, h, g int64) Item {
	return Item{ProductID: "p", PackageID: id, Size: Size{l, w, h}, Grams: g}
}
func TestPackingGeometry(t *testing.T) {
	tests := []struct {
		name  string
		items []Item
		box   Box
		count int
		fail  bool
	}{{"exact", []Item{item("a", 100, 80, 50, 100)}, box(100, 80, 50), 1, false}, {"rotation", []Item{item("a", 80, 100, 50, 100)}, box(100, 80, 50), 1, false}, {"no tipping", []Item{item("a", 50, 50, 110, 100)}, box(120, 60, 60), 0, true}, {"stacking", []Item{item("a", 100, 100, 50, 100), item("b", 100, 100, 50, 100)}, box(100, 100, 100), 1, false}, {"two parcels", []Item{item("a", 100, 100, 60, 100), item("b", 100, 100, 60, 100)}, box(100, 100, 100), 2, false}, {"weight", []Item{item("a", 10, 10, 10, 5000)}, box(100, 100, 100), 0, true}, {"volume is not fit", []Item{item("a", 110, 10, 10, 100)}, box(100, 100, 100), 0, true}}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			p, e := Plan(tt.items, []Box{tt.box})
			if (e != nil) != tt.fail {
				t.Fatalf("%v", e)
			}
			if e != nil {
				return
			}
			if len(p) != tt.count {
				t.Fatalf("parcels %d", len(p))
			}
			if e = ValidateCorrections(p, tt.items); e != nil {
				t.Fatal(e)
			}
			for _, parcel := range p {
				weight := tt.box.EmptyGrams + tt.box.FillerGrams
				for _, v := range parcel.Placements {
					weight += v.Item.Grams
				}
				if weight != parcel.GrossGrams {
					t.Fatal("packaging added incorrectly")
				}
			}
			a, _ := json.Marshal(p)
			again, _ := Plan(tt.items, []Box{tt.box})
			b, _ := json.Marshal(again)
			if string(a) != string(b) {
				t.Fatal("non deterministic")
			}
		})
	}
}
func TestPackingSupportPaddingAndBounds(t *testing.T) {
	b := box(100, 100, 100)
	b.InsetMm = 5
	if _, e := Plan([]Item{item("a", 100, 100, 10, 10)}, []Box{b}); e == nil {
		t.Fatal("padding ignored")
	}
	base := Placement{Item: item("a", 50, 100, 20, 10)}
	above := Placement{Item: item("b", 100, 100, 20, 10), Z: 20}
	if valid(above, []Placement{base}, Size{100, 100, 100}) {
		t.Fatal("unsupported bridge accepted")
	}
	right := base
	right.X = 50
	if !valid(above, []Placement{base, right}, Size{100, 100, 100}) {
		t.Fatal("full coplanar support rejected")
	}
	above.Z = 10
	if valid(above, []Placement{base}, Size{100, 100, 100}) {
		t.Fatal("overlap accepted")
	}
	units := make([]Item, 501)
	if _, e := Plan(units, []Box{b}); e == nil {
		t.Fatal("unbounded units")
	}
	many := []Item{}
	for i := 0; i < 21; i++ {
		v := item("a", 100, 100, 100, 100)
		v.Unit = i
		many = append(many, v)
	}
	if _, e := Plan(many, []Box{box(100, 100, 100)}); e == nil {
		t.Fatal("unbounded parcels")
	}
	attempts := MaxAttempts
	_, e := fit([]Item{item("a", 10, 10, 10, 1)}, box(100, 100, 100), &attempts)
	if e == nil {
		t.Fatal("work budget ignored")
	}
}
func TestPackingSelectionAndManualAllocation(t *testing.T) {
	small := box(100, 100, 100)
	small.ID = "small"
	large := box(200, 200, 200)
	large.ID = "large"
	items := []Item{item("a", 90, 90, 90, 100)}
	p, e := Plan(items, []Box{large, small})
	if e != nil || p[0].Box.ID != "small" {
		t.Fatal("smallest exterior box not selected")
	}
	p[0].Manual = true
	p[0].Confirmed = true
	p[0].MeasuredGrams = p[0].GrossGrams + 1
	if e = ValidateCorrections(p, items); e != nil {
		t.Fatal(e)
	}
	p[0].Placements = append(p[0].Placements, p[0].Placements[0])
	if ValidateCorrections(p, items) == nil {
		t.Fatal("duplicate allocation")
	}
}
