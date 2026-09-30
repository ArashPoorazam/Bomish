import Link from "next/link";
import { X } from "lucide-react";
import { ProductEvent } from "@/components/product-event";
import { CatalogFilters, CatalogSort } from "@/components/catalog-controls";
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
  const params = new URLSearchParams();
  for (const name of [
    "q",
    "category",
    "page",
    "max",
    "available",
    "sort",
    "discounted",
    "collection",
  ])
    if (q[name]) params.set(name, q[name]!);
  params.set("page", q.page || "1");
  const [all, categories] = await Promise.all([
    serverApi<{
      items: Product[];
      total: number;
      page: number;
      pageSize: number;
    }>("/products?" + params),
    serverApi<Category[]>("/categories"),
  ]);
  const title =
    categories.find((c) => c.id === q.category)?.name || "همه محصولات";
  function url(change: Record<string, string | null>) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(change)) {
      if (value === null) next.delete(key);
      else next.set(key, value);
    }
    return "/products?" + next;
  }
  const chips = [
    { key: "q", label: q.q && `جستجو: ${q.q}` },
    { key: "category", label: q.category && title },
    { key: "max", label: q.max && `تا ${q.max} تومان` },
    { key: "available", label: q.available === "true" && "فقط موجود" },
    { key: "discounted", label: q.discounted === "true" && "تخفیف‌دارها" },
  ].filter((c) => c.label);
  return (
    <div className="container section shop-catalog">
      <ProductEvent query={q.q} />
      <div className="page-heading">
        <span className="eyebrow">قفسه‌ای از عطر و طعم</span>
        <h1>{q.q ? `نتایج جستجو برای «${q.q}»` : title}</h1>
        <p>محصول را بشناسید، از بسته‌های موجود انتخاب کنید.</p>
      </div>
      <div className="catalog-layout">
        <CatalogFilters
          key={params.toString()}
          categories={categories}
          query={q}
        />
        <div className="catalog-results">
          <div className="store-toolbar">
            <div>
              <strong>{fa(all.total)} محصول</strong>
              <span className="muted">قیمت‌ها برای بسته‌های هر محصول است</span>
            </div>
            <CatalogSort key={params.toString()} value={q.sort || "relevant"} />
          </div>
          {chips.length > 0 && (
            <div className="filter-chips" aria-label="فیلترهای فعال">
              {chips.map((c) => (
                <Link
                  key={c.key}
                  href={url({ [c.key]: null, page: null })}
                  aria-label={`حذف فیلتر ${c.label}`}
                >
                  {c.label}
                  <X size={14} />
                </Link>
              ))}
            </div>
          )}
          {all.items.length ? (
            <div className="product-grid catalog-grid">
              {all.items.map((p) => (
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
          <nav className="catalog-pagination" aria-label="صفحه‌های محصولات">
            <span>
              صفحه {fa(all.page)} از{" "}
              {fa(Math.max(1, Math.ceil(all.total / all.pageSize)))}
            </span>
            <div>
              {all.page > 1 && (
                <Link
                  className="button secondary"
                  href={url({ page: String(all.page - 1) })}
                >
                  قبلی
                </Link>
              )}
              {all.page * all.pageSize < all.total && (
                <Link
                  className="button secondary"
                  href={url({ page: String(all.page + 1) })}
                >
                  بعدی
                </Link>
              )}
            </div>
          </nav>
        </div>
      </div>
    </div>
  );
}
