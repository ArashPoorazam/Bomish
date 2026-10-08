import { useState, useId } from "react";
import type { Package } from "@/lib/types";
import { digits, fa, packageLabel } from "@/lib/format";
import { measurementIssues } from "@/lib/shipping";
import type { ProductFields } from "./product-form";
export function MeasurementNumber({
  label,
  value,
  onChange,
  scale = 1,
  max = 1000000,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  scale?: number;
  max?: number;
}) {
  const errorId = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const invalid = value < 0 || value > max || !Number.isFinite(value);
  return (
    <label>
      {label}
      <input
        dir="ltr"
        inputMode={scale === 10 ? "decimal" : "numeric"}
        aria-invalid={invalid}
        aria-describedby={invalid ? errorId : undefined}
        value={draft ?? (value ? String(value / scale) : "")}
        onChange={(e) => {
          const text = digits(e.target.value).replace(/٫/g, ".");
          setDraft(text);
          const valid = (scale === 10 ? /^\d+(\.\d?)?$/ : /^\d+$/).test(text);
          onChange(
            text === "" ? 0 : valid ? Math.round(Number(text) * scale) : -1,
          );
        }}
        onBlur={() => {
          if (!invalid) setDraft(null);
        }}
      />
      {invalid && (
        <small id={errorId} className="error">
          مقدار مثبت و در محدوده وارد کنید.
        </small>
      )}
    </label>
  );
}
export function ProductMeasurements({ p, field }: ProductFields) {
  const update = (id: string, v: Partial<Package>) =>
    field(
      "packages",
      p.packages.map((x) => (x.id === id ? { ...x, ...v } : x)),
    );
  return (
    <div className="stack">
      <p className="notice">
        ابعاد و وزن را با ظرف، درپوش و محافظ دور همان محصول اندازه بگیرید؛ کارتن
        ارسال جداگانه محاسبه می‌شود.
      </p>
      <div
        className="shipping-box-diagram"
        role="img"
        aria-label="جعبه: طول و عرض روی قاعده، ارتفاع عمودی"
      >
        <span>طول ↔</span>
        <svg viewBox="0 0 120 110" aria-hidden="true">
          <path
            d="M15 35 L75 35 L105 15 L45 15 Z"
            fill="#eef4e6"
            stroke="currentColor"
          />
          <path d="M15 35 V95 H75 V35 Z" fill="#dce9d9" stroke="currentColor" />
          <path
            d="M75 35 L105 15 V75 L75 95 Z"
            fill="#b6ceb1"
            stroke="currentColor"
          />
        </svg>
        <span>↕ ارتفاع</span>
        <small>عرض ↗</small>
      </div>
      <p>
        برای بطری، پهن‌ترین قسمت همراه محافظ را اندازه بگیرید. محصول ایستاده
        می‌ماند.
      </p>
      {!p.packages.length && (
        <p>ابتدا در مرحله بسته‌ها یک بسته محصول اضافه کنید.</p>
      )}
      {p.packages.map((pack) => (
        <section className="product-package stack" key={pack.id}>
          <div className="between">
            <h4>{packageLabel(pack)}</h4>
            <span className="badge">
              {measurementIssues(pack).length
                ? "اطلاعات ارسال ناقص"
                : "اندازه‌گیری کامل"}
            </span>
          </div>
          <div className="form-grid">
            {(
              [
                ["lengthMm", "طول"],
                ["widthMm", "عرض"],
                ["heightMm", "ارتفاع"],
              ] as const
            ).map(([key, label]) => (
              <MeasurementNumber
                key={`${pack.id}-${key}`}
                label={`${label} (سانتی‌متر)`}
                value={pack[key] ?? 0}
                max={3000}
                scale={10}
                onChange={(v) =>
                  update(pack.id, { [key]: v, shippingVerified: false })
                }
              />
            ))}
            <MeasurementNumber
              label="وزن بسته آماده ارسال (گرم)"
              value={pack.shippingGrams}
              onChange={(v) =>
                update(pack.id, { shippingGrams: v, shippingVerified: false })
              }
            />
          </div>
          <label>
            کپی اندازه‌ها از بسته دیگر
            <select
              aria-label="کپی اندازه‌ها از بسته دیگر"
              value=""
              onChange={(e) => {
                const source = p.packages.find((x) => x.id === e.target.value);
                if (source)
                  update(pack.id, {
                    lengthMm: source.lengthMm,
                    widthMm: source.widthMm,
                    heightMm: source.heightMm,
                    shippingGrams: source.shippingGrams,
                    shippingVerified: false,
                  });
              }}
            >
              <option value="">انتخاب بسته</option>
              {p.packages
                .filter((x) => x.id !== pack.id)
                .map((x) => (
                  <option key={x.id} value={x.id}>
                    {packageLabel(x)}
                  </option>
                ))}
            </select>
          </label>
          <label className="check-label">
            <input
              type="checkbox"
              checked={!!pack.shippingVerified}
              onChange={(e) =>
                update(pack.id, { shippingVerified: e.target.checked })
              }
            />
            اندازه‌ها و وزن واقعی این بسته را تأیید می‌کنم
          </label>
          {measurementIssues(pack).length > 0 && (
            <p className="muted">
              نیازمند تکمیل: {measurementIssues(pack).join("، ")}
            </p>
          )}
        </section>
      ))}
    </div>
  );
}
export function MeasurementReview({
  packages,
  onFix,
}: {
  packages: Package[];
  onFix: () => void;
}) {
  return (
    <section className="stack">
      <h4>بسته‌بندی و ارسال</h4>
      {packages.map((p) => (
        <div key={p.id}>
          <strong>{packageLabel(p)}</strong>
          <p>
            <bdi>
              {fa((p.lengthMm ?? 0) / 10)} × {fa((p.widthMm ?? 0) / 10)} ×{" "}
              {fa((p.heightMm ?? 0) / 10)}
            </bdi>{" "}
            سانتی‌متر · {fa(p.shippingGrams)} گرم
          </p>
          {measurementIssues(p).length > 0 && (
            <button type="button" onClick={onFix}>
              تکمیل {measurementIssues(p).join("، ")}
            </button>
          )}
        </div>
      ))}
    </section>
  );
}
