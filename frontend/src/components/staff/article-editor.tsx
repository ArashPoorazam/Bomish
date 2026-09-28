"use client";
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { Eye, Pencil, Upload, Trash2 } from "lucide-react";
import { api } from "@/lib/api";
import type { Article } from "@/lib/types";
import { statuses } from "@/lib/format";
import { RichText } from "@/components/rich-text";
import { ArticleProducts } from "./article-products";
import { ArticleMarkdownHelp } from "./article-markdown-help";
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
  owner,
  onSaved,
  onStateChange,
}: {
  article: Article;
  owner: boolean;
  onSaved: () => Promise<void>;
  onStateChange: (state: { dirty: boolean; busy: boolean }) => void;
}) {
  const [a, setA] = useState(() => ({
    ...article,
    productIds: article.productIds || [],
  }));
  const [saved, setSaved] = useState(() =>
    JSON.stringify({ ...article, productIds: article.productIds || [] }),
  );
  const [preview, setPreview] = useState(false);
  const [hasSaved, setHasSaved] = useState(!!article.updatedAt);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [attempted, setAttempted] = useState(false);
  const lock = useRef(false);
  const titleInput = useRef<HTMLInputElement>(null);
  const slugInput = useRef<HTMLInputElement>(null);
  const dirty = JSON.stringify(a) !== saved;
  const titleError = !a.title.trim();
  const slugError = !a.slug.trim() || /[\s/?#\\]/.test(a.slug.trim());
  const missing = [
    !a.excerpt.trim() && "خلاصه",
    !a.body.trim() && "متن مقاله",
    !a.image && "تصویر اصلی",
  ].filter(Boolean);
  useEffect(() => onStateChange({ dirty, busy }), [dirty, busy, onStateChange]);
  useEffect(() => {
    if (!dirty && !busy) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, busy]);
  function field<K extends keyof Article>(key: K, value: Article[K]) {
    setA((prev) => ({ ...prev, [key]: value }));
    setMessage("");
  }
  async function save(status: Article["status"]) {
    if (lock.current) return;
    setAttempted(true);
    setError("");
    setMessage("");
    if (titleError || slugError) {
      setPreview(false);
      (titleError ? titleInput : slugInput).current?.focus();
      setError("عنوان و نشانی مقاله را بررسی کنید.");
      return;
    }
    if (status === "published" && missing.length) {
      setError(`برای انتشار، ${missing.join("، ")} را تکمیل کنید.`);
      return;
    }
    lock.current = true;
    setBusy(true);
    try {
      const next = { ...a, title: a.title.trim(), slug: a.slug.trim(), status };
      await api("/staff/articles/" + a.id, "PUT", next);
      setA(next);
      setHasSaved(true);
      setSaved(JSON.stringify(next));
      setMessage(
        status === "published"
          ? "مقاله منتشر شد."
          : status === "archived"
            ? "مقاله بایگانی شد."
            : "پیش‌نویس ذخیره شد.",
      );
      try {
        await onSaved();
      } catch {
        setError(
          "مقاله ذخیره شد، اما فهرست به‌روز نشد. صفحه را دوباره باز کنید.",
        );
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function upload(file: File) {
    if (lock.current) return;
    setError("");
    if (
      !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
      file.size >= 8 * 1024 * 1024
    ) {
      setError("تصویر JPG، PNG یا WebP با حجم کمتر از ۸ مگابایت انتخاب کنید.");
      return;
    }
    lock.current = true;
    setBusy(true);
    setUploading(true);
    try {
      const body = new FormData();
      body.set("image", file);
      const result = await api<{ url: string }>("/staff/uploads", "POST", body);
      field("image", result.url);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
      setUploading(false);
    }
  }
  return (
    <div className="article-composer">
      <header className="article-composer-heading">
        <div>
          <h2>{hasSaved ? "ویرایش مقاله" : "مقاله جدید"}</h2>
          <p className="muted">
            از عنوان و متن شروع کنید، سپس تصویر و محصولات مرتبط را اضافه کنید.
          </p>
        </div>
        <span className="badge">{statuses[a.status]}</span>
      </header>
      <fieldset className="article-composer-fields" disabled={busy}>
        <div className="article-composer-layout">
          <div className="article-writing-column">
            <section
              className="article-section stack"
              aria-label="اطلاعات مقاله"
            >
              <label>
                <span>
                  عنوان مقاله <span className="muted">(ضروری)</span>
                </span>
                <input
                  ref={titleInput}
                  value={a.title}
                  placeholder="عنوانی روشن و جذاب برای مقاله"
                  aria-invalid={attempted && titleError}
                  aria-describedby={
                    attempted && titleError ? "article-title-error" : undefined
                  }
                  onChange={(e) => field("title", e.target.value)}
                />
              </label>
              {attempted && titleError && (
                <small className="error" id="article-title-error">
                  عنوان مقاله را وارد کنید.
                </small>
              )}
              <label>
                <span>
                  نشانی صفحه <span className="muted">(ضروری)</span>
                </span>
                <input
                  ref={slugInput}
                  dir="auto"
                  value={a.slug}
                  placeholder="راهنمای-انتخاب-محصول"
                  aria-invalid={attempted && slugError}
                  aria-describedby="article-slug-help"
                  onChange={(e) => field("slug", e.target.value)}
                />
              </label>
              <small
                id="article-slug-help"
                className={attempted && slugError ? "error" : "muted"}
              >
                نشانی کوتاه و یکتا، بدون فاصله یا / ? # بنویسید؛ کلمات را با خط
                تیره جدا کنید.
              </small>
              {a.slug && (
                <small className="article-url" dir="ltr">
                  /blog/{a.slug}
                </small>
              )}
              <label>
                خلاصه مقاله
                <textarea
                  rows={3}
                  value={a.excerpt}
                  placeholder="در چند جمله بگویید خواننده در این مقاله چه می‌آموزد."
                  onChange={(e) => field("excerpt", e.target.value)}
                />
              </label>
              <small className="muted">
                خلاصه در فهرست مجله نمایش داده می‌شود.
              </small>
            </section>
            <section
              className="article-section stack"
              aria-labelledby="article-body-title"
            >
              <div className="article-section-heading">
                <h3 id="article-body-title">متن مقاله</h3>
                <div className="article-view-switch" aria-label="نمای مقاله">
                  <button
                    type="button"
                    aria-pressed={!preview}
                    onClick={() => setPreview(false)}
                  >
                    <Pencil size={16} /> نوشتن
                  </button>
                  <button
                    type="button"
                    aria-pressed={preview}
                    onClick={() => setPreview(true)}
                  >
                    <Eye size={16} /> پیش‌نمایش
                  </button>
                </div>
              </div>
              {preview ? (
                <article className="article-preview">
                  {a.image && (
                    <Image src={a.image} alt="" width={1000} height={560} />
                  )}
                  <h2>{a.title || "عنوان مقاله"}</h2>
                  <p className="muted">{a.excerpt}</p>
                  {a.body ? (
                    <RichText text={a.body} />
                  ) : (
                    <p className="muted">
                      برای دیدن پیش‌نمایش، متن مقاله را بنویسید.
                    </p>
                  )}
                </article>
              ) : (
                <>
                  <label className="article-body-label">
                    <textarea
                      aria-labelledby="article-body-title"
                      className="article-body-input"
                      value={a.body}
                      placeholder="متن مقاله را اینجا بنویسید…"
                      onChange={(e) => field("body", e.target.value)}
                    />
                  </label>
                  <ArticleMarkdownHelp />
                </>
              )}
            </section>
            <ArticleProducts
              ids={a.productIds}
              onChange={(ids) => field("productIds", ids)}
            />
          </div>
          <aside className="article-settings-column">
            <section
              className="article-section stack"
              aria-labelledby="article-cover-title"
            >
              <h3 id="article-cover-title">تصویر اصلی</h3>
              {a.image ? (
                <Image
                  className="article-cover"
                  src={a.image}
                  alt="تصویر اصلی مقاله"
                  width={600}
                  height={340}
                />
              ) : (
                <div className="article-cover-empty">
                  <Upload size={28} />
                  <span>تصویر جلد مقاله را انتخاب کنید</span>
                </div>
              )}
              <label className="article-upload-label">
                {uploading
                  ? "در حال بارگذاری…"
                  : a.image
                    ? "تغییر تصویر"
                    : "انتخاب تصویر"}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file) void upload(file);
                  }}
                />
              </label>
              <small className="muted">
                JPG، PNG یا WebP · کمتر از ۸ مگابایت
              </small>
              {a.image && (
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => field("image", "")}
                >
                  <Trash2 size={16} /> حذف تصویر
                </button>
              )}
            </section>
            <section
              className="article-section stack"
              aria-labelledby="article-publish-title"
            >
              <h3 id="article-publish-title">ذخیره و انتشار</h3>
              <p className="muted">
                {dirty
                  ? "تغییرات هنوز ذخیره نشده‌اند."
                  : "تغییر ذخیره‌نشده‌ای ندارید."}
              </p>
              <p className="muted">
                برای ذخیره پیش‌نویس، عنوان و نشانی کافی است. برای انتشار مقاله
                باید متن، خلاصه و تصویر هم پر شود.
              </p>
              <button
                type="button"
                className="button secondary"
                onClick={() => void save("draft")}
              >
                ذخیره پیش‌نویس
              </button>
              {owner && (
                <button
                  type="button"
                  className="button"
                  onClick={() => void save("published")}
                >
                  {a.status === "published" ? "انتشار تغییرات" : "انتشار مقاله"}
                </button>
              )}
              <div className="article-feedback" aria-live="polite">
                {busy && (
                  <p role="status">
                    {uploading
                      ? "در حال بارگذاری تصویر…"
                      : "در حال ذخیره مقاله…"}
                  </p>
                )}
                {message && (
                  <p className="notice" role="status">
                    {message}
                  </p>
                )}
                {error && (
                  <p className="error" role="alert">
                    {error}
                  </p>
                )}
              </div>
              {hasSaved && a.status !== "archived" && (
                <div className="article-archive">
                  <button
                    type="button"
                    className="text-link"
                    onClick={() => void save("archived")}
                  >
                    بایگانی مقاله
                  </button>
                </div>
              )}
            </section>
          </aside>
        </div>
      </fieldset>
    </div>
  );
}
