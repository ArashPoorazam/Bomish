"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import type { Order } from "@/lib/types";
import { useStore } from "./store-provider";
import { AccountShell } from "./account-shell";
import { OrderView, PendingPayment } from "./customer-order";
export function OrderTracking({ id }: { id: string }) {
  const { user } = useStore();
  const [result, setResult] = useState<{
      order: Order;
      trackingUrl: string;
    } | null>(null),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0);
  const fetchOrder = useCallback(
    () =>
      api<{ order: Order; trackingUrl: string }>(
        "/orders/" + encodeURIComponent(id),
      ),
    [id],
  );
  useEffect(() => {
    setResult(null);
    setError("");
    if (!user?.authenticated) return;
    let active = true;
    const load = () =>
      fetchOrder()
        .then((v) => {
          if (active) {
            setResult(v);
            setError("");
          }
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 30000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [fetchOrder, user?.authenticated, retry]);
  return (
    <AccountShell section="orders" title="سفارش شما، قدم به قدم">
      <Link className="text-link account-back" href="/account">
        ← حساب من
      </Link>
      {error && (
        <div className="account-panel" role="alert">
          <p className="error">{error}</p>
          <button
            className="button secondary"
            onClick={() => setRetry((n) => n + 1)}
          >
            تلاش دوباره
          </button>
        </div>
      )}
      {result ? (
        <>
          <PendingPayment
            order={result.order}
            onPaid={async () => setResult(await fetchOrder())}
          />
          <OrderView order={result.order} trackingUrl={result.trackingUrl} />
        </>
      ) : (
        !error && <p role="status">در حال دریافت وضعیت سفارش…</p>
      )}
    </AccountShell>
  );
}
