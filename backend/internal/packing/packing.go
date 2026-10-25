// Package packing implements bounded, deterministic upright cuboid packing in mm/g.
package packing

import (
	"errors"
	"fmt"
	"slices"
	"sort"
)

const Version = "upright-1"
const MaxUnits = 500
const MaxParcels = 20
const MaxAttempts = 100000

type Size struct {
	Length int64 `json:"lengthMm"`
	Width  int64 `json:"widthMm"`
	Height int64 `json:"heightMm"`
}

func (s Size) Volume() int64 { return s.Length * s.Width * s.Height }
func (s Size) Valid() bool {
	return s.Length > 0 && s.Width > 0 && s.Height > 0 && s.Length <= 3000 && s.Width <= 3000 && s.Height <= 3000
}

type BoxCatalogReference struct {
	ID             string `json:"id"`
	Version        string `json:"version"`
	SourceURL      string `json:"sourceUrl"`
	NominalOutside Size   `json:"nominalOutside"`
}
type Box struct {
	Catalog      *BoxCatalogReference `json:"catalog,omitempty"`
	Simulated    bool                 `json:"simulated,omitempty"`
	ID           string               `json:"id"`
	Name         string               `json:"name"`
	Inside       Size                 `json:"inside"`
	Outside      Size                 `json:"outside"`
	EmptyGrams   int64                `json:"emptyGrams"`
	MaxGrams     int64                `json:"maxGrams"`
	InsetMm      int64                `json:"insetMm"`
	FillerGrams  int64                `json:"fillerGrams"`
	PostalSizeID string               `json:"postalSizeId"`
	Active       bool                 `json:"active"`
	Verified     bool                 `json:"verified"`
}

func (b Box) Usable() Size {
	return Size{b.Inside.Length - 2*b.InsetMm, b.Inside.Width - 2*b.InsetMm, b.Inside.Height - 2*b.InsetMm}
}
func (b Box) Validate() error {
	if b.ID == "" || b.Name == "" || !b.Inside.Valid() || !b.Outside.Valid() || !b.Usable().Valid() || b.Inside.Length > b.Outside.Length || b.Inside.Width > b.Outside.Width || b.Inside.Height > b.Outside.Height || b.InsetMm < 0 || b.EmptyGrams <= 0 || b.FillerGrams < 0 || b.MaxGrams < 0 || (b.MaxGrams > 0 && b.MaxGrams <= b.EmptyGrams+b.FillerGrams) || b.MaxGrams > 1000000 {
		return errors.New("ابعاد، وزن خالی، حاشیه محافظ و ظرفیت کارتن را کامل کنید")
	}
	return nil
}

type Item struct {
	ProductID  string `json:"productId"`
	PackageID  string `json:"packageId"`
	Label      string `json:"label"`
	Unit       int    `json:"unit"`
	Size       Size   `json:"size"`
	Grams      int64  `json:"grams"`
	PriceRials int64  `json:"priceRials"`
}

func (i Item) Key() string { return fmt.Sprintf("%s/%s/%d", i.ProductID, i.PackageID, i.Unit) }

type Placement struct {
	Item    Item  `json:"item"`
	X       int64 `json:"x"`
	Y       int64 `json:"y"`
	Z       int64 `json:"z"`
	Rotated bool  `json:"rotated"`
}

func (p Placement) Size() Size {
	s := p.Item.Size
	if p.Rotated {
		s.Length, s.Width = s.Width, s.Length
	}
	return s
}

type Parcel struct {
	ID              string      `json:"id"`
	Box             Box         `json:"box"`
	Placements      []Placement `json:"placements"`
	GrossGrams      int64       `json:"grossGrams"`
	MeasuredGrams   int64       `json:"measuredGrams"`
	Confirmed       bool        `json:"confirmed"`
	Manual          bool        `json:"manual"`
	Tracking        string      `json:"tracking"`
	ActualCostRials *int64      `json:"actualCostRials"`
}

func (p Parcel) Weight() int64 {
	if p.MeasuredGrams > 0 {
		return p.MeasuredGrams
	}
	return p.GrossGrams
}

type Failure struct {
	Code   string
	Detail string
}

func (e *Failure) Error() string  { return e.Detail }
func fail(code, msg string) error { return &Failure{code, msg} }
func overlap(a, b Placement) bool {
	s, t := a.Size(), b.Size()
	return a.X < b.X+t.Length && b.X < a.X+s.Length && a.Y < b.Y+t.Width && b.Y < a.Y+s.Width && a.Z < b.Z+t.Height && b.Z < a.Z+s.Height
}

// Supports are non-overlapping rectangles, so their clipped areas must cover the entire base.
func supported(p Placement, placed []Placement) bool {
	if p.Z == 0 {
		return true
	}
	s := p.Size()
	var area int64
	for _, v := range placed {
		t := v.Size()
		if v.Z+t.Height != p.Z {
			continue
		}
		l := min(p.X+s.Length, v.X+t.Length) - max(p.X, v.X)
		w := min(p.Y+s.Width, v.Y+t.Width) - max(p.Y, v.Y)
		if l > 0 && w > 0 {
			area += l * w
		}
	}
	return area == s.Length*s.Width
}
func valid(p Placement, placed []Placement, size Size) bool {
	s := p.Size()
	if p.X < 0 || p.Y < 0 || p.Z < 0 || p.X+s.Length > size.Length || p.Y+s.Width > size.Width || p.Z+s.Height > size.Height {
		return false
	}
	for _, v := range placed {
		if overlap(p, v) {
			return false
		}
	}
	return supported(p, placed)
}
func coordinates(placed []Placement, size Size, item Size) ([]int64, []int64, []int64) {
	xs, ys, zs := []int64{0, size.Length - item.Length}, []int64{0, size.Width - item.Width}, []int64{0}
	for _, v := range placed {
		s := v.Size()
		xs = append(xs, v.X, v.X+s.Length, v.X-item.Length)
		ys = append(ys, v.Y, v.Y+s.Width, v.Y-item.Width)
		zs = append(zs, v.Z+s.Height)
	}
	uniq := func(v []int64) []int64 {
		slices.Sort(v)
		out := v[:0]
		for _, n := range v {
			if n >= 0 && (len(out) == 0 || n != out[len(out)-1]) {
				out = append(out, n)
			}
		}
		return out
	}
	return uniq(xs), uniq(ys), uniq(zs)
}
func fit(items []Item, b Box, attempts *int) (Parcel, error) {
	p := Parcel{Box: b, Placements: []Placement{}, GrossGrams: b.EmptyGrams + b.FillerGrams}
	for _, item := range items {
		if b.MaxGrams > 0 && p.GrossGrams+item.Grams > b.MaxGrams {
			continue
		}
		var best *Placement
		for _, rot := range []bool{false, true} {
			cand := Placement{Item: item, Rotated: rot}
			xs, ys, zs := coordinates(p.Placements, b.Usable(), cand.Size())
			found := false
			for _, z := range zs {
				if found {
					break
				}
				for _, y := range ys {
					if found {
						break
					}
					for _, x := range xs {
						*attempts++
						if *attempts > MaxAttempts {
							return p, fail("packing_limit", "محاسبه از حد جستجو گذشت؛ چیدمان دستی لازم است")
						}
						cand.X, cand.Y, cand.Z = x, y, z
						if valid(cand, p.Placements, b.Usable()) {
							v := cand
							if best == nil || v.Z < best.Z || (v.Z == best.Z && (v.Y < best.Y || (v.Y == best.Y && v.X < best.X))) {
								best = &v
							}
							found = true
							break
						}
					}
				}
			}
		}
		if best != nil {
			p.Placements = append(p.Placements, *best)
			p.GrossGrams += item.Grams
		}
	}
	return p, nil
}
func Plan(items []Item, boxes []Box) ([]Parcel, error) {
	if len(items) == 0 {
		return nil, fail("missing_measurements", "سبد خالی است")
	}
	if len(items) > MaxUnits {
		return nil, fail("packing_limit", "تعداد بسته‌ها نیازمند بررسی دستی است")
	}
	remaining := append([]Item(nil), items...)
	seen := map[string]bool{}
	for _, i := range remaining {
		if !i.Size.Valid() || i.Grams < 1 || i.Grams > 1000000 || seen[i.Key()] {
			return nil, fail("missing_measurements", "اندازه یا وزن بسته کامل نیست: "+i.Label)
		}
		seen[i.Key()] = true
	}
	sort.Slice(remaining, func(i, j int) bool {
		a, b := remaining[i], remaining[j]
		if a.Size.Length*a.Size.Width != b.Size.Length*b.Size.Width {
			return a.Size.Length*a.Size.Width > b.Size.Length*b.Size.Width
		}
		if a.Size.Height != b.Size.Height {
			return a.Size.Height > b.Size.Height
		}
		if a.PackageID != b.PackageID {
			return a.PackageID < b.PackageID
		}
		if a.ProductID != b.ProductID {
			return a.ProductID < b.ProductID
		}
		return a.Unit < b.Unit
	})
	active := []Box{}
	for _, b := range boxes {
		if b.Active && b.Verified && b.Validate() == nil {
			active = append(active, b)
		}
	}
	out := []Parcel{}
	attempts := 0
	for len(remaining) > 0 {
		if len(out) >= MaxParcels {
			return nil, fail("packing_limit", "تعداد کارتن‌ها نیازمند بررسی دستی است")
		}
		var best *Parcel
		var bestVolume int64
		for _, b := range active {
			p, e := fit(remaining, b, &attempts)
			if e != nil {
				return nil, e
			}
			var volume int64
			for _, v := range p.Placements {
				volume += v.Item.Size.Volume()
			}
			if len(p.Placements) == 0 {
				continue
			}
			all := len(p.Placements) == len(remaining)
			bestAll := best != nil && len(best.Placements) == len(remaining)
			choose := best == nil || all && !bestAll
			if best != nil && all == bestAll {
				if all {
					choose = b.Outside.Volume() < best.Box.Outside.Volume() || (b.Outside.Volume() == best.Box.Outside.Volume() && (b.EmptyGrams < best.Box.EmptyGrams || (b.EmptyGrams == best.Box.EmptyGrams && b.ID < best.Box.ID)))
				} else {
					choose = volume > bestVolume || (volume == bestVolume && (b.Outside.Volume() < best.Box.Outside.Volume() || (b.Outside.Volume() == best.Box.Outside.Volume() && b.ID < best.Box.ID)))
				}
			}
			if choose {
				best = &p
				bestVolume = volume
			}
		}
		if best == nil {
			return nil, fail("packing_limit", "حداقل یک بسته در کارتن‌های فعال جا نمی‌گیرد یا بیش از ظرفیت وزن دارد")
		}
		best.ID = fmt.Sprintf("parcel-%d", len(out)+1)
		out = append(out, *best)
		used := map[string]bool{}
		for _, p := range best.Placements {
			used[p.Item.Key()] = true
		}
		next := []Item{}
		for _, i := range remaining {
			if !used[i.Key()] {
				next = append(next, i)
			}
		}
		remaining = next
	}
	return out, nil
}

// ValidateCorrections checks exact historical allocation; manual layouts only assert individual fit.
func ValidateCorrections(parcels []Parcel, items []Item) error {
	if len(parcels) == 0 || len(parcels) > MaxParcels {
		return fail("packing_limit", "تعداد کارتن معتبر نیست")
	}
	expected := map[string]Item{}
	for _, i := range items {
		expected[i.Key()] = i
	}
	ids := map[string]bool{}
	for _, p := range parcels {
		if p.ID == "" || ids[p.ID] || p.Box.Validate() != nil || !p.Box.Active || !p.Box.Verified {
			return errors.New("کارتن معتبر و تأییدشده لازم است")
		}
		ids[p.ID] = true
		weight := p.Box.EmptyGrams + p.Box.FillerGrams
		if len(p.Placements) == 0 {
			return errors.New("کارتن خالی مجاز نیست")
		}
		for i, v := range p.Placements {
			want, ok := expected[v.Item.Key()]
			if !ok || want != v.Item {
				return errors.New("هر بسته سفارش باید دقیقاً یک بار ثبت شود")
			}
			delete(expected, v.Item.Key())
			weight += v.Item.Grams
			if p.Manual {
				s := v.Size()
				u := p.Box.Usable()
				if s.Length > u.Length || s.Width > u.Width || s.Height > u.Height || !p.Confirmed {
					return errors.New("جاگیری و چیدمان دستی را تأیید کنید")
				}
			} else if !valid(v, p.Placements[:i], p.Box.Usable()) {
				return errors.New("چیدمان همپوشان یا بدون تکیه‌گاه است")
			}
		}
		if p.GrossGrams != weight || p.Weight() < weight || (p.Box.MaxGrams > 0 && p.Weight() > p.Box.MaxGrams) {
			return errors.New("وزن اندازه‌گیری‌شده یا ظرفیت کارتن معتبر نیست")
		}
	}
	if len(expected) > 0 {
		return errors.New("همه بسته‌های سفارش تخصیص نیافته‌اند")
	}
	return nil
}
