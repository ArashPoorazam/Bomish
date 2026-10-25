package carrier

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"bomish/internal/domain"
	"bomish/internal/packing"
)

func TestMoneyAndThreshold(t *testing.T) {
	if n, e := Money(123, "toman"); e != nil || n != 1230 {
		t.Fatal(n, e)
	}
	if _, e := Money(123, "unknown"); e == nil {
		t.Fatal("currency assumed")
	}
	if CustomerCharge(23, 100, 0) != 30 || CustomerCharge(23, 100, 100) != 0 {
		t.Fatal("rounding or inclusive threshold")
	}
}
func TestTapinShopQuoteTotals(t *testing.T) {
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.URL.Path != "/api/v2/public/order/post/check-price/" || r.Header.Get("Authorization") != "fixture" {
			t.Error("incorrect shop flow")
		}
		var in map[string]any
		json.NewDecoder(r.Body).Decode(&in)
		if in["shop_id"] != "shop" || in["package_weight"] != float64(50) {
			t.Errorf("wrong shop/packaging: %+v", in)
		}
		if in["first_name"] != "گیرنده" || in["last_name"] != "آزمایشی ارسال" {
			t.Error("recipient name missing from required fields")
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"returns":{"status":200},"entries":{"send_price":20,"send_price_tax":3,"total_price":23}}`))
	}))
	defer server.Close()
	p := packing.Parcel{ID: "a", Box: packing.Box{PostalSizeID: "1"}, GrossGrams: 150, Placements: []packing.Placement{{Item: packing.Item{Grams: 100}}}}
	q, e := (Tapin{Client: server.Client(), BaseURL: server.URL, Token: "fixture", Currency: "rial"}).Quote(context.Background(), Request{ShopID: "shop", ProvinceCode: "1", CityCode: "2", Destination: domain.Address{Recipient: "گیرنده آزمایشی ارسال"}, Parcels: []packing.Parcel{p, p}})
	if e != nil || q.CostRials != 46 || calls != 2 {
		t.Fatal(q, e, calls)
	}
	if CustomerCharge(q.CostRials, 0, 0) != 50 {
		t.Fatal("rounded per parcel instead of once")
	}
}

func TestTapinDecimalMoney(t *testing.T) {
	for _, tt := range []struct {
		value, unit string
		want        int64
	}{{"254650.0", "rial", 254650}, {"25.5", "toman", 255}, {"0", "rial", 0}} {
		n, e := tapinMoney(json.Number(tt.value), tt.unit)
		if e != nil || n != tt.want {
			t.Fatal(n, e)
		}
	}
	if _, e := tapinMoney(json.Number("1.5"), "rial"); e == nil {
		t.Fatal("fractional rial silently truncated")
	}
}

type fixtureContract struct{}

func (fixtureContract) Encode(op string, in Request, ref string) (string, string, any, error) {
	method := "POST"
	if op == "lookup" {
		method = "GET"
	}
	return method, "/fixture/" + op, map[string]string{"reference": ref}, nil
}
func (fixtureContract) Authenticate(r *http.Request) { r.Header.Set("Authorization", "fixture-only") }
func (fixtureContract) DecodeQuote(raw json.RawMessage) (Quote, error) {
	var q Quote
	e := json.Unmarshal(raw, &q)
	return q, e
}
func (fixtureContract) DecodeBooking(raw json.RawMessage) (Booking, error) {
	var b Booking
	e := json.Unmarshal(raw, &b)
	return b, e
}
func TestSnappTransportDoesNotRetryCreate(t *testing.T) {
	calls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.Header.Get("Authorization") != "fixture-only" {
			t.Fatal("auth absent")
		}
		w.WriteHeader(503)
		w.Write([]byte(`{"error":"provider secret must not escape"}`))
	}))
	defer server.Close()
	s := Snapp{Client: server.Client(), BaseURL: server.URL, Contract: fixtureContract{}}
	if _, e := s.Create(context.Background(), Request{Reference: "ref"}); e != ErrUnknown {
		t.Fatal("ambiguous failure not retained", e)
	}
	if calls != 1 {
		t.Fatal("automatic create retry")
	}
	s.Contract = nil
	if _, e := s.Quote(context.Background(), Request{}); e == nil {
		t.Fatal("unverified contract enabled")
	}
}
