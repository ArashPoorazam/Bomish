import type { Locality, ProviderConfig, ProviderHealth } from "@/lib/types";
import { SizeFields } from "./shipping-boxes";
import { MeasurementNumber } from "./measurement-number";
import { providerName } from "@/lib/shipping";
export function ProviderCard({
  name,
  value,
  onChange,
  health,
  onCheck,
  busy,
}: {
  name: "snapp" | "tapin";
  value: ProviderConfig;
  onChange: (v: ProviderConfig) => void;
  health?: ProviderHealth;
  onCheck: () => void;
  busy: boolean;
}) {
  const states: Record<string, string> = {
    disabled: "غیرفعال",
    not_configured: "پیکربندی نشده",
    verification_required: "نیازمند تأیید",
    ready: "آماده",
    temporarily_unavailable: "موقتاً در دسترس نیست",
  };
  return (
    <section className="product-package stack">
      <h4>{name === "snapp" ? providerName(name) : "پست · تاپین"}</h4>
      <p className="badge">
        {states[health?.state ?? "disabled"]}{" "}
        {health?.simulated ? "· شبیه‌سازی‌شده" : "· حساب زنده"}
      </p>
      <p>
        اعتبارنامه‌ها فقط روی سرور نگهداری می‌شوند.{" "}
        {health?.configured
          ? "پیکربندی موجود است."
          : "اعتبارنامه زنده ثبت نشده است."}
      </p>
      <label className="check-label">
        <input
          type="checkbox"
          checked={value.enabled}
          onChange={(e) => onChange({ ...value, enabled: e.target.checked })}
        />
        فعال در تنظیمات
      </label>
      <div className="form-grid">
        <label>
          شناسه سرویس
          <input
            dir="ltr"
            value={value.service}
            onChange={(e) =>
              onChange({ ...value, service: e.target.value, verified: false })
            }
          />
        </label>
        {name === "tapin" && (
          <label>
            شناسه فروشگاه
            <input
              dir="ltr"
              value={value.shopId}
              onChange={(e) =>
                onChange({ ...value, shopId: e.target.value, verified: false })
              }
            />
          </label>
        )}
        <label>
          واحد پول پاسخ
          <select
            value={value.currency}
            onChange={(e) =>
              onChange({ ...value, currency: e.target.value, verified: false })
            }
          >
            <option value="">تأیید نشده</option>
            <option value="rial">ریال</option>
            <option value="toman">تومان</option>
          </select>
        </label>
        <MeasurementNumber
          label="حداکثر وزن (گرم)"
          value={value.maxGrams}
          onChange={(n) => onChange({ ...value, maxGrams: n, verified: false })}
        />
        {name === "snapp" && (
          <>
            <label>
              شناسه شهر تحت پوشش
              <input
                dir="ltr"
                value={value.cityId}
                onChange={(e) =>
                  onChange({
                    ...value,
                    cityId: e.target.value,
                    verified: false,
                  })
                }
              />
            </label>
            <MeasurementNumber
              label="حداکثر حجم (سانتی‌متر مکعب)"
              value={value.maxVolumeCm3}
              max={27000000000}
              onChange={(n) =>
                onChange({ ...value, maxVolumeCm3: n, verified: false })
              }
            />
            <MeasurementNumber
              label="حداکثر تعداد کارتن"
              value={value.maxParcels}
              max={20}
              onChange={(n) =>
                onChange({ ...value, maxParcels: n, verified: false })
              }
            />
          </>
        )}
      </div>
      <SizeFields
        value={value.maxSize}
        label="حداکثر ابعاد بیرونی مرسوله"
        onChange={(maxSize) => onChange({ ...value, maxSize, verified: false })}
      />
      {name === "snapp" && (
        <fieldset className="product-step-fields stack">
          <legend>مرز محدوده تأییدشده سرویس (مختصات)</legend>
          {(value.area ?? []).map((p, i) => (
            <div className="form-grid" key={i}>
              {[0, 1].map((k) => (
                <label key={k}>
                  {k === 0 ? "عرض جغرافیایی" : "طول جغرافیایی"} {i + 1}
                  <input
                    dir="ltr"
                    type="number"
                    step="any"
                    value={p[k]}
                    onChange={(e) =>
                      onChange({
                        ...value,
                        area: value.area.map((v, j) =>
                          j === i
                            ? v.map((n, l) =>
                                l === k ? Number(e.target.value) : n,
                              )
                            : v,
                        ),
                        verified: false,
                      })
                    }
                  />
                </label>
              ))}
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              onChange({
                ...value,
                area: [...(value.area ?? []), [0, 0]],
                verified: false,
              })
            }
          >
            افزودن نقطه مرزی
          </button>
          <small>
            مرز را از محدوده واقعی مجاز حساب وارد کنید؛ استان تهران به‌تنهایی
            پوشش نیست.
          </small>
        </fieldset>
      )}
      <label className="check-label">
        <input
          type="checkbox"
          checked={value.verified}
          onChange={(e) => onChange({ ...value, verified: e.target.checked })}
        />
        سرویس، ظرفیت، محدوده و واحد پول بررسی شده‌اند
      </label>
      <button
        type="button"
        className="button secondary"
        disabled={busy}
        onClick={onCheck}
      >
        بررسی اتصال؛ بدون ثبت ارسال
      </button>
      {health?.lastSuccess && (
        <p>
          آخرین بررسی موفق:{" "}
          <bdi>{new Date(health.lastSuccess).toLocaleString("fa-IR")}</bdi>
        </p>
      )}
      {health?.error && (
        <p role="alert" className="error">
          {health.error}
        </p>
      )}
    </section>
  );
}
export function LocalitySettings({
  value,
  onChange,
}: {
  value: Locality[];
  onChange: (v: Locality[]) => void;
}) {
  return (
    <details>
      <summary>مدیریت شهرها و نگاشت تأییدشده پستی</summary>
      <p>
        شناسه‌های پایدار داخلی را پس از استفاده تغییر ندهید. نگاشت ارائه‌دهنده
        باید از حساب فروشگاه تأیید شود.
      </p>
      {value.map((l, i) => (
        <div className="product-package stack" key={i}>
          <div className="form-grid">
            {(
              [
                ["id", "شناسه شهر"],
                ["provinceId", "شناسه استان"],
                ["province", "نام استان"],
                ["city", "نام شهر"],
                ["tapinProvince", "کد استان تاپین"],
                ["tapinCity", "کد شهر تاپین"],
              ] as const
            ).map(([key, label]) => (
              <label key={key}>
                {label}
                <input
                  value={l[key]}
                  onChange={(e) =>
                    onChange(
                      value.map((v, j) =>
                        i === j
                          ? { ...v, [key]: e.target.value, verified: false }
                          : v,
                      ),
                    )
                  }
                />
              </label>
            ))}
          </div>
          <label className="check-label">
            <input
              type="checkbox"
              checked={l.verified}
              onChange={(e) =>
                onChange(
                  value.map((v, j) =>
                    j === i ? { ...v, verified: e.target.checked } : v,
                  ),
                )
              }
            />
            نگاشت تأیید شده است
          </label>
        </div>
      ))}
      <button
        type="button"
        onClick={() =>
          onChange([
            ...value,
            {
              id: crypto.randomUUID(),
              provinceId: "",
              province: "",
              city: "",
              tapinProvince: "",
              tapinCity: "",
              verified: false,
            },
          ])
        }
      >
        افزودن شهر
      </button>
    </details>
  );
}
