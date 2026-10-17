"use client";
import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Package, MapPin } from "lucide-react";
import type { Order } from "@/lib/types";
import { date, fa, money, statuses, weight } from "@/lib/format";
import { api } from "@/lib/api";
import { useStore } from "./store-provider";
import { deliveryStatuses, providerName } from "@/lib/shipping";
import { OrderProgress } from "./order-progress";
export const orderStates = [
  "pending",
  "paid",
  "packing",
  "shipped",
  "received",
  "cancelled",
  "expired",
  "review",
];
export const activeOrderStates = [
  "pending",
  "paid",
  "packing",
  "shipped",
  "review",
];
export function OrderSummary({ order: o }: { order: Order }) {
  return (
    <Link
      className="order-card order-summary"
      href={`/account/orders/${o.id}`}
      aria-label={`جزئیات و پیگیری سفارش ${o.id.slice(0, 8)}`}
    >
      <div className="order-summary-top">
        <div className="order-symbol">
          <Package size={21} />
        </div>
        <div>
          <h3>
            سفارش <bdi>{o.id.slice(0, 8)}</bdi>
          </h3>
          <time dateTime={o.createdAt}>{date(o.createdAt)}</time>
        </div>
        <span className="badge" data-status={o.status}>
          {statuses[o.status] || o.status}
        </span>
      </div>
      <ul className="order-item-preview">
        {o.items.map((item, index) => (
          <li key={index}>
            {item.name} · {item.packageLabel || weight(item.grams)} ×{" "}
            {fa(item.quantity)}
          </li>
        ))}
      </ul>
      <div className="order-summary-bottom">
        <strong>
          {money(o.totalRials)} <small>تومان</small>
        </strong>
        <span className="text-link">
          جزئیات و پیگیری <ArrowLeft size={16} />
        </span>
      </div>
    </Link>
  );
}

export function PendingPayment({
  order,
  onPaid,
}: {
  order: Order;
  onPaid: () => Promise<void>;
}) {
  const { user, refresh } = useStore();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  if (order.status !== "pending" || !user?.development) return null;
  return (
    <div className="pending-payment">
      <p>این سفارش در انتظار پرداخت است.</p>
      <button
        className="button secondary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            await api(`/orders/${order.id}/simulate`, "POST", {
              success: true,
            });
            await onPaid();
            await refresh();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "در حال پرداخت…" : "ادامه پرداخت آزمایشی"}
      </button>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
export function OrderView({
  order: o,
  trackingUrl,
}: {
  order: Order;
  trackingUrl?: string;
}) {
  return (
    <div className="order-detail-content">
      <article className="account-panel">
        <div className="between">
          <div>
            <h3>
              سفارش <bdi>{o.id.slice(0, 8)}</bdi>
            </h3>
            <p className="muted">{date(o.createdAt)}</p>
          </div>
          <span className="badge" data-status={o.status}>
            {statuses[o.status] || o.status}
          </span>
        </div>
        <OrderProgress order={o} trackingUrl={trackingUrl} />
        {o.shipping && (
          <section className="stack delivery-selection">
            <h4>
              {providerName(o.shipping.method)} ·{" "}
              {fa(o.shipping.parcels.length)} کارتن ارسال
            </h4>
            <p>{deliveryStatuses[o.shipping.status] ?? "در حال بررسی ارسال"}</p>
            {o.shipping.simulated && <small>ارسال شبیه‌سازی‌شده</small>}
            {o.shipping.parcels.map((p, i) => (
              <div key={p.id}>
                {p.tracking && (
                  <p>
                    کارتن {fa(i + 1)}: <bdi>{p.tracking}</bdi>
                  </p>
                )}
                {p.trackingUrl && (
                  <a
                    href={p.trackingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    پیگیری مرسوله پستی {fa(i + 1)}
                  </a>
                )}
              </div>
            ))}
            <ol>
              {o.shipping.events.map((e, i) => (
                <li key={i}>
                  {deliveryStatuses[e.status] ?? "به‌روزرسانی ارسال"} ·{" "}
                  {date(e.createdAt)}
                </li>
              ))}
            </ol>
          </section>
        )}
      </article>
      <article className="account-panel">
        <h3>محصولات سفارش</h3>
        <ul className="order-items">
          {o.items.map((i) => (
            <li key={i.productId + i.packageId}>
              <div>
                <strong>{i.name}</strong>
                <p>
                  {i.packageLabel || weight(i.grams)} · {fa(i.quantity)} بسته
                </p>
              </div>
              <span>{money(i.totalRials)} تومان</span>
            </li>
          ))}
        </ul>
        <div className="order-totals">
          <div>
            <span>جمع محصولات</span>
            <span>{money(o.subtotalRials)} تومان</span>
          </div>
          <div>
            <span>هزینه ارسال</span>
            <span>
              {o.shippingRials ? `${money(o.shippingRials)} تومان` : "رایگان"}
            </span>
          </div>
          {o.discountRials > 0 && (
            <div className="coupon-saving">
              <span>
                تخفیف <bdi>{o.discountCode}</bdi>
              </span>
              <span>−{money(o.discountRials)} تومان</span>
            </div>
          )}
          <div>
            <strong>جمع با ارسال</strong>
            <strong>{money(o.totalRials)} تومان</strong>
          </div>
        </div>
      </article>
      <article className="account-panel delivery-address">
        <h3>
          <MapPin size={20} /> نشانی تحویل
        </h3>
        <strong>{o.address.recipient}</strong>
        <p>
          {o.address.province}، {o.address.city}، {o.address.street}
        </p>
        <p>
          شماره همراه: <bdi>{o.address.phone}</bdi> · کد پستی:{" "}
          <bdi>{o.address.postalCode}</bdi>
        </p>
      </article>
    </div>
  );
}
