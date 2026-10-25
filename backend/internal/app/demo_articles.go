package app

import (
	"context"
	"encoding/json"

	"bomish/internal/domain"

	"github.com/jackc/pgx/v5"
)

func writeDemoArticles(ctx context.Context, tx pgx.Tx) error {
	articles := []domain.Article{{ID: "spice-guide", Slug: "spice-guide", Title: "ادویه‌ها را بهتر بشناسیم", Excerpt: "از انتخاب عطر تا زمان اضافه‌کردن؛ چند نکته ساده برای آشپزی خوش‌طعم‌تر.", Body: "## عطر را از نزدیک بشناسید\nادویه‌ها بخشی از شخصیت هر غذا هستند. با مقدار کم شروع کنید و طعم غذا را در طول پخت بررسی کنید.\n\n## زمان اضافه‌کردن مهم است\nبعضی ادویه‌ها با تفت کوتاه عطر خود را آزاد می‌کنند. حرارت بیش از حد می‌تواند باعث سوختن آن‌ها شود.\n\n## نگهداری دور از نور و رطوبت\nظرف دربسته و جای خنک به حفظ عطر ادویه کمک می‌کند. قاشق خیس را داخل ظرف نبرید.", Image: "/images/spices.png", ProductIDs: []string{"pantry-turmeric", "pantry-cumin"}}, {ID: "mint-guide", Slug: "mint-guide", Title: "نعناع؛ از آش تا یک لیوان دوغ", Excerpt: "چطور از عطر نعناع خشک در غذاهای روزمره استفاده کنیم؟", Body: "## کمی نعناع، یک عطر تازه\nنعناع خشک را به ماست، دوغ یا سالاد اضافه کنید. با مقدار کم شروع کنید تا طعم دیگر مواد حفظ شود.\n\n## نعناع‌داغ ملایم\nروغن را گرم کنید، حرارت را کم کنید و نعناع را کوتاه تفت دهید. نعناع زود می‌سوزد.\n\n## یک جای خشک\nنعناع را در ظرف دربسته و دور از بخار اجاق نگهداری کنید.", Image: "/images/spices.png", ProductIDs: []string{"pantry-mint"}}}
	for _, p := range articles {
		p.Status = "published"
		raw, _ := json.Marshal(p)
		if _, e := tx.Exec(ctx, "INSERT INTO articles(id,slug,title,status,content) VALUES($1,$2,$3,'published',$4) ON CONFLICT(id) DO NOTHING", p.ID, p.Slug, p.Title, raw); e != nil {
			return e
		}
	}
	return nil
}
