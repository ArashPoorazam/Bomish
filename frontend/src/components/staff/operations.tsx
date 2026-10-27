"use client";
import "@/app/shipping.css";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { ShippingConfig } from "@/lib/types";
import { AddressMap } from "../address-map";
import { ShippingLocalities, PinConfirmation } from "../shipping-address";
import { ShippingBoxes } from "./shipping-boxes";
import { ShippingReadiness } from "./shipping-readiness";
import { AddressTextFields, ShippingPreview } from "./shipping-preview";
import { MeasurementNumber } from "./measurement-number";
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
        <span role="status">
          {busy
            ? "در حال ذخیره…"
            : dirty
              ? "تغییرات ذخیره نشده"
              : "همه تغییرات ذخیره شده"}
        </span>
      </div>
      <ShippingReadiness value={v} dirty={dirty} />
      <fieldset className="product-step-fields stack" disabled={busy}>
        <section id="shipping-origin" className="shipping-section stack">
          <div className="section-heading">
            <span className="section-number">۱</span>
            <div>
              <h3>مبدأ ارسال</h3>
              <p className="muted">
                پیک سفارش‌ها را از این نشانی تحویل می‌گیرد.
              </p>
            </div>
          </div>
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
            origin
          />
        </section>
        <ShippingBoxes
          defaults={v.boxDefaults ?? { wallMm: 6, insetMm: 10 }}
          boxes={v.boxes}
          catalog={v.boxCatalog ?? []}
          simulated={!!v.simulated}
          onChange={(boxes) => setV({ ...v, boxes })}
        />
        <section className="shipping-section stack">
          <div className="section-heading">
            <span className="section-number">۳</span>
            <div>
              <h3>روش و هزینه ارسال</h3>
              <p className="muted">شهر تهران: اسنپ · سایر شهرها: پست</p>
            </div>
          </div>
          <p>
            اگر اسنپ نتواند سفارش تهران را بپذیرد، پست با تأیید مشتری پیشنهاد
            می‌شود. درخواست پیک پس از بسته‌بندی، از بخش سفارش‌ها ثبت می‌شود.
          </p>
          <div className="form-grid">
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
          </div>
        </section>
        <div className="shipping-save-bar">
          <span>
            {dirty
              ? "تغییرات شما هنوز ذخیره نشده‌اند."
              : "تنظیمات ذخیره‌شده نمایش داده می‌شوند."}
          </span>
          <button
            type="button"
            className="button"
            onClick={() => void save()}
            disabled={busy || !dirty}
          >
            {busy ? "در حال ذخیره…" : "ذخیره تنظیمات"}
          </button>
        </div>
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
                      "readiness",
                      "boxCatalog",
                      "simulated",
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
      <details className="shipping-section">
        <summary>آزمایش بسته‌بندی و هزینه ارسال</summary>
        <ShippingPreview />
      </details>
    </div>
  );
}
