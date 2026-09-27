import { useState } from "react";
import { RichText } from "@/components/rich-text";
import type { Category } from "@/lib/types";
import type { ProductFields } from "./product-form";

export function ProductBasics({
  p,
  field,
  categories,
}: ProductFields & { categories: Category[] }) {
  return (
    <div className="stack">
      <div className="form-grid">
        <label>
          نام محصول
          <input
            value={p.name}
            onChange={(e) => field("name", e.target.value)}
          />
        </label>
        <label>
          نشانی صفحه
          <input
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
          خلاصه محصول · برای انتشار
          <input
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
          <summary>پیش‌نمایش معرفی</summary>
          <RichText text={p.description} />
        </details>
      )}
    </div>
  );
}
export function ProductDetails({ p, field }: ProductFields) {
  return (
    <div className="stack">
      <details open>
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
                className="button subtle-danger"
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
                {
                  {
                    uses: "کاربردها",
                    preparation: "روش استفاده",
                    storage: "شرایط نگهداری",
                    ingredients: "ترکیبات",
                    allergens: "اطلاعات حساسیت‌زا",
                  }[k]
                }
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
          <KeywordInput
            key={p.id + "aliases"}
            label="نام‌های جایگزین (با ویرگول جدا کنید)"
            values={p.aliases}
            onChange={(v) => field("aliases", v)}
          />
          <KeywordInput
            key={p.id + "tags"}
            label="برچسب‌ها (با ویرگول جدا کنید)"
            values={p.tags}
            onChange={(v) => field("tags", v)}
          />
        </div>
      </details>
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
                className="button subtle-danger"
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
    </div>
  );
}
function KeywordInput({
  label,
  values,
  onChange,
}: {
  label: string;
  values: string[];
  onChange: (v: string[]) => void;
}) {
  const [text, setText] = useState(values.join("، "));
  return (
    <label>
      {label}
      <input
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          onChange(
            e.target.value
              .split(/[,،]/)
              .map((s) => s.trim())
              .filter(Boolean),
          );
        }}
      />
      <small className="muted">بین هر دو عبارت، ویرگول بگذارید.</small>
    </label>
  );
}
