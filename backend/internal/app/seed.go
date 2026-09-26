package app

import (
	"bomish/internal/domain"
	"context"
	"encoding/json"
)

const DemoTOTP = "JBSWY3DPEHPK3PXP"

func (a *App) Seed(ctx context.Context) error {
	if !a.Dev {
		return nil
	}
	var exists bool
	if e := a.Pool.QueryRow(ctx, "SELECT EXISTS(SELECT 1 FROM categories)").Scan(&exists); e != nil {
		return e
	}
	if exists {
		return nil
	}
	tx, e := a.Pool.Begin(ctx)
	if e != nil {
		return e
	}
	defer tx.Rollback(ctx)
	for _, c := range [][2]string{{"spices", "ادویه‌ها"}, {"herbs", "سبزی‌های خشک"}, {"seeds", "دانه‌های خوراکی"}} {
		if _, e = tx.Exec(ctx, "INSERT INTO categories(id,name) VALUES($1,$2)", c[0], c[1]); e != nil {
			return e
		}
	}
	samples := []struct {
		id, name, cat, summary, uses, preparation string
		price                                     int64
	}{
		{"turmeric", "زردچوبه", "spices", "رنگ گرم و عطر آشنای آشپزخانه ایرانی", "برای رنگ و طعم دادن به خورش، عدسی، سوپ و برنج کاربرد دارد.", "مقدار کمی را همراه پیاز تفت دهید؛ حرارت زیاد و طولانی می‌تواند طعم آن را تلخ کند.", 2800000},
		{"cinnamon", "چوب دارچین", "spices", "عطری گرم برای لحظه‌های آرام", "برای چای، دمنوش، شیرینی و طعم‌دهی به خوراک‌ها مناسب است.", "یک تکه کوچک را هنگام دم‌کردن به قوری اضافه کنید و پیش از سرو خارج کنید.", 6800000},
		{"mint", "نعناع خشک", "herbs", "عطر سبز باغ، کنار سفره شما", "برای ماست، دوغ، آش، کشک بادمجان و سالاد کاربرد دارد.", "برای نعناع‌داغ، آن را تنها چند ثانیه با حرارت ملایم در روغن گرم کنید.", 4200000},
		{"cumin", "زیره سبز", "spices", "دانه‌های کوچک با عطری ماندگار", "برای زیره‌پلو، خوراک حبوبات، نان و ترکیب ادویه مناسب است.", "دانه را درست پیش از مصرف آسیاب کنید یا مدت کوتاهی در تابه خشک گرم کنید.", 7600000},
		{"sesame", "کنجد سفید", "seeds", "یک همراه خوش‌طعم برای نان و سالاد", "برای روی نان، سالاد، شیرینی و تهیه سس کنجد کاربرد دارد.", "در تابه خشک و روی حرارت ملایم هم بزنید تا کمی طلایی شود.", 3500000},
	}
	for _, s := range samples {
		p := domain.Product{ID: s.id, Slug: s.id, Name: s.name, CategoryID: s.cat, Status: "published", PriceRials: s.price, MinGrams: 100, StepGrams: 50, MaxGrams: 25000, Summary: s.summary, Description: s.summary + ". با انتخاب وزن دلخواه، به اندازه نیاز آشپزخانه یا کسب‌وکارتان سفارش دهید. این محصول و قیمت آن نمونه نمایشی هستند.", Uses: s.uses, Preparation: s.preparation, Storage: "در ظرف دربسته، جای خشک و خنک و دور از نور مستقیم نگهداری کنید.", Ingredients: s.name, Images: []string{"/images/spices.png"}, Tags: []string{"آشپزی", "خوراکی"}, RelatedIDs: []string{}, Aliases: []string{}, Nutrients: []domain.Nutrient{}}
		if s.id == "turmeric" {
			p.Aliases = []string{"زرچوبه", "زرد چوبه"}
		}
		if s.id == "sesame" {
			p.Allergens = "حاوی کنجد است."
		}
		raw, _ := json.Marshal(p)
		_, e = tx.Exec(ctx, "INSERT INTO products(id,slug,name,category_id,status,price_rials,min_grams,step_grams,max_grams,search_text,content) VALUES($1,$2,$3,$4,'published',$5,$6,$7,$8,$9,$10)", p.ID, p.Slug, p.Name, p.CategoryID, p.PriceRials, p.MinGrams, p.StepGrams, p.MaxGrams, searchText(p), raw)
		if e != nil {
			return e
		}
		if _, e = tx.Exec(ctx, "INSERT INTO inventory(product_id,stock_grams) VALUES($1,100000)", p.ID); e != nil {
			return e
		}
		if _, e = tx.Exec(ctx, "INSERT INTO stock_movements(product_id,delta_grams,reason) VALUES($1,100000,'development fixture')", p.ID); e != nil {
			return e
		}
	}
	articles := []domain.Article{{ID: "spice-guide", Slug: "spice-guide", Title: "ادویه‌ها را بهتر بشناسیم", Excerpt: "از انتخاب عطر تا زمان اضافه‌کردن؛ چند نکته ساده برای آشپزی خوش‌طعم‌تر.", Body: "## عطر را از نزدیک بشناسید\nادویه‌ها بخشی از شخصیت هر غذا هستند. با مقدار کم شروع کنید و طعم غذا را در طول پخت بررسی کنید.\n\n## زمان اضافه‌کردن مهم است\nبعضی ادویه‌ها با تفت کوتاه عطر خود را آزاد می‌کنند. حرارت بیش از حد می‌تواند باعث سوختن آن‌ها شود.\n\n## نگهداری دور از نور و رطوبت\nظرف دربسته و جای خنک به حفظ عطر ادویه کمک می‌کند. قاشق خیس را داخل ظرف نبرید.", Image: "/images/spices.png", ProductIDs: []string{"turmeric", "cumin"}}, {ID: "mint-guide", Slug: "mint-guide", Title: "نعناع؛ از آش تا یک لیوان دوغ", Excerpt: "چطور از عطر نعناع خشک در غذاهای روزمره استفاده کنیم؟", Body: "## کمی نعناع، یک عطر تازه\nنعناع خشک را به ماست، دوغ یا سالاد اضافه کنید. با مقدار کم شروع کنید تا طعم دیگر مواد حفظ شود.\n\n## نعناع‌داغ ملایم\nروغن را گرم کنید، حرارت را کم کنید و نعناع را کوتاه تفت دهید. نعناع زود می‌سوزد.\n\n## یک جای خشک\nنعناع را در ظرف دربسته و دور از بخار اجاق نگهداری کنید.", Image: "/images/spices.png", ProductIDs: []string{"mint"}}}
	for _, p := range articles {
		p.Status = "published"
		raw, _ := json.Marshal(p)
		if _, e = tx.Exec(ctx, "INSERT INTO articles(id,slug,title,status,content) VALUES($1,$2,$3,'published',$4)", p.ID, p.Slug, p.Title, raw); e != nil {
			return e
		}
	}
	for _, role := range []string{"owner", "editor", "operator"} {
		if _, e = tx.Exec(ctx, "INSERT INTO staff(id,username,password_hash,totp_secret,role) VALUES($1,$1,$2,$3,$1)", role, PasswordHash("Bomish-demo-2026!"), DemoTOTP); e != nil {
			return e
		}
	}
	for _, province := range []string{"تهران", "البرز", "اصفهان", "فارس", "خراسان رضوی", "گیلان", "مازندران", "آذربایجان شرقی"} {
		for _, band := range [][2]int64{{2200, 650000}, {5200, 950000}, {25200, 1800000}} {
			if _, e = tx.Exec(ctx, "INSERT INTO shipping_rules(id,province,max_grams,fee_rials) VALUES($1,$2,$3,$4)", token(), province, band[0], band[1]); e != nil {
				return e
			}
		}
	}
	return tx.Commit(ctx)
}
