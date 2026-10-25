// Package carrier defines capability-specific carrier boundaries. No client books during quotation.
package carrier

import (
	"context"
	"errors"
	"time"

	"bomish/internal/domain"
	"bomish/internal/packing"
)

var ErrUnavailable = errors.New("سرویس ارسال در دسترس نیست؛ تنظیمات و اعتبار حساب را بررسی کنید")
var ErrUnknown = errors.New("نتیجه درخواست در حال بررسی است")

type Request struct {
	Reference    string           `json:"reference"`
	Origin       domain.Address   `json:"origin"`
	Destination  domain.Address   `json:"destination"`
	Items        []packing.Item   `json:"items,omitempty"`
	Parcels      []packing.Parcel `json:"parcels"`
	Service      string           `json:"service"`
	ShopID       string           `json:"shopId"`
	ProvinceCode string           `json:"provinceCode"`
	CityCode     string           `json:"cityCode"`
}
type Quote struct {
	CostRials  int64            `json:"costRials"`
	ExpiresAt  time.Time        `json:"expiresAt"`
	Components map[string]int64 `json:"components"`
	Simulated  bool             `json:"simulated"`
}
type Booking struct {
	ID          string    `json:"id"`
	Reference   string    `json:"reference"`
	Status      string    `json:"status"`
	CostRials   *int64    `json:"costRials"`
	OccurredAt  time.Time `json:"occurredAt"`
	DriverName  string    `json:"driverName,omitempty"`
	DriverPhone string    `json:"driverPhone,omitempty"`
}
type Quoter interface {
	Quote(context.Context, Request) (Quote, error)
}
type Courier interface {
	Quoter
	Create(context.Context, Request) (Booking, error)
	Lookup(context.Context, string) (Booking, error)
	Cancel(context.Context, string) (Booking, error)
}

func Money(amount int64, unit string) (int64, error) {
	if amount < 0 || amount > 10000000000 {
		return 0, ErrUnavailable
	}
	switch unit {
	case "rial":
		return amount, nil
	case "toman":
		return amount * 10, nil
	}
	return 0, errors.New("واحد پول تأیید نشده است")
}
func CustomerCharge(cost, subtotal, threshold int64) int64 {
	if threshold > 0 && subtotal >= threshold {
		return 0
	}
	return ((cost + 9) / 10) * 10
}

// These adapters stay fail-closed until the merchant's versioned booking/auth contracts are verified.
// A successful simulator check never verifies a live account.
type Disabled struct{}

func (Disabled) Quote(context.Context, Request) (Quote, error)    { return Quote{}, ErrUnavailable }
func (Disabled) Create(context.Context, Request) (Booking, error) { return Booking{}, ErrUnavailable }
func (Disabled) Lookup(context.Context, string) (Booking, error)  { return Booking{}, ErrUnknown }
func (Disabled) Cancel(context.Context, string) (Booking, error)  { return Booking{}, ErrUnknown }
