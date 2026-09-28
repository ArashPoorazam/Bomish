"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { Article, Product } from "@/lib/types";
import { RichText } from "@/components/rich-text";
export const newArticle = (): Article => ({
  id: crypto.randomUUID(),
  slug: "",
  title: "",
  status: "draft",
  excerpt: "",
  body: "",
  image: "",
  productIds: [],
  updatedAt: "",
});
export function ArticleEditor({
  article,
  products,
  owner,
  onSaved,
  onStateChange,
}: {
  article: Article;
  products: Product[];
  owner: boolean;
  onSaved: () => Promise<void>;
  onStateChange: (state: { dirty: boolean; busy: boolean }) => void;
}) {
  const initial = { ...article, productIds: article.productIds || [] };
  const [productQuery, setProductQuery] = useState("");
  const [optionPage, setOptionPage] = useState(1),
    [optionTotal, setOptionTotal] = useState(0);
  const [options, setOptions] = useState<Product[]>(products);
  const [knownProducts, setKnownProducts] = useState<Product[]>(products);
  const [optionError, setOptionError] = useState("");
  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      api<{ items: Product[]; total: number }>(
        "/staff/product-options?" +
          new URLSearchParams({ q: productQuery, page: String(optionPage) }),
      )
        .then((v) => {
          if (live) {
            setOptions(v.items);
            setOptionTotal(v.total);
            setOptionError("");
          }
        })
        .catch((e) => {
          if (live) setOptionError(e.message);
        });
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [productQuery, optionPage]);
  useEffect(() => {
    let live = true;
    if (initial.productIds.length) {
      void (async () => {
        const found: Product[] = [];
        for (let page = 1; ; page++) {
          const data = await api<{ items: Product[]; total: number }>(
            "/staff/product-options?" +
              new URLSearchParams({
                ids: initial.productIds.join(","),
                page: String(page),
                pageSize: "100",
              }),
          );
          found.push(...data.items);
          if (!live) return;
          if (found.length >= data.total || !data.items.length) break;
        }
        if (live) setKnownProducts(found);
      })().catch((e) => {
        if (live) setOptionError(e.message);
      });
    }
    return () => {
      live = false;
    };
  }, [article.id]);
  const [a, setA] = useState(initial),
    [preview, setPreview] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(JSON.stringify(initial));
  const feedback = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const dirty = JSON.stringify(a) !== saved;
  useEffect(() => onStateChange({ dirty, busy }), [dirty, busy, onStateChange]);
  useEffect(() => {
    if (message && !busy) feedback.current?.showModal();
  }, [message, busy]);
  useEffect(() => {
    if (!dirty && !busy) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, busy]);
  async function save(publish = false, archive = false) {
    trigger.current = document.activeElement as HTMLElement;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await api("/staff/articles/" + a.id, "PUT", {
        ...a,
        status: archive ? "archived" : publish ? "published" : "draft",
      });
      const next = {
        ...a,
        status: archive ? "archived" : publish ? "published" : "draft",
      } as Article;
      setA(next);
      setSaved(JSON.stringify(next));
      try {
        await onSaved();
      } catch {
        setError(
          "مقاله ذخیره شد، اما فهرست به‌روز نشد. صفحه را دوباره باز کنید.",
        );
      }
      setMessage(
        archive
          ? "مقاله بایگانی شد."
          : publish
            ? "مقاله منتشر شد."
            : "پیش‌نویس ذخیره شد.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="form-card stack article-editor">
      <div>
        <span className="eyebrow">ویرایش مقاله</span>
        <h2>{a.title || "مقاله جدید"}</h2>
        <p>
          {dirty ? "تغییرات ذخیره نشده" : "متن و تصویر مقاله را آماده کنید."}
        </p>
      </div>
      <fieldset disabled={busy} className="product-step-fields stack">
        <label>
          عنوان
          <input
            value={a.title}
            onChange={(e) => setA({ ...a, title: e.target.value })}
          />
        </label>
        <label>
          نشانی صفحه
          <input
            dir="ltr"
            value={a.slug}
            onChange={(e) => setA({ ...a, slug: e.target.value })}
          />
        </label>
        <label>
          خلاصه
          <textarea
            value={a.excerpt}
            onChange={(e) => setA({ ...a, excerpt: e.target.value })}
          />
        </label>
        <label>
          متن مقاله · Markdown با پیش‌نمایش زنده
          <textarea
            style={{ minHeight: 300 }}
            value={a.body}
            onChange={(e) => setA({ ...a, body: e.target.value })}
          />
        </label>
        <label>
          تصویر اصلی
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={busy}
            onChange={async (e) => {
              if (!e.target.files?.[0]) return;
              setBusy(true);
              try {
                const f = new FormData();
                f.set("image", e.target.files[0]);
                const v = await api<{ url: string }>(
                  "/staff/uploads",
                  "POST",
                  f,
                );
                setA({ ...a, image: v.url });
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          />
        </label>
        {a.image ? <p className="muted">تصویر انتخاب شده است.</p> : null}
        <fieldset>
          <legend>محصولات مرتبط</legend>
          <label>
            جستجوی همه محصولات
            <input
              type="search"
              value={productQuery}
              onChange={(e) => {
                setProductQuery(e.target.value);
                setOptionPage(1);
              }}
            />
          </label>
          {[
            ...knownProducts.filter(
              (p) =>
                a.productIds.includes(p.id) &&
                !options.some((o) => o.id === p.id),
            ),
            ...options,
          ].map((p) => (
            <label key={p.id} className="check-label">
              <input
                type="checkbox"
                checked={a.productIds.includes(p.id)}
                onChange={(e) => {
                  if (e.target.checked)
                    setKnownProducts((prev) =>
                      prev.some((x) => x.id === p.id) ? prev : [...prev, p],
                    );
                  setA({
                    ...a,
                    productIds: e.target.checked
                      ? [...a.productIds, p.id]
                      : a.productIds.filter((id) => id !== p.id),
                  });
                }}
              />
              {p.name}
            </label>
          ))}
          {optionError && (
            <p role="alert" className="error">
              {optionError}
            </p>
          )}
          <div className="inline-actions">
            <button
              type="button"
              className="button secondary"
              disabled={optionPage === 1}
              onClick={() => setOptionPage((p) => p - 1)}
            >
              محصولات قبلی
            </button>
            <button
              type="button"
              className="button secondary"
              disabled={optionPage * 25 >= optionTotal}
              onClick={() => setOptionPage((p) => p + 1)}
            >
              محصولات بعدی
            </button>
          </div>
        </fieldset>
      </fieldset>
      <div className="inline-actions">
        {a.status !== "archived" && (
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => save(false, true)}
          >
            بایگانی مقاله
          </button>
        )}
        <button
          className="button secondary"
          disabled={busy}
          onClick={() => save()}
        >
          ذخیره پیش‌نویس
        </button>
        {owner ? (
          <button className="button" disabled={busy} onClick={() => save(true)}>
            انتشار مقاله
          </button>
        ) : null}
        <button
          className="button secondary"
          disabled={busy}
          aria-expanded={preview}
          onClick={() => setPreview(!preview)}
        >
          پیش‌نمایش
        </button>
      </div>
      {preview ? (
        <div className="preview-pane">
          <h2>{a.title}</h2>
          <RichText text={a.body} />
        </div>
      ) : null}
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      <dialog
        ref={feedback}
        className="product-feedback"
        aria-labelledby="article-feedback-title"
        onClose={() => {
          setMessage("");
          trigger.current?.focus();
        }}
      >
        <h2 id="article-feedback-title">{message}</h2>
        <p role="status">{a.title}</p>
        <button
          className="button full"
          onClick={() => feedback.current?.close()}
        >
          ادامه ویرایش
        </button>
      </dialog>
    </div>
  );
}
