"use client";
import { useState } from "react";
import type { Product } from "@/lib/types";
import {
  fa,
  money,
  packageLabel,
  packagePrice,
  priceRange,
} from "@/lib/format";
import { useStore } from "./store-provider";
import { ShoppingBag } from "lucide-react";
export function ProductPurchase({ product: p }: { product: Product }) {
  const [id, setID] = useState(p.packages?.[0]?.id || ""),
    [quantity, setQuantity] = useState(1),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const { cart, setItem, openCart } = useStore();
  const pack = p.packages?.find((x) => x.id === id);
  const existing =
    cart.items.find((x) => x.product.id === p.id && x.package.id === id)
      ?.quantity || 0;
  const max =
    pack && !p.outOfStock ? Math.max(0, pack.maxQuantity - existing) : 0;
  async function add(trigger: HTMLButtonElement) {
    if (!pack) return;
    setBusy(true);
    setError("");
    try {
      await setItem(p, pack.id, existing + quantity);
      setQuantity(1);
      openCart(trigger);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="purchase-panel">
      <div className="product-price">
        <strong>{priceRange(p)}</strong> <small>تومان</small>
      </div>
      {p.discountPercent > 0 && (
        <span className="badge">{fa(p.discountPercent)}٪ تخفیف</span>
      )}
      <hr />
      <fieldset className="package-picker">
        <legend>اندازه بسته را انتخاب کنید</legend>
        <div className="package-options">
          {p.packages?.map((x) => (
            <button
              type="button"
              key={x.id}
              aria-pressed={id === x.id}
              className={id === x.id ? "selected" : ""}
              disabled={p.outOfStock}
              onClick={() => {
                setID(x.id);
                setQuantity(1);
                setError("");
              }}
            >
              <strong>{packageLabel(x)}</strong>
              <span>{money(packagePrice(p, x))} تومان</span>
            </button>
          ))}
        </div>
      </fieldset>
      {pack && (
        <>
          <div className="between">
            <label htmlFor="package-count">تعداد بسته</label>
            <div className="stepper">
              <button
                aria-label="کاهش تعداد"
                disabled={quantity <= 1}
                onClick={() => setQuantity(quantity - 1)}
              >
                −
              </button>
              <input
                id="package-count"
                type="number"
                min={1}
                max={Math.max(1, max)}
                value={quantity}
                onChange={(e) => setQuantity(Number(e.target.value))}
              />
              <button
                aria-label="افزایش تعداد"
                disabled={quantity >= max}
                onClick={() => setQuantity(quantity + 1)}
              >
                +
              </button>
            </div>
          </div>
          <p className="muted">
            حداکثر {fa(pack.maxQuantity)} بسته از این اندازه در هر سفارش
            {existing > 0 ? ` · ${fa(existing)} بسته در سبد شما` : ""}
          </p>
          <div className="purchase-bottom">
            <strong>
              {money(packagePrice(p, pack) * quantity)} <small>تومان</small>
            </strong>
            <button
              className="button"
              disabled={
                busy ||
                !Number.isInteger(quantity) ||
                quantity < 1 ||
                quantity > max
              }
              onClick={(e) => add(e.currentTarget)}
            >
              <ShoppingBag size={19} />
              {busy ? "در حال افزودن…" : "افزودن به سبد"}
            </button>
          </div>
          {max === 0 && (
            <p className="muted">
              {p.outOfStock
                ? "این محصول ناموجود است."
                : "سقف خرید این بسته تکمیل شده است."}
            </p>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </div>
  );
}
