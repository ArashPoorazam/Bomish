import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Address, Product, ShippingSnapshot } from "@/lib/types";
import { money, packageLabel } from "@/lib/format";
import { ShippingLocalities, PinConfirmation } from "../shipping-address";
import { providerName } from "@/lib/shipping";
import { ParcelView } from "./shipping-parcel";
export const blankShippingAddress: Address = {
  id: "",
  recipient: "",
  phone: "",
  province: "",
  city: "",
  street: "",
  postalCode: "",
  pinConfirmed: false,
};
export function ShippingPreview() {
  const [products, setProducts] = useState<Product[]>([]),
    [items, setItems] = useState<
      { productId: string; packageId: string; quantity: number }[]
    >([]),
    [address, setAddress] = useState(blankShippingAddress),
    [result, setResult] = useState<ShippingSnapshot | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [search, setSearch] = useState("");
  useEffect(() => {
    let active = true;
    const timer = setTimeout(
      () =>
        api<Product[]>(`/staff/products?q=${encodeURIComponent(search)}`)
          .then((v) => {
            if (active) setProducts(v);
          })
          .catch((e) => {
            if (active) setError(e.message);
          }),
      250,
    );
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [search]);
  return (
    <section className="stack">
      <h3>پیش‌نمایش و بررسی</h3>
      <p className="notice">آزمایش محاسبه؛ بدون ثبت ارسال</p>
      <label>
        جستجوی محصول
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>
      <label>
        بسته محصول
        <select
          value=""
          onChange={(e) => {
            const [productId, packageId] = JSON.parse(e.target.value);
            setItems([...items, { productId, packageId, quantity: 1 }]);
            setResult(null);
          }}
        >
          <option value="">انتخاب بسته</option>
          {products.flatMap((p) =>
            p.packages.map((v) => (
              <option key={p.id + v.id} value={JSON.stringify([p.id, v.id])}>
                {p.name} · {packageLabel(v)}
              </option>
            )),
          )}
        </select>
      </label>
      {items.map((v, i) => (
        <div key={i} className="between">
          <span>
            {products.find((p) => p.id === v.productId)?.name ?? v.productId}
          </span>
          <label>
            تعداد
            <input
              type="number"
              min={1}
              max={500}
              value={v.quantity}
              onChange={(e) => {
                setItems(
                  items.map((v, j) =>
                    i === j ? { ...v, quantity: Number(e.target.value) } : v,
                  ),
                );
                setResult(null);
              }}
            />
          </label>
          <button
            type="button"
            onClick={() => {
              setItems(items.filter((_, j) => i !== j));
              setResult(null);
            }}
          >
            حذف
          </button>
        </div>
      ))}
      <ShippingLocalities
        address={address}
        onChange={(v) => {
          setAddress(v);
          setResult(null);
        }}
      />
      <AddressTextFields
        address={address}
        onChange={(v) => {
          setAddress(v);
          setResult(null);
        }}
      />
      <PinConfirmation
        address={address}
        onChange={(v) => {
          setAddress(v);
          setResult(null);
        }}
      />
      <button
        type="button"
        className="button"
        disabled={busy || !items.length}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            setResult(
              await api<ShippingSnapshot>("/staff/shipping/preview", "POST", {
                items,
                address,
              }),
            );
          } catch (e) {
            setResult(null);
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "در حال محاسبه…" : "محاسبه آزمایشی"}
      </button>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {result && (
        <div aria-live="polite">
          <h4>
            {providerName(result.method)}{" "}
            {result.carrierQuote.simulated ? "· شبیه‌سازی‌شده" : ""}
          </h4>
          <p>
            هزینه حامل: {money(result.carrierQuote.costRials)} تومان · دریافت از
            مشتری: {money(result.totals.shippingRials)} تومان
          </p>
          <p>{result.fallbackReason}</p>
          {result.parcels.map((p) => (
            <ParcelView key={p.id} parcel={p} />
          ))}
        </div>
      )}
    </section>
  );
}
export function AddressTextFields({
  address,
  onChange,
}: {
  address: Address;
  onChange: (v: Address) => void;
}) {
  return (
    <div className="form-grid">
      {(
        [
          ["recipient", "نام"],
          ["phone", "شماره همراه"],
          ["street", "نشانی کامل، پلاک و واحد"],
          ["postalCode", "کد پستی"],
        ] as const
      ).map(([k, label]) => (
        <label key={k}>
          {label}
          <input
            value={address[k]}
            onChange={(e) =>
              onChange({
                ...address,
                [k]: e.target.value,
                ...(k === "street" ? { pinConfirmed: false } : {}),
              })
            }
          />
        </label>
      ))}
    </div>
  );
}
