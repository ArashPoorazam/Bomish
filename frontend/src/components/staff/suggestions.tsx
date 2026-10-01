"use client";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Search, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import { fa } from "@/lib/format";
import { useLiveQuery } from "@/hooks/use-live-query";
import type { Product, Suggestion } from "@/lib/types";
import type { HomeEditorState } from "./home-management";
type SuggestionPick = {
  id: string;
  name: string;
  status: string;
  image?: string;
  outOfStock?: boolean;
};
export function SuggestionsEditor({
  onState,
}: {
  onState: (state: HomeEditorState) => void;
}) {
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [chosen, setChosen] = useState<SuggestionPick[]>([]);
  const [baseline, setBaseline] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const initialized = useRef(false);
  const saved = useLiveQuery<Suggestion[]>("/staff/suggestions", true, 0);
  const products = useLiveQuery<Product[]>(
    `/products?q=${encodeURIComponent(search)}&pageSize=30`,
    true,
    0,
  );
  const dirty =
    baseline !== null &&
    JSON.stringify(chosen.map((p) => p.id)) !== JSON.stringify(baseline);
  useEffect(() => {
    onState({ dirty, busy });
  }, [dirty, busy, onState]);
  useEffect(() => {
    const timer = setTimeout(() => setSearch(query), 300);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    if (saved.data && !initialized.current) {
      initialized.current = true;
      setChosen(saved.data);
      setBaseline(saved.data.map((p) => p.id));
    }
  }, [saved.data]);
  function update(next: SuggestionPick[]) {
    setChosen(next);
    setNotice("");
  }
  function move(i: number, offset: number) {
    const next = [...chosen];
    [next[i], next[i + offset]] = [next[i + offset], next[i]];
    update(next);
  }
  return (
    <section
      className="home-editor omni-panel"
      aria-labelledby="home-products-title"
    >
      <div className="home-editor-heading">
        <div>
          <span className="eyebrow">ویترین منتخب شما</span>
          <h2 id="home-products-title">پیشنهادهای بومیش</h2>
          <p>تا ۱۲ محصول را انتخاب کنید و ترتیب نمایش آن‌ها را بچینید.</p>
        </div>
        <span className="badge">{fa(chosen.length)} از ۱۲</span>
      </div>
      {saved.error && (
        <div role="alert">
          <p className="error">{saved.error}</p>
          <button disabled={saved.loading} onClick={saved.refresh}>
            تلاش دوباره برای پیشنهادها
          </button>
        </div>
      )}
      {!baseline && !saved.error && (
        <p role="status">در حال دریافت پیشنهادها…</p>
      )}
      <fieldset disabled={busy || baseline === null}>
        <div className="suggestion-workspace">
          <div className="suggestion-selection">
            <h3>ترتیب نمایش در فروشگاه</h3>
            <ol className="suggestion-list">
              {chosen.map((p, i) => (
                <li key={p.id}>
                  <span className="suggestion-number">{fa(i + 1)}</span>
                  <Image
                    src={p.image || "/images/spices.png"}
                    width={52}
                    height={52}
                    alt=""
                  />
                  <div className="suggestion-name">
                    <strong>{p.name}</strong>
                    {(p.status !== "published" || p.outOfStock) && (
                      <small>
                        {p.status !== "published" ? "منتشرنشده" : "ناموجود"}؛ در
                        فروشگاه نمایش داده نمی‌شود
                      </small>
                    )}
                  </div>
                  <div className="home-item-actions">
                    <button
                      type="button"
                      aria-label={`${p.name} بالاتر`}
                      disabled={i === 0}
                      onClick={() => move(i, -1)}
                    >
                      <ArrowUp size={16} />
                    </button>
                    <button
                      type="button"
                      aria-label={`${p.name} پایین‌تر`}
                      disabled={i === chosen.length - 1}
                      onClick={() => move(i, 1)}
                    >
                      <ArrowDown size={16} />
                    </button>
                    <button
                      type="button"
                      aria-label={`حذف ${p.name}`}
                      onClick={() =>
                        update(chosen.filter((x) => x.id !== p.id))
                      }
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </li>
              ))}
            </ol>
            {!chosen.length && (
              <div className="home-editor-empty">
                محصولی انتخاب نشده است.
                <br />
                از فهرست محصولات به ویترین اضافه کنید.
              </div>
            )}
          </div>
          <div className="suggestion-browser">
            <h3>افزودن محصول</h3>
            <label className="suggestion-search">
              <span>جستجوی محصول</span>
              <div>
                <Search size={17} />
                <input
                  value={query}
                  placeholder="نام محصول…"
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
            </label>
            {products.error && (
              <div role="alert">
                <p className="error">{products.error}</p>
                <button disabled={products.loading} onClick={products.refresh}>
                  تلاش دوباره برای جستجو
                </button>
              </div>
            )}
            {products.loading && <p role="status">در حال جستجو…</p>}
            <div className="suggestion-results">
              {products.data
                ?.filter((p) => !chosen.some((x) => x.id === p.id))
                .map((p) => (
                  <button
                    type="button"
                    disabled={chosen.length >= 12}
                    key={p.id}
                    onClick={() =>
                      update([
                        ...chosen,
                        {
                          id: p.id,
                          name: p.name,
                          status: p.status,
                          image: p.images?.[0],
                          outOfStock: p.outOfStock,
                        },
                      ])
                    }
                  >
                    <Image
                      src={p.images?.[0] || "/images/spices.png"}
                      alt=""
                      width={44}
                      height={44}
                    />
                    <span>
                      {p.name}
                      {p.outOfStock && <small>ناموجود</small>}
                    </span>
                    <Plus size={17} />
                  </button>
                ))}
            </div>
            {!products.loading &&
              !products.error &&
              products.data?.filter((p) => !chosen.some((x) => x.id === p.id))
                .length === 0 && <p className="muted">محصول دیگری پیدا نشد.</p>}
            {chosen.length === 12 && (
              <p className="muted">
                ویترین تکمیل است؛ برای جایگزینی، یک محصول را حذف کنید.
              </p>
            )}
          </div>
        </div>
        <div className="home-editor-footer">
          <button
            className="button"
            disabled={!dirty}
            onClick={async () => {
              if (busy) return;
              setBusy(true);
              setError("");
              setNotice("");
              try {
                const ids = chosen.map((p) => p.id);
                await api("/staff/suggestions", "PUT", { productIds: ids });
                setBaseline(ids);
                setNotice("پیشنهادها ذخیره شدند.");
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "در حال ذخیره…" : "ذخیره پیشنهادها"}
          </button>
          <span>
            {dirty
              ? "تغییرات ذخیره نشده"
              : "فقط محصولات منتشرشده و موجود نمایش داده می‌شوند."}
          </span>
        </div>
      </fieldset>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="request-success" role="status">
          {notice}
        </p>
      )}
    </section>
  );
}
