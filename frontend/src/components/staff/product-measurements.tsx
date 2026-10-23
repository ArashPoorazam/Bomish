import type { Package } from "@/lib/types";
import { fa, packageLabel } from "@/lib/format";
import { measurementIssues } from "@/lib/shipping";

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
          {p.packagingId && p.packaging ? (
            <p>
              {p.packaging.name} ·{" "}
              <bdi>
                {fa((p.lengthMm ?? 0) / 10)} × {fa((p.widthMm ?? 0) / 10)} ×{" "}
                {fa((p.heightMm ?? 0) / 10)}
              </bdi>{" "}
              سانتی‌متر · {fa(p.shippingGrams)} گرم
            </p>
          ) : null}
          {(!p.packagingId || measurementIssues(p).length > 0) && (
            <button type="button" onClick={onFix}>
              {p.packagingId
                ? "بررسی بسته‌بندی و وزن خالص محصول"
                : "انتخاب بسته‌بندی محصول"}
            </button>
          )}
        </div>
      ))}
    </section>
  );
}
