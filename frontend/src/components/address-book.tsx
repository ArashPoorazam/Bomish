"use client";
import { useState } from "react";
import type { Address } from "@/lib/types";
import { api } from "@/lib/api";
import { digits } from "@/lib/format";
import { AddressMap } from "./address-map";
const blank: Address = {
  id: "",
  recipient: "",
  phone: "",
  province: "",
  city: "",
  street: "",
  postalCode: "",
};
export function AddressEditor({
  initial,
  onSaved,
  onCancel,
}: {
  initial?: Address;
  onSaved: (saved: Address) => void;
  onCancel: () => void;
}) {
  const [address, setAddress] = useState(initial || blank),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <form
      className="form-card stack"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          const saved = await api<Address>(
            initial
              ? `/addresses/${encodeURIComponent(initial.id)}`
              : "/addresses",
            initial ? "PUT" : "POST",
            {
              ...address,
              phone: digits(address.phone),
              postalCode: digits(address.postalCode),
            },
          );
          onSaved(saved);
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h3>{initial ? "ویرایش نشانی" : "نشانی جدید"}</h3>
      <AddressMap address={address} onChange={setAddress} />
      <div className="form-grid">
        {(
          [
            ["recipient", "نام گیرنده"],
            ["phone", "شماره همراه گیرنده"],
            ["province", "استان"],
            ["city", "شهر"],
            ["street", "نشانی کامل، پلاک و واحد"],
            ["postalCode", "کد پستی"],
          ] as const
        ).map(([k, title]) => (
          <label key={k} className={k === "street" ? "span-2" : ""}>
            {title}
            <input
              required
              value={address[k]}
              minLength={k === "postalCode" || k === "street" ? 10 : undefined}
              maxLength={k === "postalCode" ? 10 : undefined}
              type={k === "phone" ? "tel" : "text"}
              inputMode={k === "postalCode" ? "numeric" : undefined}
              onChange={(e) => setAddress({ ...address, [k]: e.target.value })}
            />
          </label>
        ))}
      </div>
      <div className="inline-actions">
        <button className="button" disabled={busy}>
          {busy ? "در حال ذخیره…" : "ذخیره نشانی"}
        </button>
        <button
          type="button"
          className="button secondary"
          disabled={busy}
          onClick={onCancel}
        >
          انصراف
        </button>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </form>
  );
}
