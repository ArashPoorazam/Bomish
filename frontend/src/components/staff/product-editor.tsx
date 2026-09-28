"use client";
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ClipboardCheck,
  Eye,
  Save,
  Send,
  X,
} from "lucide-react";
import { api } from "@/lib/api";
import type { Product, Category } from "@/lib/types";
import { RichText } from "@/components/rich-text";
import { digits, fa, money, packageLabel, statuses } from "@/lib/format";
import { normalizeProduct, productIssues, productSteps } from "./product-form";
import { ProductBasics, ProductDetails } from "./product-content-fields";
import { ProductImages } from "./product-images";
import { ProductPackages } from "./product-packages";

export function newProduct(): Product {
  return {
    id: crypto.randomUUID(),
    slug: "",
    name: "",
    categoryId: "",
    status: "draft",
    packages: [],
    sections: [],
    discountPercent: 0,
    popularity: 0,
    priceRials: 0,
    minGrams: 100,
    stepGrams: 100,
    maxGrams: 25000,
    outOfStock: false,
    summary: "",
    description: "",
    uses: "",
    preparation: "",
    storage: "",
    ingredients: "",
    allergens: "",
    images: [],
    tags: [],
    aliases: [],
    relatedIds: [],
    nutrients: [],
    nutrientSource: "",
  };
}

export function ProductEditor({
  product,
  products,
  categories,
  owner,
  canPrice = owner,
  onSaved,
  onStateChange,
}: {
  product: Product;
  products: Product[];
  categories: Category[];
  owner: boolean;
  canPrice?: boolean;
  onSaved: () => Promise<void>;
  onStateChange: (state: { dirty: boolean; busy: boolean }) => void;
}) {
  // Normalize before the first render: legacy API records contain null arrays.
  const [p, setP] = useState(() => normalizeProduct(product));
  const [saved, setSaved] = useState(() =>
    JSON.stringify(normalizeProduct(product)),
  );
  const [step, setStep] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<{
    title: string;
    body: string;
  } | null>(null);
  const [preview, setPreview] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const feedback = useRef<HTMLDialogElement>(null);
  const feedbackTrigger = useRef<HTMLElement | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const dirty = JSON.stringify(p) !== saved;
  const locked = !!busy || uploading;
  const existing = products.find((x) => x.id === p.id);
  const issues = productIssues(p, true);
  useEffect(() => {
    onStateChange({ dirty, busy: locked });
  }, [dirty, locked, onStateChange]);
  useEffect(() => {
    if (!dirty && !locked) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, locked]);
  useEffect(() => {
    if (message && !locked) feedback.current?.showModal();
  }, [message, locked]);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);
  function field<K extends keyof Product>(key: K, value: Product[K]) {
    setP((current) => ({ ...current, [key]: value }));
    setError("");
  }
  function go(next: number) {
    setStep(next);
    setError("");
    requestAnimationFrame(() => heading.current?.focus());
  }
  async function save(publish: boolean) {
    if (locked) return;
    feedbackTrigger.current = document.activeElement as HTMLElement;
    const invalid = productIssues(p, publish);
    if (invalid.length) {
      setStep(invalid[0].step);
      setError(invalid[0].text);
      return;
    }
    setBusy(publish ? "publish" : "draft");
    setError("");
    let draftSaved = false;
    try {
      await api("/staff/products/" + p.id, "PUT", p);
      draftSaved = true;
      setSaved(JSON.stringify(p));
      if (publish) await api("/staff/products/" + p.id + "/publish", "POST");
      const next = { ...p, status: publish ? "published" : "draft" } as Product;
      setP(next);
      setSaved(JSON.stringify(next));
      setMessage(
        publish
          ? {
              title: "محصول منتشر شد",
              body: `«${p.name}» اکنون در فروشگاه قابل مشاهده است.`,
            }
          : {
              title: "پیش‌نویس ذخیره شد",
              body: "می‌توانید بعداً ادامه دهید. نسخه عمومی تا زمان انتشار تغییر نمی‌کند.",
            },
      );
      try {
        await onSaved();
      } catch {
        setError(
          "محصول ذخیره شد، اما فهرست به‌روز نشد. برای دریافت فهرست تازه صفحه را دوباره باز کنید.",
        );
      }
    } catch (e) {
      if (draftSaved) {
        const next = { ...p, status: "draft" } as Product;
        setP(next);
        setSaved(JSON.stringify(next));
      }
      setError(
        (draftSaved ? "پیش‌نویس ذخیره شد، اما انتشار انجام نشد: " : "") +
          (e as Error).message,
      );
    } finally {
      setBusy("");
    }
  }
  async function availability(outOfStock: boolean) {
    setBusy("availability");
    setError("");
    try {
      await api(`/staff/products/${p.id}/availability`, "POST", { outOfStock });
      setP((prev) => ({ ...prev, outOfStock }));
      setSaved((prev) => JSON.stringify({ ...JSON.parse(prev), outOfStock }));
      await onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  return (
    <div className="form-card product-wizard" aria-busy={locked}>
      <div className="product-editor-heading">
        <div>
          <span className="eyebrow">
            {existing ? "ویرایش محصول" : "محصول جدید"}
          </span>
          <h2>{p.name || "افزودن محصول"}</h2>
        </div>
        <div className="product-save-state">
          <span className="badge">{statuses[p.status]}</span>
          <small>
            {locked
              ? "در حال انجام…"
              : dirty
                ? "تغییرات ذخیره نشده"
                : existing
                  ? "همه تغییرات ذخیره شده"
                  : "هنوز ذخیره نشده"}
          </small>
        </div>
      </div>
      <nav className="product-steps" aria-label="مراحل محصول">
        {productSteps.map((item, i) => (
          <button
            key={item.title}
            type="button"
            aria-current={i === step ? "step" : undefined}
            disabled={locked}
            onClick={() => go(i)}
          >
            <span className="step-number">
              {i < step && !issues.some((issue) => issue.step === i) ? (
                <Check size={16} aria-hidden="true" />
              ) : (
                fa(i + 1)
              )}
            </span>
            <span>{item.title}</span>
          </button>
        ))}
      </nav>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (step < 4) go(step + 1);
          else void save(false);
        }}
      >
        <fieldset disabled={locked} className="product-step-fields">
          <div className="product-step-heading">
            <span className="eyebrow">
              مرحله {fa(step + 1)} از {fa(productSteps.length)}
            </span>
            <h3 ref={heading} tabIndex={-1}>
              {productSteps[step].title}
            </h3>
            <p>{productSteps[step].description}</p>
          </div>
          {step === 0 && (
            <ProductBasics p={p} field={field} categories={categories} />
          )}
          {step === 1 && (
            <ProductImages p={p} field={field} onBusy={setUploading} />
          )}
          {step === 2 && (
            <ProductPackages p={p} field={field} owner={canPrice} />
          )}
          {step === 3 && <ProductDetails p={p} field={field} />}
          {step === 4 && (
            <div className="stack">
              <div className="product-review-summary">
                {p.images[0] && (
                  <Image
                    src={p.images[0]}
                    alt={p.name}
                    width={100}
                    height={100}
                  />
                )}
                <div>
                  <h4>{p.name || "نام محصول وارد نشده"}</h4>
                  <p>
                    {categories.find((c) => c.id === p.categoryId)?.name ||
                      "بدون دسته‌بندی"}
                  </p>
                  <small>
                    {fa(p.images.length)} تصویر · {fa(p.packages.length)} بسته
                  </small>
                </div>
              </div>
              <div
                className={
                  issues.length ? "product-checklist" : "product-ready"
                }
              >
                <ClipboardCheck size={22} aria-hidden="true" />
                <div>
                  <strong>
                    {issues.length
                      ? "پیش از انتشار تکمیل کنید"
                      : "محصول آماده انتشار است"}
                  </strong>
                  {issues.length ? (
                    <ul>
                      {issues.map((issue, i) => (
                        <li key={i}>
                          <button type="button" onClick={() => go(issue.step)}>
                            {issue.text}
                            <ArrowLeft size={15} aria-hidden="true" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p>اطلاعات اصلی، تصاویر و بسته‌ها کامل هستند.</p>
                  )}
                </div>
              </div>
              <div className="between">
                <h4>نمای محصول برای مشتری</h4>
                <button
                  type="button"
                  className="button secondary"
                  aria-expanded={preview}
                  aria-controls="product-preview"
                  onClick={() => setPreview(!preview)}
                >
                  <Eye size={17} aria-hidden="true" />
                  {preview ? "بستن پیش‌نمایش" : "پیش‌نمایش"}
                </button>
              </div>
              {preview && (
                <div
                  id="product-preview"
                  className="preview-pane product-preview"
                >
                  <h2>{p.name}</h2>
                  <p>{p.summary}</p>
                  <div className="review-images">
                    {p.images.map((src, i) => (
                      <Image
                        key={src + i}
                        src={src}
                        alt={`تصویر ${i + 1} محصول`}
                        width={180}
                        height={140}
                      />
                    ))}
                  </div>
                  <div className="review-packages">
                    {p.packages.map((pack) => (
                      <div key={pack.id}>
                        <strong>{packageLabel(pack)}</strong>
                        {owner && <span>{money(pack.priceRials)} تومان</span>}
                      </div>
                    ))}
                  </div>
                  {[
                    p.description,
                    p.uses,
                    p.preparation,
                    p.storage,
                    p.ingredients,
                    p.allergens,
                  ]
                    .filter(Boolean)
                    .map((text, i) => (
                      <RichText key={i} text={text} />
                    ))}
                  {p.sections.map((s, i) => (
                    <section key={i}>
                      <h3>{s.title}</h3>
                      <RichText text={s.body} />
                    </section>
                  ))}
                  {p.nutrients.length > 0 && (
                    <section>
                      <h3>ارزش غذایی در ۱۰۰ گرم</h3>
                      {p.nutrients.map((n, i) => (
                        <p key={i}>
                          {n.name}: {n.value}
                        </p>
                      ))}
                      <small>{p.nutrientSource}</small>
                    </section>
                  )}
                </div>
              )}
              <p className="notice">
                {owner
                  ? "با انتشار، تغییرات برای مشتری‌ها نمایش داده می‌شود. با ذخیره پیش‌نویس می‌توانید بعداً ادامه دهید."
                  : "محصول را به‌صورت پیش‌نویس ذخیره کنید تا مالک قیمت‌ها را تعیین و آن را منتشر کند."}
              </p>
            </div>
          )}
        </fieldset>
        {error && (
          <div ref={errorRef} tabIndex={-1} role="alert" className="error">
            {error}
          </div>
        )}
        <div className="product-editor-footer">
          <div className="product-navigation">
            {step > 0 && (
              <button
                type="button"
                className="button secondary"
                disabled={locked}
                onClick={() => go(step - 1)}
              >
                <ArrowRight size={16} aria-hidden="true" />
                مرحله قبل
              </button>
            )}
            <button
              type="button"
              className="button secondary draft-button"
              disabled={locked}
              onClick={() => void save(false)}
            >
              <Save size={16} aria-hidden="true" />
              {busy === "draft" ? "در حال ذخیره…" : "ذخیره پیش‌نویس"}
            </button>
          </div>
          {step < 4 ? (
            <button
              className="button"
              type="button"
              disabled={locked}
              onClick={() => go(step + 1)}
            >
              مرحله بعد
              <ArrowLeft size={16} aria-hidden="true" />
            </button>
          ) : (
            owner && (
              <button
                className="button publish-button"
                type="button"
                disabled={locked}
                onClick={() => void save(true)}
              >
                <Send size={16} aria-hidden="true" />
                {busy === "publish" ? "در حال انتشار…" : "ذخیره و انتشار"}
              </button>
            )
          )}
        </div>
      </form>
      {existing && (
        <section
          className="product-availability stack"
          aria-label="وضعیت فروش محصول"
        >
          <h3>وضعیت فروش محصول</h3>
          <div className="inline-actions">
            <button
              type="button"
              className="button secondary"
              disabled={locked}
              aria-pressed={!p.outOfStock}
              onClick={() => void availability(false)}
            >
              موجود
            </button>
            <button
              type="button"
              className="button secondary"
              disabled={locked}
              aria-pressed={p.outOfStock}
              onClick={() => void availability(true)}
            >
              ناموجود
            </button>
          </div>
          <p>محصول بایگانی‌شده در فروشگاه نمایش داده نمی‌شود.</p>
          <button
            type="button"
            className="button subtle-danger"
            disabled={locked}
            onClick={async () => {
              if (
                !window.confirm(
                  "محصول بایگانی و از فروشگاه پنهان شود؟ تغییرات ذخیره‌نشده در این فرم حفظ می‌شوند.",
                )
              )
                return;
              feedbackTrigger.current = document.activeElement as HTMLElement;
              setBusy("archive");
              setError("");
              try {
                await api(`/staff/products/${p.id}/archive`, "POST");
                field("status", "archived");
                if (!dirty)
                  setSaved(JSON.stringify({ ...p, status: "archived" }));
                setMessage({
                  title: "محصول بایگانی شد",
                  body: "این محصول دیگر در فروشگاه نمایش داده نمی‌شود.",
                });
                await onSaved();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy("");
              }
            }}
          >
            بایگانی محصول
          </button>
        </section>
      )}
      <dialog
        ref={feedback}
        className="product-feedback"
        aria-labelledby="product-feedback-title"
        onClose={() => {
          setMessage(null);
          feedbackTrigger.current?.focus();
        }}
      >
        <button
          className="button secondary dialog-close"
          aria-label="بستن پیام"
          onClick={() => feedback.current?.close()}
        >
          <X size={18} />
        </button>
        <CheckCircle2 className="feedback-check" size={52} aria-hidden="true" />
        <div role="status">
          <h2 id="product-feedback-title">{message?.title}</h2>
          <p>{message?.body}</p>
        </div>
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
