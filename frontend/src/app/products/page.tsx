import { ProductEvent } from "@/components/product-event";
import Link from "next/link";
import { serverApi } from "@/lib/api";
import type { Product, Category } from "@/lib/types";
import { ProductCard } from "@/components/product-card";
import { fa } from "@/lib/format";
export const metadata = { title: "همه محصولات" };
export default async function Products({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const q = await searchParams;
  const [all, categories] = await Promise.all([
    serverApi<{
      items: Product[];
      total: number;
      page: number;
      pageSize: number;
    }>(
      "/products?" +
        new URLSearchParams({
          q: q.q || "",
          category: q.category || "",
          page: q.page || "1",
          max: q.max || "",
          available: q.available === "true" ? "true" : "",
          sort: q.sort || "",
        }),
    ),
    serverApi<Category[]>("/categories"),
  ]);
  const products = all.items;
  const title =
    categories.find((c) => c.id === q.category)?.name || "همه محصولات";
  return (
    <div className="container section">
      <ProductEvent query={q.q} />
      <div className="page-heading">
        <span className="eyebrow">از طبیعت، برای آشپزخانه شما</span>
        <h1>{q.q ? `نتایج جستجو برای «${q.q}»` : title}</h1>
        <p>
          طعم مورد علاقه‌تان را پیدا کنید و اندازه و تعداد بسته‌ها را انتخاب
          کنید.
        </p>
      </div>
      <div className="catalog-layout">
        <form className="filter-panel">
          <h3>انتخاب دقیق‌تر</h3>
          {q.q ? <input type="hidden" name="q" value={q.q} /> : null}
          <label>
            دسته‌بندی
            <select name="category" defaultValue={q.category || ""}>
              <option value="">همه دسته‌ها</option>
              {categories.map((c) => (
                <option value={c.id} key={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            حداکثر قیمت بسته (تومان)
            <input
              name="max"
              inputMode="numeric"
              min="0"
              defaultValue={q.max}
              placeholder="بدون محدودیت"
            />
          </label>
          <label>
            مرتب‌سازی
            <select name="sort" defaultValue={q.sort || "relevant"}>
              <option value="relevant">مرتبط‌ترین</option>
              <option value="price-asc">ارزان‌ترین</option>
              <option value="price-desc">گران‌ترین</option>
            </select>
          </label>
          <label className="check-label">
            <input
              type="checkbox"
              name="available"
              value="true"
              defaultChecked={q.available === "true"}
            />
            فقط محصولات موجود
          </label>
          <button className="button full">اعمال فیلتر</button>
          <Link className="text-link" href="/products">
            پاک کردن فیلترها
          </Link>
        </form>
        <div>
          <div className="between catalog-count">
            <span>{fa(all.total)} محصول</span>
            <span className="muted">بازه قیمت بسته‌های هر محصول</span>
          </div>
          <div className="omni-pager">
            <span>صفحه {fa(all.page)}</span>
            <div>
              {all.page > 1 && (
                <Link
                  className="button secondary"
                  href={
                    "/products?" +
                    new URLSearchParams({
                      ...(Object.fromEntries(
                        Object.entries(q).filter(([, v]) => v !== undefined),
                      ) as Record<string, string>),
                      page: String(all.page - 1),
                    })
                  }
                >
                  قبلی
                </Link>
              )}
              {all.page * all.pageSize < all.total && (
                <Link
                  className="button secondary"
                  href={
                    "/products?" +
                    new URLSearchParams({
                      ...(Object.fromEntries(
                        Object.entries(q).filter(([, v]) => v !== undefined),
                      ) as Record<string, string>),
                      page: String(all.page + 1),
                    })
                  }
                >
                  بعدی
                </Link>
              )}
            </div>
          </div>
          {products.length ? (
            <div className="product-grid catalog-grid">
              {products.map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <h2>این طعم را پیدا نکردیم</h2>
              <p>نام کوتاه‌تر یا دسته‌بندی دیگری را امتحان کنید.</p>
              <Link href="/products" className="button">
                همه محصولات
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
