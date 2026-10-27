"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api, session as getSession } from "@/lib/api";
import type { Cart, Session, Product } from "@/lib/types";
import dynamic from "next/dynamic";

const CartDrawer = dynamic(() =>
  import("./cart-drawer").then((module) => module.CartDrawer),
);
const empty: Cart = { items: [], subtotalRials: 0 };
type Store = {
  cart: Cart;
  user: Session | null;
  sessionError: string;
  refresh: () => Promise<void>;
  setItem: (p: Product, packageId: string, quantity: number) => Promise<void>;
  openCart: (trigger?: HTMLElement) => void;
};
const Context = createContext<Store | null>(null);
export const useStore = () => {
  const s = useContext(Context);
  if (!s) throw Error("Missing store");
  return s;
};
export function StoreProvider({
  children,
  workspace = false,
}: {
  children: ReactNode;
  workspace?: boolean;
}) {
  const [sessionError, setSessionError] = useState("");
  const [cart, setCart] = useState<Cart>(empty);
  const [user, setUser] = useState<Session | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const previousFocus = useRef<HTMLElement | null>(null);
  const generation = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++generation.current;
    setSessionError("");
    let s: Session;
    try {
      s = await getSession(workspace ? "staff" : "customer");
    } catch (e) {
      if (current === generation.current) setSessionError((e as Error).message);
      throw e;
    }
    if (current !== generation.current) return;
    setUser(s);
    if (!workspace && !s.catalogOnly) {
      const nextCart = await api<Cart>("/cart");
      if (current === generation.current) setCart(nextCart);
    }
  }, [workspace]);
  useEffect(() => {
    refresh().catch(() => {});
    const expired = (event: Event) => {
      if (
        (event as CustomEvent<string>).detail ===
        (workspace ? "staff" : "customer")
      )
        void refresh().catch(() => {});
    };
    window.addEventListener("bomish:session-expired", expired);
    return () => {
      generation.current++;
      window.removeEventListener("bomish:session-expired", expired);
    };
  }, [refresh, workspace]);
  const setItem = useCallback(
    async (p: Product, packageId: string, quantity: number) => {
      setCart(
        await api<Cart>(`/cart/items/${p.id}`, "PUT", { packageId, quantity }),
      );
    },
    [],
  );
  const removeItem = useCallback(async (id: string, packageId: string) => {
    setCart(
      await api<Cart>(
        `/cart/items/${id}?packageId=${encodeURIComponent(packageId)}`,
        "DELETE",
      ),
    );
  }, []);
  const openCart = useCallback((trigger?: HTMLElement) => {
    previousFocus.current = trigger || (document.activeElement as HTMLElement);
    setCartOpen(true);
  }, []);
  const closeCart = useCallback(() => setCartOpen(false), []);
  const value = useMemo(
    () => ({ cart, user, sessionError, refresh, setItem, openCart }),
    [cart, user, sessionError, refresh, setItem, openCart],
  );
  return (
    <Context.Provider value={value}>
      {children}
      {cartOpen && !workspace && user && !user.catalogOnly && (
        <CartDrawer
          onClose={closeCart}
          returnFocus={previousFocus.current}
          removeItem={removeItem}
        />
      )}
    </Context.Provider>
  );
}
