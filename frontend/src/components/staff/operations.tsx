"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import type { ShippingConfig, ProviderHealth } from "@/lib/types";
import { AddressMap } from "../address-map";
import { ShippingLocalities, PinConfirmation } from "../shipping-address";
import { ShippingBoxes } from "./shipping-boxes";
import { ProviderCard, LocalitySettings } from "./shipping-providers";
import { AddressTextFields, ShippingPreview } from "./shipping-preview";
import { MeasurementNumber } from "./product-measurements";
export function ShippingEditor({
  initial,
  onStateChange,
}: {
  initial: ShippingConfig;
  onStateChange?: (s: { dirty: boolean; busy: boolean }) => void;
}) {
  const [v, setV] = useState(initial),
    [saved, setSaved] = useState(JSON.stringify(initial)),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const dirty = JSON.stringify(v) !== saved;
  useEffect(() => {
    onStateChange?.({ dirty, busy });
  }, [dirty, busy, onStateChange]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  async function save() {
    setBusy(true);
    setError("");
    setMessage("");
    let persisted = false;
    try {
      await api("/staff/shipping", "PUT", v);
      persisted = true;
      const next = await api<ShippingConfig>("/staff/shipping");
      setV(next);
      setSaved(JSON.stringify(next));
      setMessage("تنظیمات ذخیره شد.");
    } catch (e) {
      setError(
        (persisted ? "ذخیره انجام شد؛ دریافت نسخه تازه ناموفق بود. " : "") +
          (e as Error).message,
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="form-card stack shipping-settings">
      <div className="between">
        <h2>ارسال</h2>
        <span role="status">
          {busy
            ? "در حال ذخیره…"
            : dirty
              ? "تغییرات ذخیره نشده"
              : "همه تغییرات ذخیره شده"}
        </span>
      </div>
      <p className="notice">
        ارسال زنده غیرفعال است. نتیجه شبیه‌سازی، تأیید حساب زنده محسوب نمی‌شود.
      </p>
      <fieldset className="product-step-fields stack" disabled={busy}>
        <section className="stack">
          <h3>مبدأ ارسال</h3>
          <AddressTextFields
            address={v.origin}
            onChange={(origin) => setV({ ...v, origin })}
          />
          <ShippingLocalities
            address={v.origin}
            localities={v.localities}
            onChange={(origin) => setV({ ...v, origin })}
          />
          <AddressMap
            address={v.origin}
            onChange={(origin) => setV({ ...v, origin })}
            reverse={false}
          />
          <PinConfirmation
            address={v.origin}
            onChange={(origin) => setV({ ...v, origin })}
          />
          <LocalitySettings
            value={v.localities}
            onChange={(localities) => setV({ ...v, localities })}
          />
        </section>
        <ShippingBoxes
          boxes={v.boxes}
          onChange={(boxes) => setV({ ...v, boxes })}
        />
        <section className="stack">
          <h3>ارائه‌دهندگان و سیاست ارسال</h3>
          {(["snapp", "tapin"] as const).map((name) => (
            <ProviderCard
              key={name}
              name={name}
              value={v[name]}
              health={v.providers?.[name]}
              busy={busy || dirty}
              onChange={(value) => setV({ ...v, [name]: value })}
              onCheck={async () => {
                setBusy(true);
                setError("");
                try {
                  const health = await api<ProviderHealth>(
                    `/staff/shipping/providers/${name}/check`,
                    "POST",
                  );
                  const next = {
                    ...v,
                    providers: { ...v.providers, [name]: health },
                  };
                  setV(next);
                  setSaved(JSON.stringify(next));
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            />
          ))}
          <label>
            روش محاسبه
            <select
              value={v.mode}
              onChange={(e) =>
                setV({ ...v, mode: e.target.value as ShippingConfig["mode"] })
              }
            >
              <option value="legacy">تعرفه‌های قبلی</option>
              <option value="calculated">محاسبه با اندازه و ارائه‌دهنده</option>
            </select>
          </label>
          <MeasurementNumber
            label="ارسال رایگان از مبلغ (تومان؛ صفر برای غیرفعال)"
            value={v.freeShippingRials / 10}
            max={10000000000}
            onChange={(n) => setV({ ...v, freeShippingRials: n * 10 })}
          />
          <label>
            لینک پشتیبانی
            <input
              dir="ltr"
              type="url"
              value={v.supportUrl}
              onChange={(e) => setV({ ...v, supportUrl: e.target.value })}
            />
          </label>
          <div className="notice">
            <h4>پیش‌نیازهای فعال‌سازی (تنظیمات ذخیره‌شده)</h4>
            {v.blockers?.length ? (
              <ul>
                {v.blockers.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            ) : (
              <p>پیش‌نیازهای محیط آزمایش کامل است.</p>
            )}
            {v.missingMeasurements?.map((m) => (
              <p key={m.productId + m.packageId}>
                <Link
                  href={`/staff?section=products&q=${encodeURIComponent(m.productId)}&step=shipping`}
                >
                  {m.name}: {m.fields.join("، ")}
                </Link>
              </p>
            ))}
          </div>
          <details>
            <summary>
              تعرفه‌های قبلی {v.mode === "calculated" ? "· غیرفعال" : ""}
            </summary>
            <MeasurementNumber
              label="وزن بسته‌بندی قبلی (گرم)"
              value={v.packagingGrams}
              onChange={(n) => setV({ ...v, packagingGrams: n })}
            />
            {v.rules.map((r, i) => (
              <div className="product-package form-grid" key={r.id}>
                <label>
                  استان
                  <input
                    value={r.province}
                    onChange={(e) =>
                      setV({
                        ...v,
                        rules: v.rules.map((x, j) =>
                          i === j ? { ...x, province: e.target.value } : x,
                        ),
                      })
                    }
                  />
                </label>
                <MeasurementNumber
                  label="حداکثر وزن (گرم)"
                  value={r.maxGrams}
                  onChange={(n) =>
                    setV({
                      ...v,
                      rules: v.rules.map((x, j) =>
                        i === j ? { ...x, maxGrams: n } : x,
                      ),
                    })
                  }
                />
                <MeasurementNumber
                  label="هزینه (تومان)"
                  value={r.feeRials / 10}
                  onChange={(n) =>
                    setV({
                      ...v,
                      rules: v.rules.map((x, j) =>
                        i === j ? { ...x, feeRials: n * 10 } : x,
                      ),
                    })
                  }
                />
                <button
                  type="button"
                  onClick={() =>
                    setV({ ...v, rules: v.rules.filter((_, j) => j !== i) })
                  }
                >
                  حذف بازه
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() =>
                setV({
                  ...v,
                  rules: [
                    ...v.rules,
                    {
                      id: crypto.randomUUID(),
                      province: "",
                      maxGrams: 1000,
                      feeRials: 0,
                    },
                  ],
                })
              }
            >
              افزودن بازه
            </button>
          </details>
        </section>
        <button type="button" className="button" onClick={() => void save()}>
          ذخیره تنظیمات
        </button>
      </fieldset>
      {message && (
        <p className="success" role="status">
          {message}
        </p>
      )}
      {error && (
        <div role="alert" className="error">
          {error}
          <button
            type="button"
            onClick={async () => {
              try {
                const next = await api<ShippingConfig>("/staff/shipping");
                const baseline = JSON.parse(saved) as ShippingConfig;
                const conflicts: string[] = [];
                const merged = { ...next };
                for (const key of Object.keys(v) as (keyof ShippingConfig)[]) {
                  if (
                    [
                      "version",
                      "originRevision",
                      "blockers",
                      "missingMeasurements",
                      "providers",
                    ].includes(key)
                  )
                    continue;
                  if (
                    JSON.stringify(v[key]) !== JSON.stringify(baseline[key])
                  ) {
                    if (
                      JSON.stringify(next[key]) !==
                        JSON.stringify(baseline[key]) &&
                      JSON.stringify(next[key]) !== JSON.stringify(v[key])
                    )
                      conflicts.push(key);
                    else Object.assign(merged, { [key]: v[key] });
                  }
                }
                if (conflicts.length) {
                  setError(
                    "تغییر هم‌زمان در تنظیمات وجود دارد. پیش‌نویس شما حفظ شد؛ تغییرات مبدأ، کارتن یا سیاست ارسال را با همکار خود هماهنگ کنید.",
                  );
                  return;
                }
                setV(merged);
                setSaved(JSON.stringify(next));
                setMessage(
                  "نسخه تازه دریافت شد؛ تغییرات شما حفظ شده‌اند. پیش از ذخیره دوباره آن‌ها را بررسی کنید.",
                );
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            دریافت نسخه تازه با حفظ تغییرات
          </button>
          <button
            type="button"
            onClick={async () => {
              try {
                const next = await api<ShippingConfig>("/staff/shipping");
                setV(next);
                setSaved(JSON.stringify(next));
                setError("");
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            کنار گذاشتن پیش‌نویس و بارگذاری تنظیمات ذخیره‌شده
          </button>
        </div>
      )}
      <ShippingPreview />
    </div>
  );
}
