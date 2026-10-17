"use client";
import { useEffect, useId, useState } from "react";
import { api } from "@/lib/api";
import type { Address, Locality } from "@/lib/types";
const localityName = (value: string) =>
  value
    .trim()
    .replace(/ي/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[\s\u200c]+/g, "");

export function ShippingLocalities({
  address,
  onChange,
  localities: provided,
}: {
  address: Address;
  onChange: (a: Address) => void;
  localities?: Locality[];
}) {
  const listId = useId();
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
  useEffect(() => {
    // Keep readable map results even when postal IDs are not configured yet.
    if (address.cityId || !address.province || !address.city) return;
    const matches = items.filter(
      (item) =>
        localityName(item.province) === localityName(address.province) &&
        localityName(item.city) === localityName(address.city),
    );
    if (matches.length !== 1) return;
    const match = matches[0];
    onChange({
      ...address,
      province: match.province,
      provinceId: match.provinceId,
      city: match.city,
      cityId: match.id,
    });
  }, [items, address, onChange]);
  const provinces = [
    ...new Map(items.map((l) => [l.provinceId, l.province])).entries(),
  ];
  return (
    <section className="stack">
      <div className="form-grid">
        <label>
          استان
          <input
            required
            autoComplete="address-level1"
            list={`${listId}-provinces`}
            value={address.province}
            placeholder="استان"
            onChange={(e) => {
              const province = e.target.value;
              const match = provinces.find(
                ([, name]) => localityName(name) === localityName(province),
              );
              onChange({
                ...address,
                province,
                provinceId: match?.[0] ?? "",
                city: "",
                cityId: "",
                pinConfirmed: false,
              });
            }}
          />
          <datalist id={`${listId}-provinces`}>
            {provinces.map(([id, name]) => (
              <option key={id} value={name} />
            ))}
          </datalist>
        </label>
        <label>
          شهر
          <input
            required
            autoComplete="address-level2"
            list={`${listId}-cities`}
            value={address.city}
            placeholder="شهر"
            onChange={(e) =>
              onChange({
                ...address,
                city: e.target.value,
                cityId: "",
                pinConfirmed: false,
              })
            }
          />
          <datalist id={`${listId}-cities`}>
            {items
              .filter(
                (item) =>
                  localityName(item.province) ===
                  localityName(address.province),
              )
              .map((item) => (
                <option key={item.id} value={item.city} />
              ))}
          </datalist>
        </label>
      </div>
      <p className="muted">
        با انتخاب موقعیت روی نقشه، استان و شهر تکمیل می‌شوند؛ در صورت نیاز آن‌ها
        را اصلاح کنید.
      </p>
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
  origin = false,
}: {
  address: Address;
  onChange: (a: Address) => void;
  origin?: boolean;
}) {
  return (
    <div className="stack">
      <details>
        <summary>ورود دقیق مختصات نقشه</summary>
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
                      e.target.value === ""
                        ? undefined
                        : Number(e.target.value),
                    pinConfirmed: false,
                  })
                }
              />
            </label>
          ))}
        </div>
      </details>
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
      <small>
        {origin
          ? "پس از انتخاب محل فروشگاه روی نقشه، موقعیت را تأیید کنید."
          : "برای پیک، موقعیت دقیق روی نقشه لازم است."}
      </small>
    </div>
  );
}
