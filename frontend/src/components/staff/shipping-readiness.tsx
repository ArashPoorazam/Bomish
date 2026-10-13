import Link from "next/link";
import { CheckCircle2, FlaskConical, CircleAlert } from "lucide-react";
import type { ShippingConfig } from "@/lib/types";
export function ShippingReadiness({
  value: v,
  dirty,
}: {
  value: ShippingConfig;
  dirty: boolean;
}) {
  const merchant = (v.readiness ?? []).filter((i) => i.group === "merchant");
  const integration = (v.readiness ?? []).filter(
    (i) => i.group === "integration",
  );
  return (
    <section className="shipping-readiness stack" aria-label="آمادگی ارسال">
      <div className="section-heading">
        <FlaskConical size={24} aria-hidden="true" />
        <div>
          <h3>{v.simulated ? "محیط آزمایش ارسال" : "آماده‌سازی ارسال"}</h3>
          <p>ارسال زنده غیرفعال است؛ هیچ پیک واقعی درخواست نمی‌شود.</p>
        </div>
        <span className="badge">
          {v.mode === "legacy" ? "تعرفه‌های قبلی" : "محاسبه خودکار · آزمایشی"}
        </span>
      </div>
      <div className="readiness-columns">
        <div>
          <h4>
            {merchant.length ? (
              <CircleAlert size={18} aria-hidden="true" />
            ) : (
              <CheckCircle2 size={18} aria-hidden="true" />
            )}{" "}
            آماده‌سازی فروشگاه
          </h4>
          {merchant.length ? (
            <ul>
              {merchant.map((i) => (
                <li key={i.code}>
                  <a
                    href={
                      i.section === "products"
                        ? "/staff?section=products&shipping=missing"
                        : `#shipping-${i.section}`
                    }
                  >
                    {i.message}
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p>نشانی، کارتن‌ها و اندازه‌های محصولات کامل است.</p>
          )}
          {(v.missingMeasurements ?? []).length > 0 && (
            <details>
              <summary>محصولات نیازمند تکمیل</summary>
              {v.missingMeasurements?.map((m) => (
                <p key={m.productId + m.packageId}>
                  <Link
                    href={`/staff?section=products&q=${encodeURIComponent(m.productId)}&step=shipping`}
                  >
                    {m.name}: {m.fields.join("، ")}
                  </Link>
                </p>
              ))}
            </details>
          )}
        </div>
        <div>
          <h4>راه‌اندازی سرویس‌ها</h4>
          {integration.length ? (
            <details>
              <summary>
                {integration.length.toLocaleString("fa-IR")} مورد برای
                راه‌اندازی
              </summary>
              <ul>
                {integration.map((i) => (
                  <li key={i.code}>{i.message}</li>
                ))}
              </ul>
              <p className="muted">
                برای تکمیل راه‌اندازی سرویس‌ها با مسئول فنی فروشگاه هماهنگ کنید.
              </p>
            </details>
          ) : (
            <p>پیش‌نیازهای محیط آزمایش کامل است.</p>
          )}
        </div>
      </div>
      <small className="muted">
        {dirty
          ? "این وضعیت مربوط به آخرین ذخیره است؛ پس از ذخیره به‌روز می‌شود."
          : "وضعیت بر اساس تنظیمات ذخیره‌شده است."}
      </small>
    </section>
  );
}
