package carrier

import (
	"bomish/internal/packing"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"math/big"
	"net/http"
	"strings"
	"time"
)

// Tapin quotes only the shop flow. Authentication, currency and total field must be
// verified for the merchant; this adapter is not wired to live activation yet.
type Tapin struct {
	Client                   *http.Client
	BaseURL, Token, Currency string
}

func (t Tapin) Quote(ctx context.Context, in Request) (Quote, error) {
	out := Quote{ExpiresAt: time.Now().Add(5 * time.Minute), Components: map[string]int64{}}
	if t.Client == nil || t.Token == "" || in.ShopID == "" || in.ProvinceCode == "" || in.CityCode == "" {
		return out, ErrUnavailable
	}
	if (t.Currency != "rial" && t.Currency != "toman") || len(in.Parcels) == 0 || len(in.Parcels) > packing.MaxParcels {
		return out, ErrUnavailable
	}
	names := strings.Fields(in.Destination.Recipient)
	if len(names) < 2 {
		return out, errors.New("برای استعلام پستی نام و نام خانوادگی گیرنده را کامل کنید")
	}
	client := *t.Client
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	if client.Timeout == 0 {
		client.Timeout = 12 * time.Second
	}
	for _, p := range in.Parcels {
		products := []map[string]any{}
		for _, v := range p.Placements {
			products = append(products, map[string]any{"count": 1, "discount": 0, "price": tapinProductPrice(v.Item.PriceRials, t.Currency), "title": v.Item.Label, "weight": v.Item.Grams, "product_id": nil})
		}
		body := map[string]any{"shop_id": in.ShopID, "address": in.Destination.Street, "city_code": in.CityCode, "province_code": in.ProvinceCode, "employee_code": "-1", "first_name": names[0], "last_name": strings.Join(names[1:], " "), "mobile": in.Destination.Phone, "postal_code": in.Destination.PostalCode, "pay_type": "1", "order_type": in.Service, "package_weight": p.Weight() - sumWeight(p), "box_id": p.Box.PostalSizeID, "products": products}
		raw, _ := json.Marshal(body)
		req, e := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(t.BaseURL, "/")+"/api/v2/public/order/post/check-price/", bytes.NewReader(raw))
		if e != nil {
			return out, ErrUnavailable
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", t.Token)
		res, e := client.Do(req)
		if e != nil {
			return out, ErrUnavailable
		}
		var result struct {
			Returns struct {
				Status int `json:"status"`
			} `json:"returns"`
			Entries struct {
				Total json.Number `json:"total_price"`
			} `json:"entries"`
		}
		response, e := io.ReadAll(io.LimitReader(res.Body, (1<<20)+1))
		res.Body.Close()
		if e != nil || len(response) > 1<<20 || res.StatusCode != 200 || json.Unmarshal(response, &result) != nil || result.Returns.Status != 200 {
			return out, ErrUnavailable
		}
		amount, e := tapinMoney(result.Entries.Total, t.Currency)
		if e != nil {
			return out, ErrUnavailable
		}
		out.CostRials += amount
		if out.CostRials > 100000000000 {
			return Quote{}, ErrUnavailable
		}
		out.Components[p.ID] = amount
	}
	return out, nil
}

func sumWeight(p packing.Parcel) int64 {
	var n int64
	for _, v := range p.Placements {
		n += v.Item.Grams
	}
	return n
}

func tapinMoney(n json.Number, currency string) (int64, error) {
	v, ok := new(big.Rat).SetString(n.String())
	if !ok {
		return 0, ErrUnavailable
	}
	switch currency {
	case "rial":
	case "toman":
		v.Mul(v, big.NewRat(10, 1))
	default:
		return 0, ErrUnavailable
	}
	if !v.IsInt() || !v.Num().IsInt64() {
		return 0, ErrUnavailable
	}
	amount := v.Num().Int64()
	if amount < 0 || amount > 100000000000 {
		return 0, ErrUnavailable
	}
	return amount, nil
}
func tapinProductPrice(rials int64, currency string) int64 {
	if currency == "toman" {
		return rials / 10
	}
	return rials
}
