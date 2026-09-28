"use client";
import { useEffect, useState } from "react";
import { Search, Plus, X, Check } from "lucide-react";
import { api } from "@/lib/api";
import { fa, statuses } from "@/lib/format";
import type { Product } from "@/lib/types";

const pageSize = 8;
export function ArticleProducts({
  ids,
  onChange,
}: {
  ids: string[];
  onChange: (ids: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [results, setResults] = useState<Product[]>([]);
  const [known, setKnown] = useState<Record<string, Product>>({});
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedError, setSelectedError] = useState("");
  const [retry, setRetry] = useState(0);
  const missing = ids.filter((id) => !known[id]).join(",");
  useEffect(() => {
    if (!missing) return;
    let live = true;
    setSelectedError("");
    void (async () => {
      const found: Product[] = [];
      for (let p = 1; ; p++) {
        const data = await api<{ items: Product[]; total: number }>(
          "/staff/product-options?" +
            new URLSearchParams({
              ids: missing,
              page: String(p),
              pageSize: "100",
            }),
        );
        if (!live) return;
        found.push(...data.items);
        if (found.length >= data.total || !data.items.length) break;
      }
      setKnown((prev) => ({
        ...prev,
        ...Object.fromEntries(found.map((p) => [p.id, p])),
      }));
    })().catch((e) => {
      if (live) setSelectedError(e.message);
    });
    return () => {
      live = false;
    };
  }, [missing, retry]);
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
            pageSize: String(pageSize),
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
    <section
      className="article-section related-products"
      aria-labelledby="related-title"
    >
      <h3 id="related-title">محصولات مرتبط</h3>
      <p className="muted">
        محصولاتی را که در مقاله معرفی شده‌اند جستجو و اضافه کنید.
      </p>
      <label className="related-search">
        <span>
          <Search size={20} aria-hidden="true" />
          <input
            type="search"
            aria-label="جستجوی محصول"
            value={query}
            placeholder="نام یا نشانی محصول را بنویسید…"
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
        <div className="related-results" aria-busy={loading}>
          <p role="status" className="muted">
            {loading
              ? "در حال جستجو…"
              : error
                ? "جستجو انجام نشد."
                : total
                  ? `${fa(total)} محصول پیدا شد`
                  : "محصولی پیدا نشد؛ عبارت دیگری جستجو کنید."}
          </p>
          {error && (
            <p role="alert" className="error">
              {error}{" "}
              <button
                type="button"
                className="text-link"
                onClick={() => setRetry((v) => v + 1)}
              >
                تلاش دوباره
              </button>
            </p>
          )}
          {!loading &&
            results.map((p) => (
              <div className="related-product-row" key={p.id}>
                <div>
                  <strong>{p.name}</strong>
                  <small>
                    {p.slug} · {statuses[p.status]}
                  </small>
                </div>
                <button
                  type="button"
                  className="button secondary"
                  disabled={ids.includes(p.id)}
                  aria-label={`افزودن ${p.name}`}
                  onClick={() => {
                    setKnown((prev) => ({ ...prev, [p.id]: p }));
                    onChange([...ids, p.id]);
                  }}
                >
                  {ids.includes(p.id) ? (
                    <>
                      <Check size={16} /> انتخاب شده
                    </>
                  ) : (
                    <>
                      <Plus size={16} /> افزودن
                    </>
                  )}
                </button>
              </div>
            ))}
          {!loading && !error && total > pageSize && (
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
                صفحه {fa(page)} از {fa(Math.ceil(total / pageSize))}
              </span>
              <button
                type="button"
                className="button secondary"
                disabled={page * pageSize >= total}
                onClick={() => setPage(page + 1)}
              >
                بعدی
              </button>
            </div>
          )}
        </div>
      )}
      <div className="related-selected">
        <strong>
          محصولات انتخاب‌شده <span className="badge">{fa(ids.length)}</span>
        </strong>
        {!ids.length && <p className="muted">هنوز محصولی انتخاب نشده است.</p>}
        {selectedError && (
          <p className="error" role="alert">
            {selectedError}{" "}
            <button
              type="button"
              className="text-link"
              onClick={() => setRetry((v) => v + 1)}
            >
              تلاش دوباره
            </button>
          </p>
        )}
        {ids.map((id) => (
          <div className="related-product-row" key={id}>
            <span>{known[id]?.name || "محصول انتخاب‌شده"}</span>
            <button
              type="button"
              className="button secondary"
              aria-label={`حذف ${known[id]?.name || "محصول"} از مقاله`}
              onClick={() => onChange(ids.filter((v) => v !== id))}
            >
              <X size={16} /> حذف
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
