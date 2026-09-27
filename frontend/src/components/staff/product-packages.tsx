import { Plus, Trash2, Package as PackageIcon } from "lucide-react";
import type { Package } from "@/lib/types";
import { digits, fa, packageLabel, money } from "@/lib/format";
import type { ProductFields } from "./product-form";

export function ProductPackages({
  p,
  field,
  owner,
}: ProductFields & { owner: boolean }) {
  function update(index: number, value: Partial<Package>) {
    field(
      "packages",
      p.packages.map((pack, i) => (i === index ? { ...pack, ...value } : pack)),
    );
  }
  return (
    <div className="stack">
      {!owner && (
        <p className="notice">
          قیمت بسته‌ها پیش از انتشار توسط مالک تعیین می‌شود.
        </p>
      )}
      {!p.packages.length && (
        <div className="product-empty">
          <PackageIcon size={32} />
          <h4>اولین بسته را بسازید</h4>
          <p>مثلاً یک بسته ۱۰۰ گرمی یا یک بطری ۱ لیتری.</p>
        </div>
      )}
      {p.packages.map((pack, i) => (
        <fieldset className="product-package" key={pack.id}>
          <legend>
            بسته {fa(i + 1)} · {packageLabel(pack)}
          </legend>
          <div className="form-grid">
            <label>
              مقدار
              <input
                type="number"
                min="0.001"
                max="1000000"
                step="any"
                value={pack.amount || ""}
                onChange={(e) => update(i, { amount: Number(e.target.value) })}
              />
            </label>
            <label>
              واحد
              <select
                value={pack.unit}
                onChange={(e) =>
                  update(i, { unit: e.target.value as Package["unit"] })
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
                <div className="price-input">
                  <input
                    aria-label="قیمت بسته (تومان)"
                    dir="ltr"
                    inputMode="numeric"
                    placeholder="180,000"
                    value={
                      pack.priceRials
                        ? (pack.priceRials / 10).toLocaleString("en-US", {
                            maximumFractionDigits: 0,
                          })
                        : ""
                    }
                    onChange={(e) => {
                      const value = digits(
                        e.target.value.replace(/[,٬،\s]/g, ""),
                      );
                      if (/^\d*$/.test(value) && Number(value) <= 10000000000)
                        update(i, { priceRials: Number(value) * 10 });
                    }}
                  />
                  <span>تومان</span>
                </div>
                <small className="muted">
                  {pack.priceRials
                    ? `${money(pack.priceRials)} تومان برای هر بسته`
                    : "برای پیش‌نویس می‌توانید قیمت را بعداً وارد کنید."}
                </small>
              </label>
            )}
            <label>
              سقف خرید
              <input
                type="number"
                min="1"
                max="1000"
                value={pack.maxQuantity || ""}
                onChange={(e) =>
                  update(i, { maxQuantity: Number(e.target.value) })
                }
              />
              <small className="muted">
                بیشترین تعداد این بسته در هر سفارش
              </small>
            </label>
            {(pack.unit === "l" || pack.unit === "ml") && (
              <label>
                وزن ارسال (گرم)
                <input
                  type="number"
                  min="1"
                  max="1000000"
                  value={pack.shippingGrams || ""}
                  onChange={(e) =>
                    update(i, { shippingGrams: Number(e.target.value) })
                  }
                />
                <small className="muted">
                  وزن واقعی بسته برای محاسبه هزینه ارسال
                </small>
              </label>
            )}
          </div>
          <div className="package-footer">
            <button
              type="button"
              className="button subtle-danger"
              onClick={() =>
                field(
                  "packages",
                  p.packages.filter((_, j) => i !== j),
                )
              }
            >
              <Trash2 size={16} aria-hidden="true" />
              حذف بسته
            </button>
          </div>
        </fieldset>
      ))}
      <button
        type="button"
        className="button secondary add-package"
        disabled={p.packages.length >= 50}
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
        <Plus size={18} aria-hidden="true" />
        افزودن بسته
      </button>
    </div>
  );
}
