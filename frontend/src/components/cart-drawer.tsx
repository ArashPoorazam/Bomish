"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { X, Minus, Plus, Trash2, ShoppingBag, ArrowLeft } from "lucide-react";
import { money, packageLabel, fa } from "@/lib/format";
import type { Product } from "@/lib/types";
import { useStore } from "./store-provider";

export function CartDrawer({
  onClose,
  returnFocus,
  removeItem,
}: {
  onClose: () => void;
  returnFocus: HTMLElement | null;
  removeItem: (id: string, packageId: string) => Promise<void>;
}) {
  const { cart, user, setItem } = useStore();
  const dialog = useRef<HTMLDialogElement>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const element = dialog.current;
    const overflow = document.body.style.overflow;
    element?.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
      if (returnFocus?.isConnected) returnFocus.focus();
    };
  }, [returnFocus]);
  const close = () => dialog.current?.close();
  async function change(p: Product, packageId: string, quantity: number) {
    setBusy(true);
    setError("");
    try {
      await setItem(p, packageId, quantity);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove(id: string, packageId: string) {
    setBusy(true);
    setError("");
    try {
      await removeItem(id, packageId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      className="cart-drawer"
      ref={dialog}
      onClose={() => {
        onClose();
      }}
      onClick={(e) => {
        if (e.target === dialog.current) {
          const rect = dialog.current.getBoundingClientRect();
          if (
            e.clientX < rect.left ||
            e.clientX > rect.right ||
            e.clientY < rect.top ||
            e.clientY > rect.bottom
          )
            close();
        }
      }}
      aria-labelledby="cart-title"
    >
      <div className="drawer-header">
        <div>
          <span className="eyebrow">انتخاب‌های شما</span>
          <h2 id="cart-title">سبد خرید</h2>
        </div>
        <button
          onClick={close}
          className="icon-button"
          aria-label="بستن سبد خرید"
        >
          <X />
        </button>
      </div>
      <div className="drawer-body">
        {cart.items.length === 0 ? (
          <div className="empty-state">
            <ShoppingBag size={48} />
            <h3>سبد شما هنوز خالی است</h3>
            <p>چیزی خوش‌عطر به آشپزخانه‌تان اضافه کنید.</p>
            <Link href="/products" onClick={close} className="button">
              دیدن محصولات
            </Link>
          </div>
        ) : (
          cart.items.map((item) => (
            <div className="cart-item" key={item.product.id + item.package.id}>
              <Link href={`/products/${item.product.slug}`} onClick={close}>
                <strong>{item.product.name}</strong>
                <small>
                  {item.package.maxQuantity === 0
                    ? "بسته تغییر کرده؛ دوباره انتخاب کنید"
                    : packageLabel(item.package)}
                </small>
              </Link>
              <button
                className="icon-button"
                aria-label={`حذف ${item.product.name}`}
                onClick={() => remove(item.product.id, item.package.id)}
                disabled={busy}
              >
                <Trash2 size={18} />
              </button>
              <div className="stepper">
                <button
                  aria-label={`کاهش تعداد ${item.product.name}`}
                  disabled={
                    busy || item.quantity <= 1 || item.package.maxQuantity === 0
                  }
                  onClick={() =>
                    change(item.product, item.package.id, item.quantity - 1)
                  }
                >
                  <Minus size={16} />
                </button>
                <span>{fa(item.quantity)} بسته</span>
                <button
                  aria-label={`افزایش تعداد ${item.product.name}`}
                  disabled={busy || item.quantity >= item.package.maxQuantity}
                  onClick={() =>
                    change(item.product, item.package.id, item.quantity + 1)
                  }
                >
                  <Plus size={16} />
                </button>
              </div>
              <span>{money(item.totalRials)} تومان</span>
            </div>
          ))
        )}
        {error ? (
          <p role="alert" className="error">
            {error}
          </p>
        ) : null}
      </div>
      {cart.items.length > 0 ? (
        <div className="drawer-footer">
          <div className="between">
            <span>جمع محصولات</span>
            <strong>{money(cart.subtotalRials)} تومان</strong>
          </div>
          <p className="muted">هزینه ارسال در مرحله بعد محاسبه می‌شود.</p>
          <Link
            href={user?.authenticated ? "/checkout" : "/login?next=/checkout"}
            onClick={close}
            className="button full"
          >
            ادامه خرید <ArrowLeft size={18} />
          </Link>
        </div>
      ) : null}
    </dialog>
  );
}
