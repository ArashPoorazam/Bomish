"use client";
import { useLiveQuery } from "@/hooks/use-live-query";
import Link from "next/link";
import type { Order } from "@/lib/types";
import { useStore } from "./store-provider";
import { AccountShell } from "./account-shell";
import { OrderView, PendingPayment } from "./customer-order";
export function OrderTracking({ id }: { id: string }) {
  const { user } = useStore();
  const {
    data: result,
    error,
    loading,
    refresh,
  } = useLiveQuery<{ order: Order; trackingUrl: string }>(
    "/orders/" + encodeURIComponent(id),
    !!user?.authenticated,
  );
  return (
    <AccountShell section="orders" title="سفارش شما، قدم به قدم">
      <Link className="text-link account-back" href="/account">
        ← حساب من
      </Link>
      <button
        className="button secondary order-refresh"
        disabled={loading}
        onClick={refresh}
      >
        {loading ? "در حال به‌روزرسانی…" : "به‌روزرسانی وضعیت"}
      </button>
      {error && (
        <div className="account-panel" role="alert">
          <p className="error">{error}</p>
          <button className="button secondary" onClick={refresh}>
            تلاش دوباره
          </button>
        </div>
      )}
      {result ? (
        <>
          <PendingPayment order={result.order} onPaid={refresh} />
          <OrderView order={result.order} trackingUrl={result.trackingUrl} />
        </>
      ) : (
        !error && <p role="status">در حال دریافت وضعیت سفارش…</p>
      )}
    </AccountShell>
  );
}
