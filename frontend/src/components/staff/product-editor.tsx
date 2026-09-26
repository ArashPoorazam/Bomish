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
          {owner ? (
            <label>
              قیمت هر کیلو (تومان)
              <input
                inputMode="numeric"
                required
                value={p.priceRials / 10}
                onChange={(e) =>
                  field("priceRials", Number(digits(e.target.value)) * 10)
                }
              />
            </label>
          ) : null}
          <label className="span-2">
            خلاصه محصول
            <input
              required
              value={p.summary}
              onChange={(e) => field("summary", e.target.value)}
            />
          </label>
          {(
            [
              "description",
              "uses",
              "preparation",
              "storage",
              "ingredients",
              "allergens",
            ] as const
          ).map((k, i) => (
            <label key={k} className="span-2">
              {
                [
                  "معرفی و توضیحات",
                  "کاربردهای آشپزی",
                  "روش استفاده",
                  "روش نگهداری",
                  "ترکیبات",
                  "اطلاعات حساسیت‌زا",
                ][i]
              }
              <textarea
                value={p[k]}
                onChange={(e) => field(k, e.target.value)}
                placeholder={
                  k === "description"
                    ? "برای عنوان بخش از ## و برای پاراگراف جدید از یک خط خالی استفاده کنید."
                    : undefined
                }
              />
            </label>
          ))}
          {(["minGrams", "stepGrams", "maxGrams"] as const).map((k, i) => (
            <label key={k}>
              {["حداقل وزن (گرم)", "گام وزن (گرم)", "حداکثر وزن (گرم)"][i]}
              <input
                inputMode="numeric"
                required
                value={p[k]}
                onChange={(e) => field(k, Number(digits(e.target.value)))}
              />
            </label>
          ))}
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
        <fieldset>
          <legend>محصولات پیشنهادی</legend>
          {products
            .filter((x) => x.id !== p.id)
            .map((x) => (
              <label key={x.id} className="check-label">
                <input
                  type="checkbox"
                  checked={p.relatedIds.includes(x.id)}
                  onChange={(e) =>
                    field(
                      "relatedIds",
                      e.target.checked
                        ? [...p.relatedIds, x.id]
                        : p.relatedIds.filter((id) => id !== x.id),
                    )
                  }
                />
                {x.name}
              </label>
            ))}
        </fieldset>
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
