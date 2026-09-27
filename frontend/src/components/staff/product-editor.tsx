"use client";
import { useEffect, useState } from "react";
import Image from "next/image";
import { api } from "@/lib/api";
import type { Product, Category } from "@/lib/types";
import { RichText } from "@/components/rich-text";
import { digits, statuses } from "@/lib/format";
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
    availableGrams: 0,
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
  onSaved,
}: {
  product: Product;
  products: Product[];
  categories: Category[];
  owner: boolean;
  onSaved: () => Promise<void>;
}) {
  const [p, setP] = useState(product),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [preview, setPreview] = useState(false),
    [delta, setDelta] = useState(""),
    [reason, setReason] = useState("");
  useEffect(() => {
    setP({
      ...product,
      images: product.images || [],
      tags: product.tags || [],
      aliases: product.aliases || [],
      relatedIds: product.relatedIds || [],
      nutrients: product.nutrients || [],
      packages: product.packages || [],
      sections: product.sections || [],
    });
  }, [product]);
  useEffect(() => {
    setMessage("");
    setError("");
  }, [product.id]);
  function field<K extends keyof Product>(k: K, v: Product[K]) {
    setP((x) => ({ ...x, [k]: v }));
  }
  async function save(publish = false) {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      await api("/staff/products/" + p.id, "PUT", p);
      if (publish) await api("/staff/products/" + p.id + "/publish", "POST");
      await onSaved();
      setMessage(
        publish
          ? "محصول منتشر شد."
          : "پیش‌نویس ذخیره شد؛ نسخه عمومی تا تأیید مالک تغییر نمی‌کند.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function upload(file?: File) {
    if (!file) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.set("image", file);
      const v = await api<{ url: string }>("/staff/uploads", "POST", form);
      field("images", [...p.images, v.url]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function stock() {
    setBusy(true);
    setError("");
    try {
      await api(`/staff/products/${p.id}/inventory`, "POST", {
        deltaGrams: Number(digits(delta)),
        reason,
      });
      setMessage("موجودی به‌روز شد.");
      setDelta("");
      await onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="form-card">
      <div className="between">
        <h2>{p.name || "محصول جدید"}</h2>
        <span className="badge">{statuses[p.status]}</span>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
        className="stack"
        style={{ marginTop: 24 }}
      >
        <div className="form-grid">
          <label>
            نام محصول
            <input
              required
              value={p.name}
              onChange={(e) => field("name", e.target.value)}
            />
          </label>
          <label>
            نشانی صفحه
            <input
              required
              dir="ltr"
              value={p.slug}
              onChange={(e) => field("slug", e.target.value)}
              placeholder="turmeric"
            />
          </label>
          <label>
            دسته‌بندی
            <select
              aria-label="دسته‌بندی"
              required
              value={p.categoryId}
              onChange={(e) => field("categoryId", e.target.value)}
            >
              <option value="">انتخاب کنید</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="span-2">
            خلاصه محصول
            <input
              required
              value={p.summary}
              onChange={(e) => field("summary", e.target.value)}
            />
          </label>
          <label className="span-2">
            معرفی کوتاه
            <textarea
              value={p.description}
              onChange={(e) => field("description", e.target.value)}
            />
          </label>
        </div>
        {p.description && (
          <details>
            <summary>پیش‌نمایش زنده معرفی</summary>
            <RichText text={p.description} />
          </details>
        )}
        <fieldset className="stack">
          <legend>بسته‌های قابل خرید</legend>
          {p.packages.map((pack, i) => (
            <div className="package-editor" key={pack.id}>
              <label>
                مقدار
                <input
                  type="number"
                  min="0.001"
                  step="any"
                  required
                  value={pack.amount}
                  onChange={(e) =>
                    field(
                      "packages",
                      p.packages.map((x, j) =>
                        i === j ? { ...x, amount: Number(e.target.value) } : x,
                      ),
                    )
                  }
                />
              </label>
              <label>
                واحد
                <select
                  value={pack.unit}
                  onChange={(e) =>
                    field(
                      "packages",
                      p.packages.map((x, j) =>
                        i === j
                          ? { ...x, unit: e.target.value as typeof pack.unit }
                          : x,
                      ),
                    )
                  }
                >
                  <option value="g">گرم</option>
                  <option value="kg">کیلوگرم</option>
                  <option value="ml">میلی‌لیتر</option>
                  <option value="l">لیتر</option>
                </select>
              </label>
              {owner && (
                <label>
                  قیمت بسته (تومان)
                  <input
                    type="number"
                    min="1"
                    required
                    value={pack.priceRials / 10}
                    onChange={(e) =>
                      field(
                        "packages",
                        p.packages.map((x, j) =>
                          i === j
                            ? { ...x, priceRials: Number(e.target.value) * 10 }
                            : x,
                        ),
                      )
                    }
                  />
                </label>
              )}
              <label>
                سقف خرید
                <input
                  type="number"
                  min="1"
                  max="1000"
                  required
                  value={pack.maxQuantity}
                  onChange={(e) =>
                    field(
                      "packages",
                      p.packages.map((x, j) =>
                        i === j
                          ? { ...x, maxQuantity: Number(e.target.value) }
                          : x,
                      ),
                    )
                  }
                />
              </label>
              {(pack.unit === "l" || pack.unit === "ml") && (
                <label>
                  وزن ارسال (گرم)
                  <input
                    type="number"
                    min="1"
                    required
                    value={pack.shippingGrams}
                    onChange={(e) =>
                      field(
                        "packages",
                        p.packages.map((x, j) =>
                          i === j
                            ? { ...x, shippingGrams: Number(e.target.value) }
                            : x,
                        ),
                      )
                    }
                  />
                </label>
              )}
              <button
                type="button"
                className="text-link"
                onClick={() =>
                  field(
                    "packages",
                    p.packages.filter((_, j) => i !== j),
                  )
                }
              >
                حذف بسته
              </button>
            </div>
          ))}
          <button
            type="button"
            className="button secondary"
            onClick={() =>
              field("packages", [
                ...p.packages,
                {
                  id: crypto.randomUUID(),
                  amount: 100,
                  unit: "g",
                  priceRials: 0,
                  maxQuantity: 5,
                  shippingGrams: 0,
                },
              ])
            }
          >
            + افزودن بسته
          </button>
        </fieldset>
        <details>
          <summary>اطلاعات تکمیلی محصول · اختیاری</summary>
          <div className="stack">
            <datalist id="section-titles">
              {[
                "برای چه غذاهایی مناسب است؟",
                "چطور استفاده کنیم؟",
                "چطور نگهداری کنیم؟",
                "ترکیبات",
                "اطلاعات حساسیت‌زا",
              ].map((x) => (
                <option key={x} value={x} />
              ))}
            </datalist>
            {p.sections.map((section, i) => (
              <div className="stack form-card" key={i}>
                <label>
                  عنوان بخش · انتخاب یا عنوان دلخواه
                  <input
                    list="section-titles"
                    required
                    value={section.title}
                    onChange={(e) =>
                      field(
                        "sections",
                        p.sections.map((x, j) =>
                          i === j ? { ...x, title: e.target.value } : x,
                        ),
                      )
                    }
                  />
                </label>
                <label>
                  متن بخش
                  <textarea
                    value={section.body}
                    onChange={(e) =>
                      field(
                        "sections",
                        p.sections.map((x, j) =>
                          i === j ? { ...x, body: e.target.value } : x,
                        ),
                      )
                    }
                  />
                </label>
                <RichText text={section.body} />
                <button
                  type="button"
                  className="text-link"
                  onClick={() =>
                    field(
                      "sections",
                      p.sections.filter((_, j) => i !== j),
                    )
                  }
                >
                  حذف بخش
                </button>
              </div>
            ))}
            <button
              type="button"
              className="button secondary"
              onClick={() =>
                field("sections", [...p.sections, { title: "", body: "" }])
              }
            >
              + افزودن بخش توضیحات
            </button>
            {(
              [
                "uses",
                "preparation",
                "storage",
                "ingredients",
                "allergens",
              ] as const
            )
              .filter((k) => p[k])
              .map((k) => (
                <label key={k}>
                  اطلاعات قبلی محصول
                  <textarea
                    value={p[k]}
                    onChange={(e) => field(k, e.target.value)}
                  />
                  <RichText text={p[k]} />
                </label>
              ))}
          </div>
        </details>
        <details>
          <summary>برچسب‌ها و نام‌های جستجو</summary>
          <div className="form-grid">
            <label>
              نام‌های جایگزین (با ویرگول جدا کنید)
              <input
                value={p.aliases.join("، ")}
                onChange={(e) =>
                  field(
                    "aliases",
                    e.target.value
                      .split(/[,،]/)
                      .map((s) => s.trim())
                      .filter(Boolean),
                  )
                }
              />
            </label>
            <label>
              برچسب‌ها (با ویرگول جدا کنید)
              <input
                value={p.tags.join("، ")}
                onChange={(e) =>
                  field(
                    "tags",
                    e.target.value
                      .split(/[,،]/)
                      .map((s) => s.trim())
                      .filter(Boolean),
                  )
                }
              />
            </label>
          </div>
        </details>
        <fieldset>
          <legend>تصاویر محصول · تصویر اول، تصویر اصلی است</legend>
          <div className="image-editor">
            {p.images.map((src, i) => (
              <div key={src + i}>
                <Image
                  src={src}
                  alt={"تصویر " + (i + 1)}
                  width={70}
                  height={70}
                />
                <button
                  type="button"
                  disabled={i === 0}
                  aria-label={"بالا بردن تصویر " + (i + 1)}
                  onClick={() => {
                    const images = [...p.images];
                    [images[i - 1], images[i]] = [images[i], images[i - 1]];
                    field("images", images);
                  }}
                >
                  ↑
                </button>
                <button
                  type="button"
                  aria-label={"حذف تصویر " + (i + 1)}
                  onClick={() =>
                    field(
                      "images",
                      p.images.filter((_, n) => n !== i),
                    )
                  }
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <label style={{ marginTop: 12 }}>
            بارگذاری تصویر
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={busy}
              onChange={(e) => upload(e.target.files?.[0])}
            />
          </label>
        </fieldset>
        <p className="muted">
          پیشنهاد محصولات به‌صورت خودکار بر اساس دسته‌بندی و محبوبیت انجام
          می‌شود.
        </p>
        <details>
          <summary>ارزش غذایی · اختیاری</summary>
          <fieldset>
            <legend>ارزش غذایی در ۱۰۰ گرم · اختیاری</legend>
            {p.nutrients.map((n, i) => (
              <div className="form-grid" key={i}>
                <label>
                  نام ماده
                  <input
                    value={n.name}
                    onChange={(e) =>
                      field(
                        "nutrients",
                        p.nutrients.map((v, j) =>
                          j === i ? { ...v, name: e.target.value } : v,
                        ),
                      )
                    }
                  />
                </label>
                <label>
                  مقدار با واحد
                  <input
                    value={n.value}
                    onChange={(e) =>
                      field(
                        "nutrients",
                        p.nutrients.map((v, j) =>
                          j === i ? { ...v, value: e.target.value } : v,
                        ),
                      )
                    }
                  />
                </label>
                <button
                  type="button"
                  className="text-link icon-button"
                  onClick={() =>
                    field(
                      "nutrients",
                      p.nutrients.filter((_, j) => j !== i),
                    )
                  }
                >
                  حذف ردیف
                </button>
              </div>
            ))}
            <button
              type="button"
              className="button secondary"
              onClick={() =>
                field("nutrients", [...p.nutrients, { name: "", value: "" }])
              }
            >
              افزودن ماده غذایی
            </button>
            <label style={{ marginTop: 12 }}>
              منبع اطلاعات تغذیه‌ای
              <input
                value={p.nutrientSource}
                onChange={(e) => field("nutrientSource", e.target.value)}
              />
            </label>
          </fieldset>
        </details>
        <div className="editor-actions">
          <button className="button" disabled={busy}>
            ذخیره پیش‌نویس
          </button>
          {owner ? (
            <button
              className="button secondary"
              type="button"
              disabled={busy}
              onClick={() => save(true)}
            >
              ذخیره و انتشار
            </button>
          ) : null}
          <button
            className="button secondary"
            type="button"
            onClick={() => setPreview(!preview)}
          >
            پیش‌نمایش
          </button>
          {owner && products.some((x) => x.id === p.id) ? (
            <button
              className="button secondary"
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await api(`/staff/products/${p.id}/archive`, "POST");
                  await onSaved();
                  setMessage("محصول بایگانی شد.");
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              بایگانی محصول
            </button>
          ) : null}
        </div>
      </form>
      {preview ? (
        <div className="preview-pane">
          <h2>{p.name}</h2>
          <p>{p.summary}</p>
          {[p.description, p.uses, p.preparation, p.storage]
            .filter(Boolean)
            .map((text, i) => (
              <RichText text={text} key={i} />
            ))}
        </div>
      ) : null}
      {owner && products.some((x) => x.id === p.id) ? (
        <div className="stack" style={{ marginTop: 28 }}>
          <h3>اصلاح موجودی</h3>
          <p>
            موجودی قابل فروش: {p.availableGrams.toLocaleString("fa-IR")} گرم
          </p>
          <div className="form-grid">
            <label>
              تغییر موجودی به گرم (مثبت یا منفی)
              <input
                inputMode="numeric"
                value={delta}
                onChange={(e) => setDelta(e.target.value)}
              />
            </label>
            <label>
              دلیل تغییر
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
          </div>
          <button
            className="button secondary"
            disabled={busy || !delta || !reason}
            onClick={stock}
          >
            ثبت تغییر موجودی
          </button>
        </div>
      ) : null}
      {message ? (
        <p role="status" className="success">
          {message}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
