"use client";
import { useEffect, useState } from "react";
import { Search, Plus, X, Check } from "lucide-react";
import { api } from "@/lib/api";
import { fa, statuses } from "@/lib/format";
import type { Product } from "@/lib/types";

export function PricingProductPicker({
  selected,
  onChange,
}: {
  selected: Product[];
  onChange: (products: Product[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [results, setResults] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let live = true;
    setResults([]);
    setTotal(0);
    setError("");
    if (!query.trim()) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = setTimeout(() => {
      api<{ items: Product[]; total: number }>(
        "/staff/product-options?" +
          new URLSearchParams({
            q: query.trim(),
            page: String(page),
            pageSize: "8",
          }),
      )
        .then((data) => {
          if (live) {
            setResults(data.items);
            setTotal(data.total);
          }
        })
        .catch((e) => {
          if (live) setError(e.message);
        })
        .finally(() => {
          if (live) setLoading(false);
        });
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query, page, retry]);
  return (
    <div className="pricing-product-picker stack">
      <label className="related-search">
        <span>
          <Search size={20} aria-hidden="true" />
          <input
            type="search"
            aria-label="جستجوی محصولات"
            placeholder="نام یا نشانی محصول را جستجو کنید…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
              setResults([]);
              setLoading(!!e.target.value.trim());
            }}
          />
        </span>
      </label>
      {query.trim() && (
        <div aria-busy={loading}>
          <p role="status" className="muted">
            {loading
              ? "در حال جستجو…"
              : error
                ? "جستجو انجام نشد."
                : total
                  ? `${fa(total)} محصول پیدا شد`
                  : "محصولی پیدا نشد."}
          </p>
          {error && (
            <p role="alert" className="error">
              {error}{" "}
              <button
                type="button"
                className="text-link"
                onClick={() => setRetry(retry + 1)}
              >
                تلاش دوباره
              </button>
            </p>
          )}
          {!loading &&
            results.map((p) => {
              const chosen = selected.some((v) => v.id === p.id);
              return (
                <div className="related-product-row" key={p.id}>
                  <div>
                    <strong>{p.name}</strong>
                    <small>
                      {p.slug} · {statuses[p.status]} ·{" "}
                      {fa(p.discountPercent || 0)}٪ تخفیف
                    </small>
                  </div>
                  <button
                    type="button"
                    className="button secondary"
                    disabled={chosen}
                    aria-label={`انتخاب ${p.name}`}
                    onClick={() => onChange([...selected, p])}
                  >
                    {chosen ? (
                      <>
                        <Check size={16} /> انتخاب شده
                      </>
                    ) : (
                      <>
                        <Plus size={16} /> انتخاب
                      </>
                    )}
                  </button>
                </div>
              );
            })}
          {!loading && !error && total > 8 && (
            <div className="related-pagination">
              <button
                type="button"
                className="button secondary"
                disabled={page === 1}
                onClick={() => setPage(page - 1)}
              >
                قبلی
              </button>
              <span>
                صفحه {fa(page)} از {fa(Math.ceil(total / 8))}
              </span>
              <button
                type="button"
                className="button secondary"
                disabled={page * 8 >= total}
                onClick={() => setPage(page + 1)}
              >
                بعدی
              </button>
            </div>
          )}
        </div>
      )}
      <div className="pricing-selected">
        <div className="between">
          <strong>{fa(selected.length)} محصول انتخاب شده</strong>
          {selected.length > 0 && (
            <button
              type="button"
              className="text-link"
              onClick={() => onChange([])}
            >
              پاک کردن انتخاب‌ها
            </button>
          )}
        </div>
        {!selected.length && (
          <p className="muted">یک یا چند محصول را با جستجو انتخاب کنید.</p>
        )}
        {selected.map((p) => (
          <div className="related-product-row" key={p.id}>
            <span>{p.name}</span>
            <button
              type="button"
              className="button secondary"
              aria-label={`حذف ${p.name} از انتخاب‌ها`}
              onClick={() => onChange(selected.filter((v) => v.id !== p.id))}
            >
              <X size={16} /> حذف
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
