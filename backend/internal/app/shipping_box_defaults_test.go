package app

import (
	"testing"

	"bomish/internal/packing"
)

func TestBoxDefaultsDeriveExistingCartons(t *testing.T) {
	t.Setenv("SHIPPING_BOX_WALL_MM", "")
	t.Setenv("SHIPPING_BOX_INSET_MM", "")
	c := calculatedConfig{Boxes: []packing.Box{{Outside: packing.Size{Length: 300, Width: 200, Height: 150}, MaxGrams: 5000, FillerGrams: 100}}}
	if err := applyBoxDefaults(&c); err != nil {
		t.Fatal(err)
	}
	b := c.Boxes[0]
	if b.Inside != (packing.Size{Length: 288, Width: 188, Height: 138}) || b.Usable() != (packing.Size{Length: 268, Width: 168, Height: 118}) || b.MaxGrams != 0 || b.FillerGrams != 0 {
		t.Fatalf("unexpected carton: %+v", b)
	}
	t.Setenv("SHIPPING_BOX_WALL_MM", "4")
	t.Setenv("SHIPPING_BOX_INSET_MM", "5")
	if err := applyBoxDefaults(&c); err != nil {
		t.Fatal(err)
	}
	if c.Boxes[0].Usable().Length != 282 {
		t.Fatal("configured dimensions not applied")
	}
	t.Setenv("SHIPPING_BOX_WALL_MM", "-1")
	if err := applyBoxDefaults(&c); err == nil {
		t.Fatal("invalid configuration accepted")
	}
}
