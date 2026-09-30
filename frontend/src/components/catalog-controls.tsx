"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { SlidersHorizontal, ChevronDown } from "lucide-react";
import type { Category } from "@/lib/types";
export function CatalogFilters({
  categories,
  query,
}: {
  categories: Category[];
  query: Record<string, string | undefined>;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const media = matchMedia("(min-width: 761px)");
    const update = () => setOpen(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return (
    <details
      className="store-filters"
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>
        <SlidersHorizontal size={18} />
        انتخاب دقیق‌تر
        <ChevronDown size={17} />
      </summary>
      <form id="store-filters" action="/products" className="filter-panel">
        {query.q && <input type="hidden" name="q" value={query.q} />}
        <label htmlFor="store-category">
          دسته‌بندی
          <select
            id="store-category"
            name="category"
            defaultValue={query.category || ""}
          >
            <option value="">همه دسته‌ها</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor="store-max-price">
          حداکثر قیمت بسته (تومان)
          <input
            id="store-max-price"
            name="max"
            inputMode="numeric"
            defaultValue={query.max}
            placeholder="بدون محدودیت"
          />
        </label>
        <label className="check-label">
          <input
            type="checkbox"
            name="available"
            value="true"
            defaultChecked={query.available === "true"}
          />
          فقط محصولات موجود
        </label>
        <label className="check-label">
          <input
            type="checkbox"
            name="discounted"
            value="true"
            defaultChecked={query.discounted === "true"}
          />
          فقط تخفیف‌دارها
        </label>
        <button className="button full">اعمال فیلتر</button>
        <Link className="text-link" href="/products">
          پاک کردن فیلترها
        </Link>
      </form>
    </details>
  );
}
export function CatalogSort({ value }: { value: string }) {
  return (
    <label className="catalog-sort" htmlFor="store-sort">
      مرتب‌سازی
      <select
        id="store-sort"
        form="store-filters"
        name="sort"
        defaultValue={value}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
      >
        <option value="relevant">مرتبط‌ترین</option>
        <option value="newest">جدیدترین</option>
        <option value="price-asc">ارزان‌ترین</option>
        <option value="price-desc">گران‌ترین</option>
        <option value="name">نام محصول</option>
      </select>
    </label>
  );
}
