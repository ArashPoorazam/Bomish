"use client";
import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowLeft,
  MapPin,
  PackageCheck,
  Phone,
  Copy,
} from "lucide-react";
import { api } from "@/lib/api";
import type { Order } from "@/lib/types";
import { digits, fa, money, statuses, weight } from "@/lib/format";
import { StaffOrderStages, orderStamp } from "./order-stages";
export function StaffOrderDetail({
  initial,
  onClose,
  onBusyChange,
  onChanged,
}: {
  initial: Order;
  onClose: () => void;
  onBusyChange: (busy: boolean) => void;
  onChanged: () => Promise<void>;
}) {
  const heading = useRef<HTMLHeadingElement>(null),
    lock = useRef(false);
  const [order, setOrder] = useState(initial),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [tracking, setTracking] = useState(initial.tracking),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  useEffect(() => onBusyChange(busy), [busy, onBusyChange]);
  useEffect(() => {
    let live = true;
    setLoading(true);
    setError("");
    api<Order>(`/staff/orders/${encodeURIComponent(initial.id)}`)
      .then((v) => {
        if (live) {
          setOrder(v);
          setTracking(v.tracking);
        }
      })
      .catch((e) => {
        if (live) setError(e.message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [initial.id, retry]);
  async function change(
    path: string,
    body: unknown,
    success: string,
    optimistic?: Order,
  ) {
    if (lock.current || loading) return;
    lock.current = true;
    if (optimistic) setOrder(optimistic);
    setBusy(true);
    setError("");
    setMessage("");
    let saved = false;
    try {
      await api(path, "PATCH", body);
      saved = true;
      const fresh = await api<Order>(
        `/staff/orders/${encodeURIComponent(order.id)}`,
      );
      setOrder(fresh);
      setMessage(success);
      await onChanged();
    } catch (e) {
      if (!saved && optimistic) setOrder(order);
      setError(
        saved
          ? "تغییر ذخیره شد، اما اطلاعات تازه دریافت نشد؛ دوباره بارگذاری کنید."
          : (e as Error).message,
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const packed = order.items.filter((i) => i.packed).length;
  const canPack = ["paid", "packing"].includes(order.status);
  const next =
    order.status === "paid"
      ? "packing"
      : order.status === "packing"
        ? "shipped"
        : order.status === "shipped"
          ? "received"
          : "";
  return (
    <section className="staff-order-detail" aria-labelledby="staff-order-title">
      <button
        type="button"
        className="button secondary staff-order-back"
        disabled={busy}
        onClick={onClose}
      >
        <ArrowRight size={18} /> بازگشت به سفارش‌ها
      </button>
      <header className="staff-order-detail-header">
        <div>
          <h2 id="staff-order-title" ref={heading} tabIndex={-1}>
            سفارش <bdi>#{order.id.slice(0, 8)}</bdi>
          </h2>
          <p>
            {order.address.recipient} · {orderStamp(order.createdAt)}
          </p>
        </div>
      </header>
      <div className="staff-order-detail-body">
        <section className="staff-order-status-card">
          <div className="between">
            <h3>وضعیت سفارش</h3>
            <span className="badge">{statuses[order.status]}</span>
          </div>
          <StaffOrderStages order={order} expanded />
        </section>
        <section
          className="staff-order-next"
          aria-labelledby="order-next-title"
        >
          <div className="staff-order-next-copy">
            <h3 id="order-next-title">قدم بعدی</h3>
            {next && (
              <p className="staff-order-transition">
                <span>{statuses[order.status]}</span>
                <ArrowLeft size={18} aria-hidden="true" />
                <strong>{statuses[next]}</strong>
              </p>
            )}
            {order.status === "review" && (
              <p className="error">
                پرداخت تأیید شده اما سفارش نیازمند بررسی است. تأیید یا بازپرداخت
                را با مالک پیگیری کنید.
              </p>
            )}
            {order.status === "pending" && (
              <p className="muted">
                در انتظار پرداخت مشتری؛ بسته‌بندی پس از تأیید پرداخت فعال
                می‌شود.
              </p>
            )}
            {["cancelled", "expired", "received"].includes(order.status) && (
              <p className="muted">
                {statuses[order.status]}؛ اقدام دیگری برای ارسال لازم نیست.
              </p>
            )}
            {order.status === "paid" && (
              <p className="muted">
                اقلام را آماده کنید و پس از تکمیل، بسته‌بندی سفارش را تأیید
                کنید.
              </p>
            )}
          </div>
          <div className="staff-order-next-controls">
            {order.status === "packing" && (
              <label>
                کد رهگیری مرسوله
                <input
                  inputMode="numeric"
                  dir="ltr"
                  value={tracking}
                  disabled={busy || loading}
                  placeholder="۱۰ تا ۳۰ رقم"
                  onChange={(e) =>
                    setTracking(digits(e.target.value).replace(/\s/g, ""))
                  }
                />
              </label>
            )}
            {next && (
              <button
                type="button"
                className="button"
                disabled={
                  busy ||
                  loading ||
                  !!error ||
                  (next === "shipped" && !/^[0-9]{10,30}$/.test(tracking))
                }
                onClick={() =>
                  void change(
                    `/staff/orders/${encodeURIComponent(order.id)}`,
                    { status: next, tracking },
                    "وضعیت سفارش به‌روز شد.",
                  )
                }
              >
                <ArrowLeft size={18} aria-hidden="true" />
                {busy
                  ? "در حال ذخیره…"
                  : next === "packing"
                    ? "تأیید بسته‌بندی"
                    : next === "shipped"
                      ? "ثبت ارسال و اطلاع‌رسانی"
                      : "تأیید تحویل به مشتری"}
              </button>
            )}
            {order.tracking && (
              <p>
                کد رهگیری:{" "}
                <bdi className="staff-tracking-code">{order.tracking}</bdi>
              </p>
            )}
          </div>
        </section>
        {loading && <p role="status">در حال دریافت آخرین وضعیت سفارش…</p>}
        {error && (
          <p role="alert" className="error">
            {error}{" "}
            <button
              type="button"
              className="text-link"
              disabled={busy || loading}
              onClick={() => setRetry(retry + 1)}
            >
              بارگذاری دوباره
            </button>
          </p>
        )}
        {message && (
          <p role="status" className="success">
            {message}
          </p>
        )}
        <div className="staff-order-detail-grid">
          <div className="stack">
            <section className="staff-order-panel">
              <div className="between">
                <h3>
                  <PackageCheck size={20} /> اقلام و چک‌لیست بسته‌بندی
                </h3>
                <span className="badge">
                  {fa(packed)} از {fa(order.items.length)} آماده
                </span>
              </div>
              <p className="muted">
                هر ردیف را پس از بسته‌بندی همه تعداد همان بسته علامت بزنید.
                تغییرات خودکار ذخیره می‌شوند.
              </p>
              {!canPack && (
                <p className="muted">
                  چک‌لیست فقط برای سفارش پرداخت‌شده و پیش از ارسال قابل ویرایش
                  است.
                </p>
              )}
              <progress
                className="staff-packing-progress"
                max={Math.max(1, order.items.length)}
                value={packed}
                aria-label="پیشرفت بسته‌بندی"
              />
              <div className="staff-packing-items">
                {order.items.map((item) => (
                  <label
                    key={`${item.productId}:${item.packageId}`}
                    className={`staff-packing-item ${item.packed ? "is-packed" : ""}`}
                  >
                    <input
                      type="checkbox"
                      checked={!!item.packed}
                      disabled={busy || loading || !!error || !canPack}
                      aria-label={`بسته‌بندی ${item.name}، ${item.packageLabel || weight(item.grams)}، ${fa(item.quantity)} بسته`}
                      onChange={(e) =>
                        void change(
                          `/staff/orders/${encodeURIComponent(order.id)}/packing`,
                          {
                            productId: item.productId,
                            packageId: item.packageId,
                            packed: e.target.checked,
                          },
                          "وضعیت بسته‌بندی ذخیره شد.",
                          {
                            ...order,
                            items: order.items.map((row) =>
                              row.productId === item.productId &&
                              row.packageId === item.packageId
                                ? { ...row, packed: e.target.checked }
                                : row,
                            ),
                          },
                        )
                      }
                    />
                    <span className="staff-packing-item-info">
                      <strong>{item.name}</strong>
                      <span>
                        {item.packageLabel || weight(item.grams)} ·{" "}
                        <strong>{fa(item.quantity)} بسته</strong>
                      </span>
                      <small>
                        {item.packed ? "بسته‌بندی شده" : "بسته‌بندی نشده"}
                      </small>
                    </span>
                    <span className="staff-packing-item-price">
                      {money(item.totalRials)} تومان
                      <small>هر بسته {money(item.priceRials)} تومان</small>
                    </span>
                  </label>
                ))}
              </div>
            </section>
            <section className="staff-order-panel">
              <h3>مبالغ سفارش</h3>
              <dl className="staff-order-totals">
                <div>
                  <dt>جمع محصولات</dt>
                  <dd>{money(order.subtotalRials)} تومان</dd>
                </div>
                <div>
                  <dt>هزینه ارسال</dt>
                  <dd>{money(order.shippingRials)} تومان</dd>
                </div>
                {order.discountRials > 0 && (
                  <div>
                    <dt>
                      تخفیف کد <bdi>{order.discountCode}</bdi>
                    </dt>
                    <dd>−{money(order.discountRials)} تومان</dd>
                  </div>
                )}
                <div className="staff-order-total">
                  <dt>مبلغ نهایی</dt>
                  <dd>{money(order.totalRials)} تومان</dd>
                </div>
              </dl>
            </section>
          </div>
          <div className="stack">
            <section className="staff-order-panel stack">
              <h3>
                <MapPin size={20} /> گیرنده و نشانی ارسال
              </h3>
              <strong>{order.address.recipient}</strong>
              <a
                className="staff-order-phone"
                href={`tel:${order.address.phone}`}
              >
                <Phone size={16} />
                <bdi>{order.address.phone}</bdi>
              </a>
              <address>
                {order.address.province}، {order.address.city}
                <br />
                {order.address.street}
              </address>
              <div>
                کد پستی: <bdi>{order.address.postalCode}</bdi>
              </div>
              <button
                type="button"
                className="button secondary"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(
                      `${order.address.recipient}\n${order.address.phone}\n${order.address.province}، ${order.address.city}، ${order.address.street}\nکد پستی: ${order.address.postalCode}`,
                    );
                    setMessage("نشانی کپی شد.");
                  } catch {
                    setMessage(
                      "کپی خودکار ممکن نشد؛ نشانی را انتخاب و کپی کنید.",
                    );
                  }
                }}
              >
                <Copy size={16} /> کپی نشانی
              </button>
            </section>

            <section className="staff-order-panel">
              <h3>تاریخچه سفارش</h3>
              <ol className="staff-order-history">
                {order.events.map((event, index) => (
                  <li key={`${event.createdAt}:${index}`}>
                    <span>{statuses[event.status] || event.status}</span>
                    <time dateTime={event.createdAt}>
                      {orderStamp(event.createdAt)}
                    </time>
                  </li>
                ))}
              </ol>
              <small className="muted">
                شماره کامل سفارش:{" "}
                <bdi className="staff-full-order-id">{order.id}</bdi>
              </small>
            </section>
          </div>
        </div>
      </div>
    </section>
  );
}
