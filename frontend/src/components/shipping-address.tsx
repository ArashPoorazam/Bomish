"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Address, Locality } from "@/lib/types";
export function ShippingLocalities({
  address,
  onChange,
  localities: provided,
}: {
  address: Address;
  onChange: (a: Address) => void;
  localities?: Locality[];
}) {
  const [items, setItems] = useState<Locality[]>(provided ?? []),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    if (provided) {
      setItems(provided);
      return;
    }
    let active = true;
    api<Locality[]>("/shipping/localities")
      .then((v) => {
        if (active) {
          setItems(v);
          setError("");
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [provided, retry]);
  const provinces = [
    ...new Map(items.map((l) => [l.provinceId, l.province])).entries(),
  ];
  return (
    <section className="stack">
      <div className="form-grid">
        <label>
          استان تأییدشده
          <select
            value={address.provinceId ?? ""}
            onChange={(e) =>
              onChange({
                ...address,
                provinceId: e.target.value,
                province:
                  provinces.find(([id]) => id === e.target.value)?.[1] ?? "",
                cityId: "",
                city: "",
                pinConfirmed: false,
              })
            }
          >
            <option value="">استان را انتخاب کنید</option>
            {provinces.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label>
          شهر تأییدشده
          <select
            value={address.cityId ?? ""}
            onChange={(e) => {
              const l = items.find((v) => v.id === e.target.value);
              if (l)
                onChange({
                  ...address,
                  cityId: l.id,
                  city: l.city,
                  pinConfirmed: false,
                });
            }}
          >
            <option value="">شهر را انتخاب کنید</option>
            {items
              .filter((l) => l.provinceId === address.provinceId)
              .map((l) => (
                <option key={l.id} value={l.id}>
                  {l.city}
                </option>
              ))}
          </select>
        </label>
      </div>
      {!address.cityId && (
        <p className="notice">
          برای محاسبه ارسال، شهر نشانی را از فهرست تأیید کنید. نشانی قبلی شما
          حفظ شده است.
        </p>
      )}
      {!items.length && !error && (
        <p>هنوز شهر تأییدشده‌ای برای ارسال ثبت نشده است.</p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
          <button type="button" onClick={() => setRetry((n) => n + 1)}>
            دریافت دوباره شهرها
          </button>
        </p>
      )}
    </section>
  );
}
export function PinConfirmation({
  address,
  onChange,
}: {
  address: Address;
  onChange: (a: Address) => void;
}) {
  return (
    <div className="stack">
      <div className="form-grid">
        {(
          [
            ["latitude", "عرض جغرافیایی"],
            ["longitude", "طول جغرافیایی"],
          ] as const
        ).map(([key, label]) => (
          <label key={key}>
            {label}
            <input
              dir="ltr"
              type="number"
              step="any"
              value={address[key] ?? ""}
              onChange={(e) =>
                onChange({
                  ...address,
                  [key]:
                    e.target.value === "" ? undefined : Number(e.target.value),
                  pinConfirmed: false,
                })
              }
            />
          </label>
        ))}
      </div>
      <label className="check-label">
        <input
          type="checkbox"
          disabled={
            address.latitude === undefined || address.longitude === undefined
          }
          checked={!!address.pinConfirmed}
          onChange={(e) =>
            onChange({ ...address, pinConfirmed: e.target.checked })
          }
        />
        این موقعیت دقیق نشانی است
      </label>
      <small>بدون موقعیت تأییدشده، ارسال با پست را انتخاب کنید.</small>
    </div>
  );
}
