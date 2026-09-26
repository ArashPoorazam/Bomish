"use client";
import { useEffect, useState } from "react";
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
}: {
  article: Article;
  products: Product[];
  owner: boolean;
  onSaved: () => Promise<void>;
}) {
  const [a, setA] = useState(article),
    [preview, setPreview] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    setA({ ...article, productIds: article.productIds || [] });
  }, [article]);
  useEffect(() => {
    setMessage("");
    setError("");
  }, [article.id]);
  async function save(publish = false) {
    setBusy(true);
    setError("");
    try {
      await api("/staff/articles/" + a.id, "PUT", {
        ...a,
        status: publish ? "published" : "draft",
      });
      await onSaved();
      setMessage(publish ? "مقاله منتشر شد." : "پیش‌نویس ذخیره شد.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="form-card stack">
      <h2>{a.title || "مقاله جدید"}</h2>
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
        متن مقاله · برای تیتر از ## استفاده کنید
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
              const v = await api<{ url: string }>("/staff/uploads", "POST", f);
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
        {products.map((p) => (
          <label key={p.id} className="check-label">
            <input
              type="checkbox"
              checked={a.productIds.includes(p.id)}
              onChange={(e) =>
                setA({
                  ...a,
                  productIds: e.target.checked
                    ? [...a.productIds, p.id]
                    : a.productIds.filter((id) => id !== p.id),
                })
              }
            />
            {p.name}
          </label>
        ))}
      </fieldset>
      <div className="inline-actions">
        <button className="button" disabled={busy} onClick={() => save()}>
          ذخیره پیش‌نویس
        </button>
        {owner ? (
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => save(true)}
          >
            انتشار مقاله
          </button>
        ) : null}
        <button
          className="button secondary"
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
      {message ? (
        <p className="success" role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}
