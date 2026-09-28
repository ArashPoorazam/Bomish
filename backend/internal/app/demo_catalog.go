package app

import (
	"bomish/internal/domain"
	"context"
	"encoding/json"
	"errors"
)

// RefreshDemoCatalog is an explicit development command, never a startup seed.
// Archive old fixtures so their order history references remain intact.
func (a *App) RefreshDemoCatalog(ctx context.Context) error {
	if !a.Dev {
		return errors.New("demo catalog refresh is development-only")
	}
	tx, e := a.Pool.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	if _, e = tx.Exec(ctx, "SELECT pg_advisory_xact_lock(7234110)"); e != nil {
		return e
	}
	oldIDs := []string{"turmeric", "cinnamon", "mint", "cumin", "sesame"}
	_, e = tx.Exec(ctx, `UPDATE products SET status='archived',updated_at=now() WHERE id=ANY($1) OR (name='ادویه آزمایش مرورگر' AND slug LIKE 'browser-%')`, oldIDs)
	if e != nil {
		return e
	}
	_, e = tx.Exec(ctx, `DELETE FROM product_drafts WHERE product_id IN (SELECT id FROM products WHERE id=ANY($1) OR (name='ادویه آزمایش مرورگر' AND slug LIKE 'browser-%'))`, oldIDs)
	if e != nil {
		return e
	}
	_, e = tx.Exec(ctx, `DELETE FROM carts WHERE product_id IN (SELECT id FROM products WHERE id=ANY($1) OR (name='ادویه آزمایش مرورگر' AND slug LIKE 'browser-%'))`, oldIDs)
	if e != nil {
		return e
	}
	for _, c := range [][2]string{{"spices", "ادویه‌ها"}, {"herbs", "سبزی‌های خشک"}, {"seeds", "دانه‌های خوراکی"}, {"salts", "نمک‌ها"}, {"oils", "روغن‌ها"}} {
		if _, e = tx.Exec(ctx, "INSERT INTO categories(id,name) VALUES($1,$2) ON CONFLICT(id) DO NOTHING", c[0], c[1]); e != nil {
			return e
		}
	}
	pack := func(id string, amount float64, unit string, toman, max, grams int64) domain.Package {
		return domain.Package{ID: id, Amount: amount, Unit: unit, PriceRials: toman * 10, MaxQuantity: max, ShippingGrams: grams}
	}
	samples := []struct {
		id, name, category, summary, image string
		unavailable                        bool
		discount                           int64
		packages                           []domain.Package
	}{
		{"demo-sea-salt", "نمک دریایی آزمایشی", "salts", "دو اندازه با قیمت مستقل؛ مناسب آزمایش دو بسته از یک محصول در سبد.", "/images/bomish-logo.png", false, 0, []domain.Package{pack("200g", 200, "g", 200000, 5, 0), pack("500g", 500, "g", 400000, 5, 0)}},
		{"demo-sesame-oil", "روغن کنجد آزمایشی", "oils", "یک بطری ۱٫۵ لیتری برای آزمایش محصول با واحد حجم.", "/images/bomish-logo.png", false, 0, []domain.Package{pack("1500ml", 1.5, "l", 300000, 5, 1500)}},
		{"demo-turmeric", "زردچوبه آزمایشی", "spices", "چهار اندازه بسته با بازه قیمت ۱۴۰ هزار تا یک میلیون تومان.", "/images/spices.png", false, 0, []domain.Package{pack("100g", 100, "g", 140000, 5, 0), pack("250g", 250, "g", 300000, 5, 0), pack("500g", 500, "g", 550000, 5, 0), pack("1kg", 1, "kg", 1000000, 5, 0)}},
		{"demo-dried-mint", "نعناع خشک آزمایشی", "herbs", "سه اندازه بسته؛ سقف خرید بسته ۲۵۰ گرمی سه عدد است.", "/images/spices.png", false, 0, []domain.Package{pack("50g", 50, "g", 70000, 5, 0), pack("100g", 100, "g", 120000, 5, 0), pack("250g", 250, "g", 250000, 3, 0)}},
		{"demo-white-sesame", "کنجد سفید آزمایشی", "seeds", "۱۵٪ تخفیف برای آزمایش قیمت بسته‌ها.", "/images/spices.png", false, 15, []domain.Package{pack("200g", 200, "g", 150000, 5, 0), pack("500g", 500, "g", 320000, 5, 0)}},
		{"demo-cinnamon", "دارچین آزمایشی", "spices", "نمونه ناموجود برای آزمایش نمایش وضعیت و جلوگیری از خرید.", "/images/spices.png", true, 0, []domain.Package{pack("100g", 100, "g", 180000, 5, 0)}},
	}
	for _, s := range samples {
		p := domain.Product{ID: s.id, Slug: s.id, Name: s.name, CategoryID: s.category, Status: "published", OutOfStock: s.unavailable, MinGrams: 1, StepGrams: 1, MaxGrams: 1000000, Packages: s.packages, DiscountPercent: s.discount, Summary: s.summary, Description: "## محصول آزمایشی\n\n" + s.summary + "\n\nاین محصول، تصویر و قیمت آن صرفاً برای آزمایش فروشگاه هستند و سفارش واقعی محسوب نمی‌شوند.", Images: []string{s.image}, Tags: []string{"آزمایشی"}, Aliases: []string{}, RelatedIDs: []string{}, Nutrients: []domain.Nutrient{}, Sections: []domain.Section{{Title: "راهنمای آزمایش", Body: "- اندازه بسته را انتخاب کنید.\n- تعداد را تغییر دهید و سقف خرید را بررسی کنید.\n- برای دیدن ردیف‌های جدا، دو اندازه از همین محصول به سبد اضافه کنید.\n\n**پرداخت در این نسخه آزمایشی است.**"}}}
		if e = p.Validate(true); e != nil {
			return e
		}
		raw, _ := json.Marshal(p)
		_, e = tx.Exec(ctx, `INSERT INTO products(id,slug,name,category_id,status,price_rials,min_grams,step_grams,max_grams,search_text,content) VALUES($1,$1,$2,$3,'published',0,1,1,1000000,$4,$5) ON CONFLICT(id) DO UPDATE SET name=excluded.name,category_id=excluded.category_id,status='published',content=excluded.content,search_text=excluded.search_text,updated_at=now()`, p.ID, p.Name, p.CategoryID, searchText(p), raw)
		if e != nil {
			return e
		}
		if _, e = tx.Exec(ctx, "DELETE FROM product_drafts WHERE product_id=$1", p.ID); e != nil {
			return e
		}
	}
	return tx.Commit(ctx)
}
