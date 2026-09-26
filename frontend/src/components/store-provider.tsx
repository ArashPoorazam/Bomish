"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { api, session as getSession } from "@/lib/api";
import type { Cart, Session, Product } from "@/lib/types";
import { money, weight } from "@/lib/format";
import { X, Minus, Plus, Trash2, ShoppingBag, ArrowLeft } from "lucide-react";
import Link from "next/link";
const empty: Cart = { items: [], subtotalRials: 0 };
type Store = {
  cart: Cart;
  user: Session | null;
  refresh: () => Promise<void>;
  setItem: (p: Product, g: number) => Promise<void>;
  openCart: (trigger?: HTMLElement) => void;
};
const Context = createContext<Store | null>(null);
export const useStore = () => {
  const s = useContext(Context);
  if (!s) throw Error("Missing store");
  return s;
};
export function StoreProvider({ children }: { children: ReactNode }) {
  const [cart, setCart] = useState<Cart>(empty),
    [user, setUser] = useState<Session | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const refresh = useCallback(async () => {
    const s = await getSession();
    setUser(s);
    setCart(await api<Cart>("/cart"));
  }, []);
  useEffect(() => {
    refresh().catch((e) => setError(e.message));
  }, [refresh]);
  const setItem = useCallback(async (p: Product, g: number) => {
    setCart(await api<Cart>(`/cart/items/${p.id}`, "PUT", { grams: g }));
  }, []);
  const openCart = (trigger?: HTMLElement) => {
    previousFocus.current = trigger || (document.activeElement as HTMLElement);
    setError("");
    dialog.current?.showModal();
    document.body.style.overflow = "hidden";
  };
  const close = () => {
    dialog.current?.close();
    document.body.style.overflow = "";
  };
  async function change(p: Product, g: number) {
    setBusy(true);
    setError("");
    try {
      await setItem(p, g);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove(id: string) {
    setBusy(true);
    try {
      setCart(await api<Cart>("/cart/items/" + id, "DELETE"));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Context.Provider value={{ cart, user, refresh, setItem, openCart }}>
      {children}
      <dialog
        className="cart-drawer"
        ref={dialog}
        onClose={() => {
          document.body.style.overflow = "";
          previousFocus.current?.focus();
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
              <div className="cart-item" key={item.product.id}>
                <Link href={`/products/${item.product.slug}`} onClick={close}>
                  <strong>{item.product.name}</strong>
                </Link>
                <button
                  className="icon-button"
                  aria-label={`حذف ${item.product.name}`}
                  onClick={() => remove(item.product.id)}
                  disabled={busy}
                >
                  <Trash2 size={18} />
                </button>
                <div className="stepper">
                  <button
                    aria-label={`کاهش وزن ${item.product.name}`}
                    disabled={
                      busy ||
                      item.grams - item.product.stepGrams <
                        item.product.minGrams
                    }
                    onClick={() =>
                      change(item.product, item.grams - item.product.stepGrams)
                    }
                  >
                    <Minus size={16} />
                  </button>
                  <span>{weight(item.grams)}</span>
                  <button
                    aria-label={`افزایش وزن ${item.product.name}`}
                    disabled={
                      busy ||
                      item.grams + item.product.stepGrams >
                        Math.min(
                          item.product.maxGrams,
                          item.product.availableGrams,
                        )
                    }
                    onClick={() =>
                      change(item.product, item.grams + item.product.stepGrams)
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
            <Link href="/checkout" onClick={close} className="button full">
              ادامه خرید <ArrowLeft size={18} />
            </Link>
          </div>
        ) : null}
      </dialog>
    </Context.Provider>
  );
}
