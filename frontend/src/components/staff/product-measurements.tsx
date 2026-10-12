import type { Package } from "@/lib/types";
import { fa, packageLabel } from "@/lib/format";
import { measurementIssues } from "@/lib/shipping";
import { MeasurementNumber } from "./measurement-number";

export function PackageMeasurements({
  pack,
  packages,
  onChange,
}: {
  pack: Package;
  packages: Package[];
  onChange: (patch: Partial<Package>) => void;
}) {
  return (
    <section
      className="package-measurements stack"
      aria-label="اندازه و وزن ارسال"
    >
      <div>
        <h4>اندازه و وزن ارسال</h4>
        <p className="muted">با ظرف و محافظ دور محصول؛ بدون کارتن پستی.</p>
      </div>
      <div className="form-grid package-dimension-fields">
        {(
          [
            ["lengthMm", "طول"],
            ["widthMm", "عرض"],
            ["heightMm", "ارتفاع"],
          ] as const
        ).map(([key, label]) => (
          <MeasurementNumber
            key={key}
            label={`${label} (سانتی‌متر)`}
            value={pack[key] ?? 0}
            scale={10}
            max={3000}
            onChange={(value) =>
              onChange({ [key]: value, shippingVerified: false })
            }
          />
        ))}
        <MeasurementNumber
          label="وزن بسته آماده ارسال (گرم)"
          value={pack.shippingGrams}
          min={
            pack.unit === "kg"
              ? pack.amount * 1000
              : pack.unit === "g"
                ? pack.amount
                : 0
          }
          errorText="وزن آماده ارسال باید در محدوده مجاز و حداقل برابر وزن محتویات باشد."
          onChange={(shippingGrams) =>
            onChange({ shippingGrams, shippingVerified: false })
          }
        />
      </div>
      <details className="package-help">
        <summary>راهنمای اندازه‌گیری و کپی اندازه‌ها</summary>
        <div className="stack">
          <div
            className="shipping-box-diagram"
            role="img"
            aria-label="طول و عرض روی قاعده، ارتفاع عمودی"
          >
            <span>طول ↔</span>
            <svg viewBox="0 0 120 110" aria-hidden="true">
              <path
                d="M15 35 L75 35 L105 15 L45 15 Z"
                fill="#eef4e6"
                stroke="currentColor"
              />
              <path
                d="M15 35 V95 H75 V35 Z"
                fill="#dce9d9"
                stroke="currentColor"
              />
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
            مثلاً ۵۰۰ گرم عسل، وزن محتویات است؛ وزن ارسال شامل عسل، شیشه، درپوش
            و محافظ است. پهن‌ترین قسمت را اندازه بگیرید. محصول ایستاده می‌ماند و
            فقط روی قاعده می‌چرخد.
          </p>
          {packages.length > 1 && (
            <label>
              کپی اندازه‌ها از بسته دیگر
              <select
                aria-label="کپی اندازه‌ها از بسته دیگر"
                value=""
                onChange={(e) => {
                  const source = packages.find((p) => p.id === e.target.value);
                  if (source)
                    onChange({
                      lengthMm: source.lengthMm,
                      widthMm: source.widthMm,
                      heightMm: source.heightMm,
                      shippingGrams: source.shippingGrams,
                      shippingVerified: false,
                    });
                }}
              >
                <option value="">انتخاب بسته</option>
                {packages
                  .filter((p) => p.id !== pack.id)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {packageLabel(p)}
                    </option>
                  ))}
              </select>
            </label>
          )}
        </div>
      </details>
    </section>
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
