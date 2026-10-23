package domain

import (
	"fmt"
	"strings"
)

type ProductPackaging struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	EmptyGrams int64  `json:"emptyGrams"`
	LengthMm   int64  `json:"lengthMm"`
	WidthMm    int64  `json:"widthMm"`
	HeightMm   int64  `json:"heightMm"`
	VolumeCm3  int64  `json:"volumeCm3"`
}

func (packaging ProductPackaging) Validate() error {
	if packaging.ID == "" || len(packaging.ID) > 100 || strings.TrimSpace(packaging.Name) == "" || len(packaging.Name) > 300 {
		return fmt.Errorf("شناسه و نام بسته‌بندی معتبر وارد کنید")
	}
	if packaging.EmptyGrams < 1 || packaging.EmptyGrams > 1000000 || packaging.VolumeCm3 < 1 || packaging.VolumeCm3 > 27000000 {
		return fmt.Errorf("وزن بسته‌بندی باید ۱ تا ۱۰۰۰۰۰۰ گرم و حجم ۱ تا ۲۷۰۰۰۰۰۰ سانتی‌متر مکعب باشد")
	}
	for _, dimension := range []int64{packaging.LengthMm, packaging.WidthMm, packaging.HeightMm} {
		if dimension < 1 || dimension > 3000 {
			return fmt.Errorf("ابعاد بسته‌بندی باید ۱ تا ۳۰۰۰ میلی‌متر باشد")
		}
	}
	return nil
}

func (pack *Package) ApplyPackaging(packaging ProductPackaging) error {
	if err := packaging.Validate(); err != nil {
		return err
	}
	netGrams := pack.NetGrams
	if pack.Unit == "g" || pack.Unit == "kg" {
		netGrams = pack.Weight()
	}
	if netGrams < 1 || netGrams > 1000000-packaging.EmptyGrams {
		return fmt.Errorf("بسته %s: وزن محصول را وارد کنید؛ وزن محصول و بسته‌بندی باید حداکثر ۱۰۰۰۰۰۰ گرم باشد", pack.Label())
	}
	pack.PackagingID = packaging.ID
	pack.Packaging = &packaging
	pack.NetGrams = netGrams
	pack.ShippingGrams = netGrams + packaging.EmptyGrams
	pack.LengthMm = packaging.LengthMm
	pack.WidthMm = packaging.WidthMm
	pack.HeightMm = packaging.HeightMm
	pack.ShippingVerified = true
	return nil
}
