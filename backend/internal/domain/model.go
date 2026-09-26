package domain

import (
	"errors"
	"strings"
)

type Nutrient struct {
	Name  string `json:"name"`
	Value string `json:"value"`
}
type Product struct {
	ID             string     `json:"id"`
	Slug           string     `json:"slug"`
	Name           string     `json:"name"`
	CategoryID     string     `json:"categoryId"`
	Status         string     `json:"status"`
	PriceRials     int64      `json:"priceRials"`
	MinGrams       int64      `json:"minGrams"`
	StepGrams      int64      `json:"stepGrams"`
	MaxGrams       int64      `json:"maxGrams"`
	AvailableGrams int64      `json:"availableGrams"`
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
	ID         string `json:"id"`
	Recipient  string `json:"recipient"`
	Phone      string `json:"phone"`
	Province   string `json:"province"`
	City       string `json:"city"`
	Street     string `json:"street"`
	PostalCode string `json:"postalCode"`
}
type CartItem struct {
	Product    Product `json:"product"`
	Grams      int64   `json:"grams"`
	TotalRials int64   `json:"totalRials"`
}
type Cart struct {
	Items         []CartItem `json:"items"`
	SubtotalRials int64      `json:"subtotalRials"`
}
type OrderItem struct {
	ProductID  string `json:"productId"`
	Name       string `json:"name"`
	Grams      int64  `json:"grams"`
	PriceRials int64  `json:"priceRials"`
	TotalRials int64  `json:"totalRials"`
}
type Order struct {
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
	for _, im := range p.Images {
		if !ValidImage(im) {
			return errors.New("تصویر باید از کتابخانه بارگذاری شود")
		}
	}
	if publish && (p.Description == "" || p.Summary == "" || len(p.Images) == 0 || p.PriceRials <= 0) {
		return errors.New("برای انتشار، توضیحات، خلاصه، تصویر و قیمت را کامل کنید")
	}
	if len(p.Nutrients) > 0 && strings.TrimSpace(p.NutrientSource) == "" {
		return errors.New("منبع اطلاعات تغذیه‌ای را وارد کنید")
	}
	return nil
}
func (a Address) Validate() error {
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
