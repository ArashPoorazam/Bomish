"use client";
import { useState } from "react";
import type { Product } from "@/lib/types";
import { parseGrams, weight, money, total } from "@/lib/format";
import { useStore } from "./store-provider";
import { ShoppingBag, Check, Scale } from "lucide-react";
export function ProductPurchase({ product: p }: { product: Product }) {
  const [g, setG] = useState(
      String(
        Math.max(
          p.minGrams,
          (500 - p.minGrams) % p.stepGrams === 0 && p.maxGrams >= 500
            ? 500
            : p.minGrams,
        ),
      ),
    ),
    [unit, setUnit] = useState("g"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const { cart, setItem, openCart } = useStore();
  const grams = parseGrams(g, unit as "g" | "kg");
  const valid =
    Number.isFinite(grams) &&
    grams >= p.minGrams &&
    grams <= Math.min(p.maxGrams, p.availableGrams) &&
    (grams - p.minGrams) % p.stepGrams === 0;
  async function add(trigger: HTMLButtonElement) {
    setBusy(true);
    setError("");
    try {
      const existing =
        cart.items.find((item) => item.product.id === p.id)?.grams || 0;
      await setItem(p, existing + grams);
      openCart(trigger);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="purchase-panel">
      <div className="between">
        <div className="product-price">
          <strong>{money(p.priceRials)}</strong> تومان{" "}
          <small>برای هر کیلوگرم</small>
        </div>
        <span className="stock-label">
          {p.availableGrams >= p.minGrams ? (
            <>
              <Check size={15} />
              موجود
            </>
          ) : (
            "ناموجود"
          )}
        </span>
      </div>
      <hr />
      <label className="field-title">چقدر نیاز دارید؟</label>
      <div className="weight-presets">
        {[250, 500, 1000, 10000]
          .filter(
            (n) =>
              n >= p.minGrams &&
              n <= p.maxGrams &&
              (n - p.minGrams) % p.stepGrams === 0,
          )
          .map((n) => (
            <button
              key={n}
              disabled={n > p.availableGrams}
              className={grams === n ? "selected" : ""}
              onClick={() => {
                setUnit("g");
                setG(String(n));
              }}
            >
              {weight(n)}
            </button>
          ))}
      </div>
      <div className="custom-weight">
        <label>
          وزن دلخواه
          <input
            aria-label="وزن دلخواه"
            inputMode="decimal"
            value={g}
            onChange={(e) => setG(e.target.value)}
          />
        </label>
        <label>
          واحد
          <select
            aria-label="واحد"
            value={unit}
            onChange={(e) => {
              const next = e.target.value;
              setG(String(next === "kg" ? grams / 1000 : grams));
              setUnit(next);
            }}
          >
            <option value="g">گرم</option>
            <option value="kg">کیلوگرم</option>
          </select>
        </label>
      </div>
      <p className="muted small">
        <Scale size={15} />
        حداقل {weight(p.minGrams)}، گام {weight(p.stepGrams)}، حداکثر{" "}
        {weight(p.maxGrams)}
      </p>
      <div className="purchase-bottom">
        <div>
          <small>قیمت وزن انتخابی</small>
          <strong>
            {valid ? money(total(p.priceRials, grams)) : "—"}{" "}
            <small>تومان</small>
          </strong>
        </div>
        <button
          disabled={!valid || busy}
          className="button"
          onClick={(e) => add(e.currentTarget)}
        >
          <ShoppingBag size={19} />
          {busy ? "در حال افزودن…" : "افزودن به سبد"}
        </button>
      </div>
      {!valid ? (
        <p className="muted small">
          وزن را مطابق محدوده مجاز و موجودی انتخاب کنید.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
