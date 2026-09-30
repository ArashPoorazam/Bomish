"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useLiveQuery } from "@/hooks/use-live-query";
import type { Product } from "@/lib/types";
type Pick = { id: string; name: string; status: string };
export function SuggestionsEditor() {
  const [query, setQuery] = useState(""),
    [search, setSearch] = useState(""),
    [chosen, setChosen] = useState<Pick[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const initialized = useRef(false);
  const saved = useLiveQuery<Pick[]>("/staff/suggestions", true, 0);
  const products = useLiveQuery<Product[]>(
    `/products?q=${encodeURIComponent(search)}&pageSize=30`,
    true,
    0,
  );
  useEffect(() => {
    const timer = setTimeout(() => setSearch(query), 300);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    if (saved.data && !initialized.current) {
      initialized.current = true;
      setChosen(saved.data);
    }
  }, [saved.data]);
  return (
    <section className="omni-panel request-form">
      <h2>پیشنهادهای بومیش</h2>
      <p>
        حداکثر ۱۲ محصول را به ترتیب نمایش انتخاب کنید. فقط این انتخاب‌ها در
        پیشنهادهای صفحه اصلی نمایش داده می‌شوند؛ محصولات ناموجود یا منتشرنشده در
        فروشگاه نمایش داده نمی‌شوند.
      </p>
      {(error || saved.error || products.error) && (
        <p role="alert" className="error">
          {error || saved.error || products.error}
        </p>
      )}
      {saved.error && (
        <button disabled={saved.loading} onClick={saved.refresh}>
          تلاش دوباره برای پیشنهادها
        </button>
      )}
      {products.error && (
        <button disabled={products.loading} onClick={products.refresh}>
          تلاش دوباره برای جستجو
        </button>
      )}
      <fieldset disabled={busy || !saved.data}>
        <ol className="suggestion-list">
          {chosen.map((p, i) => (
            <li key={p.id}>
              <strong>{p.name}</strong>
              {p.status !== "published" && <small>منتشرنشده؛ حذف کنید</small>}
              <button
                type="button"
                disabled={i === 0}
                onClick={() =>
                  setChosen((old) => {
                    const next = [...old];
                    [next[i - 1], next[i]] = [next[i], next[i - 1]];
                    return next;
                  })
                }
              >
                بالاتر
              </button>
              <button
                type="button"
                onClick={() => setChosen(chosen.filter((x) => x.id !== p.id))}
              >
                حذف
              </button>
            </li>
          ))}
        </ol>
        <label>
          جستجوی محصول
          <input value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <div className="suggestion-results">
          {products.data
            ?.filter((p) => !chosen.some((x) => x.id === p.id))
            .map((p) => (
              <button
                type="button"
                disabled={chosen.length >= 12}
                key={p.id}
                onClick={() => setChosen([...chosen, p])}
              >
                {p.name} ＋
              </button>
            ))}
        </div>
        <button
          className="button"
          onClick={async () => {
            setBusy(true);
            setError("");
            setNotice("");
            try {
              await api("/staff/suggestions", "PUT", {
                productIds: chosen.map((p) => p.id),
              });
              setNotice("پیشنهادها ذخیره شدند.");
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          ذخیره پیشنهادها
        </button>
      </fieldset>
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
