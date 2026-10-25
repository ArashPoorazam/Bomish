package app

import (
	"fmt"
	"os"
	"strconv"

	"bomish/internal/packing"
)

type boxDefaults struct {
	WallMm  int64 `json:"wallMm"`
	InsetMm int64 `json:"insetMm"`
}

func configuredBoxDefaults() (boxDefaults, error) {
	d := boxDefaults{WallMm: 6, InsetMm: 10}
	for name, value := range map[string]*int64{
		"SHIPPING_BOX_WALL_MM":  &d.WallMm,
		"SHIPPING_BOX_INSET_MM": &d.InsetMm,
	} {
		if raw := os.Getenv(name); raw != "" {
			n, err := strconv.ParseInt(raw, 10, 64)
			if err != nil || n < 0 || n > 100 {
				return d, fmt.Errorf("%s must be an integer between 0 and 100 millimeters", name)
			}
			*value = n
		}
	}
	return d, nil
}

// Derive geometry on both reads and writes, including existing saved cartons.
// Browser-supplied internal dimensions and old weight limits are not authoritative.
func applyBoxDefaults(c *calculatedConfig) error {
	d, err := configuredBoxDefaults()
	if err != nil {
		return err
	}
	for i := range c.Boxes {
		b := &c.Boxes[i]
		b.Inside = packing.Size{Length: b.Outside.Length - 2*d.WallMm, Width: b.Outside.Width - 2*d.WallMm, Height: b.Outside.Height - 2*d.WallMm}
		b.InsetMm = d.InsetMm
		b.FillerGrams = 0
		b.MaxGrams = 0 // Zero means no carton-specific weight limit.
	}
	return nil
}
