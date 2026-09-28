package domain

import (
	"errors"
	"fmt"
	"math"
	"strings"
)

type Nutrient struct {
	Name  string `json:"name"`
	Value string `json:"value"`
}
type Package struct {
	ID            string  `json:"id"`
	Amount        float64 `json:"amount"`
	Unit          string  `json:"unit"`
	PriceRials    int64   `json:"priceRials"`
	MaxQuantity   int64   `json:"maxQuantity"`
	ShippingGrams int64   `json:"shippingGrams"`
}
type Section struct {
	Title string `json:"title"`
	Body  string `json:"body"`
}

func (p Package) Weight() int64 {
	if p.Unit == "g" {
		return int64(math.Round(p.Amount))
	}
	if p.Unit == "kg" {
		return int64(math.Round(p.Amount * 1000))
	}
	return p.ShippingGrams
}
func (p Package) Label() string {
	return fmt.Sprintf("%g %s", p.Amount, map[string]string{"g": "گرم", "kg": "کیلوگرم", "ml": "میلی‌لیتر", "l": "لیتر"}[p.Unit])
}
func (p Product) Package(id string) (Package, bool) {
	for _, v := range p.Packages {
		if v.ID == id {
			return v, true
		}
	}
	return Package{}, false
}
func (p Product) PackagePrice(v Package) int64 {
	return ((v.PriceRials*(100-p.DiscountPercent) + 500) / 1000) * 10
}

// Existing catalogs receive one explicit package based on their previous minimum, never a global list.
func (p *Product) EnsurePackages() {
	if p.Packages == nil {
		p.Packages = []Package{{ID: "legacy", Amount: float64(p.MinGrams), Unit: "g", PriceRials: Total(p.PriceRials, p.MinGrams), MaxQuantity: 5}}
	}
}

type Product struct {
	Packages        []Package `json:"packages"`
	Sections        []Section `json:"sections"`
	DiscountPercent int64     `json:"discountPercent"`
	Popularity      int64     `json:"popularity"`

	ID             string     `json:"id"`
	Slug           string     `json:"slug"`
	Name           string     `json:"name"`
	CategoryID     string     `json:"categoryId"`
	Status         string     `json:"status"`
	PriceRials     int64      `json:"priceRials"`
	MinGrams       int64      `json:"minGrams"`
	StepGrams      int64      `json:"stepGrams"`
	MaxGrams       int64      `json:"maxGrams"`
	OutOfStock     bool       `json:"outOfStock"`
	Summary        string     `json:"summary"`
	Description    string     `json:"description"`
	Uses           string     `json:"uses"`
	Preparation    string     `json:"preparation"`
	Storage        string     `json:"storage"`
	Allergens      string     `json:"allergens"`
	Ingredients    string     `json:"ingredients"`
	Images         []string   `json:"images"`
	Tags           []string   `json:"tags"`
	Aliases        []string   `json:"aliases"`
	RelatedIDs     []string   `json:"relatedIds"`
	Nutrients      []Nutrient `json:"nutrients"`
	NutrientSource string     `json:"nutrientSource"`
}
type Article struct {
	ID         string   `json:"id"`
	Slug       string   `json:"slug"`
	Title      string   `json:"title"`
	Status     string   `json:"status"`
	Excerpt    string   `json:"excerpt"`
	Body       string   `json:"body"`
	Image      string   `json:"image"`
	ProductIDs []string `json:"productIds"`
	UpdatedAt  string   `json:"updatedAt"`
}
type Address struct {
	Latitude   *float64 `json:"latitude,omitempty"`
	Longitude  *float64 `json:"longitude,omitempty"`
	ID         string   `json:"id"`
	Recipient  string   `json:"recipient"`
	Phone      string   `json:"phone"`
	Province   string   `json:"province"`
	City       string   `json:"city"`
	Street     string   `json:"street"`
	PostalCode string   `json:"postalCode"`
}
type CartItem struct {
	Package    Package `json:"package"`
	Quantity   int64   `json:"quantity"`
	Product    Product `json:"product"`
	Grams      int64   `json:"grams"`
	TotalRials int64   `json:"totalRials"`
}
type Cart struct {
	Items         []CartItem `json:"items"`
	SubtotalRials int64      `json:"subtotalRials"`
}
type OrderItem struct {
	PackageID    string `json:"packageId"`
	PackageLabel string `json:"packageLabel"`
	Quantity     int64  `json:"quantity"`
	ProductID    string `json:"productId"`
	Name         string `json:"name"`
	Grams        int64  `json:"grams"`
	PriceRials   int64  `json:"priceRials"`
	TotalRials   int64  `json:"totalRials"`
}
type Order struct {
	DiscountCode  string       `json:"discountCode"`
	DiscountRials int64        `json:"discountRials"`
	Events        []OrderEvent `json:"events"`

	ID            string      `json:"id"`
	Status        string      `json:"status"`
	Address       Address     `json:"address"`
	Items         []OrderItem `json:"items"`
	SubtotalRials int64       `json:"subtotalRials"`
	ShippingRials int64       `json:"shippingRials"`
	TotalRials    int64       `json:"totalRials"`
	Tracking      string      `json:"tracking"`
	CreatedAt     string      `json:"createdAt"`
}

type OrderEvent struct {
	Status    string `json:"status"`
	CreatedAt string `json:"createdAt"`
}

func Normalize(s string) string {
	s = strings.NewReplacer("ي", "ی", "ى", "ی", "ك", "ک", "‌", " ", "ۀ", "ه", "ـ", "", "۰", "0", "۱", "1", "۲", "2", "۳", "3", "۴", "4", "۵", "5", "۶", "6", "۷", "7", "۸", "8", "۹", "9", "٠", "0", "١", "1", "٢", "2", "٣", "3", "٤", "4", "٥", "5", "٦", "6", "٧", "7", "٨", "8", "٩", "9").Replace(s)
	return strings.Join(strings.Fields(strings.ToLower(s)), " ")
}
func Phone(s string) string {
	s = Normalize(s)
	s = strings.ReplaceAll(s, " ", "")
	if strings.HasPrefix(s, "+98") {
		s = "0" + s[3:]
	}
	if strings.HasPrefix(s, "0098") {
		s = "0" + s[4:]
	}
	return s
}
func ValidPhone(s string) bool {
	if len(s) != 11 || !strings.HasPrefix(s, "09") {
		return false
	}
	for _, r := range s {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}
func ValidateWeight(p Product, g int64) error {
	if p.StepGrams <= 0 || g < p.MinGrams || g > p.MaxGrams || (g-p.MinGrams)%p.StepGrams != 0 {
		return errors.New("وزن انتخاب‌شده با حداقل و گام مجاز محصول سازگار نیست")
	}
	return nil
}
func Total(price, grams int64) int64 { return ((price*grams + 5000) / 10000) * 10 }
func ValidImage(s string) bool {
	return (strings.HasPrefix(s, "/images/") || strings.HasPrefix(s, "/uploads/")) && !strings.Contains(s, "..") && !strings.ContainsAny(s, "?<>\"\\")
}
func (p Product) Validate(publish bool) error {
	if strings.TrimSpace(p.Name) == "" || strings.TrimSpace(p.Slug) == "" || p.CategoryID == "" {
		return errors.New("نام، نشانی و دسته‌بندی لازم است")
	}
	if strings.ContainsAny(p.Slug, " /?#\\") {
		return errors.New("نشانی محصول معتبر نیست")
	}
	if p.MinGrams < 1 || p.StepGrams < 1 || p.MaxGrams < p.MinGrams || p.MaxGrams > 1000000 || p.PriceRials < 0 || p.PriceRials > 100000000000 {
		return errors.New("قیمت یا محدوده وزن معتبر نیست")
	}
	if p.DiscountPercent < 0 || p.DiscountPercent > 90 || len(p.Packages) > 50 || len(p.Sections) > 30 {
		return errors.New("تخفیف یا تعداد بسته‌ها معتبر نیست")
	}
	seen := map[string]bool{}
	for _, v := range p.Packages {
		if v.ID == "" || len(v.ID) > 100 || seen[v.ID] || math.IsNaN(v.Amount) || math.IsInf(v.Amount, 0) || v.Amount <= 0 || v.Amount > 1000000 || v.MaxQuantity < 1 || v.MaxQuantity > 1000 || v.PriceRials < 0 || v.PriceRials > 100000000000 || v.PriceRials%10 != 0 || (publish && v.PriceRials == 0) || (v.Unit != "g" && v.Unit != "kg" && v.Unit != "ml" && v.Unit != "l") || v.Weight() < 1 || v.Weight() > 1000000 {
			return errors.New("مقدار، واحد، قیمت، وزن ارسال و سقف خرید بسته را بررسی کنید")
		}
		seen[v.ID] = true
	}
	for _, v := range p.Sections {
		if strings.TrimSpace(v.Title) == "" || len(v.Body) > 100000 {
			return errors.New("عنوان و متن بخش را بررسی کنید")
		}
	}
	for _, im := range p.Images {
		if !ValidImage(im) {
			return errors.New("تصویر باید از کتابخانه بارگذاری شود")
		}
	}
	if publish && (p.Summary == "" || len(p.Images) == 0 || len(p.Packages) == 0) {
		return errors.New("برای انتشار، توضیحات، خلاصه، تصویر و قیمت را کامل کنید")
	}
	if len(p.Nutrients) > 0 && strings.TrimSpace(p.NutrientSource) == "" {
		return errors.New("منبع اطلاعات تغذیه‌ای را وارد کنید")
	}
	return nil
}
func (a Address) Validate() error {
	if (a.Latitude == nil) != (a.Longitude == nil) {
		return errors.New("مختصات ناقص است")
	}
	if a.Latitude != nil && (math.IsNaN(*a.Latitude) || math.IsNaN(*a.Longitude) || *a.Latitude < -90 || *a.Latitude > 90 || *a.Longitude < -180 || *a.Longitude > 180) {
		return errors.New("مختصات معتبر نیست")
	}

	if a.Recipient == "" || !ValidPhone(Phone(a.Phone)) || a.Province == "" || a.City == "" || len([]rune(a.Street)) < 10 || len(Normalize(a.PostalCode)) != 10 {
		return errors.New("نام، شماره همراه، نشانی کامل و کد پستی ده‌رقمی لازم است")
	}
	for _, r := range Normalize(a.PostalCode) {
		if r < '0' || r > '9' {
			return errors.New("کد پستی معتبر نیست")
		}
	}
	return nil
}
