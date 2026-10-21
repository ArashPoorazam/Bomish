"use client";
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, RefreshCw, Search } from "lucide-react";
import type { Order } from "@/lib/types";
import { digits, fa, money, statuses } from "@/lib/format";
import { deliveryStatuses, providerName } from "@/lib/shipping";
import { StaffOrderStages, orderStamp } from "./order-stages";
import { StaffOrderDetail } from "./order-detail";
export function OrderManager({
  loading = false,
  initialQuery = "",
  customerHistory = false,
  orders,
  onFilters,
  reload,
  onStateChange,
  onDetailChange,
}: {
  loading?: boolean;
  initialQuery?: string;
  customerHistory?: boolean;
  orders: Order[];
  onFilters?: (filters: Record<string, string>) => void;
  reload: () => Promise<void>;
  onStateChange: (state: { dirty: boolean; busy: boolean }) => void;
  onDetailChange: (open: boolean) => void;
}) {
  const [provider, setProvider] = useState(""),
    [attention, setAttention] = useState("");
  const [query, setQuery] = useState(initialQuery),
    [filter, setFilter] = useState(initialQuery ? "" : "active");
  const [selected, setSelected] = useState<Order | null>(null),
    [busy, setBusy] = useState(false),
    [refreshing, setRefreshing] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    const timer = setTimeout(
      () => onFilters?.({ q: query, status: filter, provider, attention }),
      250,
    );
    return () => clearTimeout(timer);
  }, [query, filter, provider, attention, onFilters]);
  useEffect(() => onStateChange({ dirty: false, busy }), [busy, onStateChange]);
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());
  const returnFocus = useRef("");
  useEffect(() => {
    if (!selected && returnFocus.current)
      rowRefs.current.get(returnFocus.current)?.focus();
  }, [selected]);
  const visible =
    onFilters || customerHistory
      ? orders
      : orders.filter(
          (o) =>
            (!filter ||
              (filter === "active"
                ? ["paid", "packing", "shipped", "review"].includes(o.status)
                : o.status === filter)) &&
            digits(
              `${o.id} ${o.address.recipient} ${o.address.phone} ${o.tracking}`,
            ).includes(digits(query)),
        );
  if (selected)
    return (
      <StaffOrderDetail
        key={selected.id}
        initial={selected}
        readOnly={customerHistory}
        onClose={() => {
          setSelected(null);
          onDetailChange(false);
        }}
        onBusyChange={setBusy}
        onChanged={reload}
      />
    );
  return (
    <div className="staff-orders stack">
      {!customerHistory && (
        <div className="catalog-toolbar staff-orders-toolbar">
          <label>
            <span>جستجوی سفارش</span>
            <span className="staff-order-search">
              <Search size={18} aria-hidden="true" />
              <input
                type="search"
                placeholder="نام، همراه، شماره سفارش یا رهگیری"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </span>
          </label>
          <label>
            وضعیت
            <select value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="active">نیازمند اقدام</option>
              <option value="">همه سفارش‌ها</option>
              {[
                "paid",
                "packing",
                "shipped",
                "received",
                "pending",
                "review",
                "cancelled",
                "expired",
              ].map((s) => (
                <option key={s} value={s}>
                  {statuses[s]}
                </option>
              ))}
            </select>
          </label>
          <label>
            روش ارسال
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
            >
              <option value="">همه روش‌ها</option>
              <option value="snapp">ارسال تهران / اسنپ</option>
              <option value="own_courier">پیک بومیش</option>
              <option value="post">پست محاسبه‌شده</option>
              <option value="legacy_postal">پست قبلی</option>
            </select>
          </label>
          <label>
            پیگیری ارسال
            <select
              value={attention}
              onChange={(e) => setAttention(e.target.value)}
            >
              <option value="">همه</option>
              <option value="ready">آماده درخواست</option>
              <option value="waiting">در انتظار پیک</option>
              <option value="unknown">درخواست نامشخص</option>
              <option value="failed">ارسال ناموفق / بازگشت</option>
              <option value="missing">نیازمند تکمیل</option>
            </select>
          </label>
          <button
            type="button"
            className="button secondary"
            disabled={refreshing}
            onClick={async () => {
              setRefreshing(true);
              setError("");
              try {
                await reload();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setRefreshing(false);
              }
            }}
          >
            <RefreshCw size={16} />
            {refreshing ? "در حال دریافت…" : "به‌روزرسانی"}
          </button>
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="staff-order-list">
        {visible.map((o) => (
          <button
            type="button"
            className="staff-order-row"
            key={o.id}
            ref={(node) => {
              if (node) rowRefs.current.set(o.id, node);
              else rowRefs.current.delete(o.id);
            }}
            onClick={() => {
              returnFocus.current = o.id;
              setSelected(o);
              onDetailChange(true);
            }}
            aria-label={`جزئیات سفارش ${o.id.slice(0, 8)}، ${o.address.recipient}`}
          >
            <span className="staff-order-identity">
              <strong>
                {o.address.recipient}{" "}
                <span className="badge">
                  {providerName(o.shipping?.method)}
                </span>
              </strong>
              {o.shipping && (
                <small>
                  {deliveryStatuses[o.shipping.status]} ·{" "}
                  {fa(o.shipping.parcels.length)} کارتن ارسال
                </small>
              )}
              <small>
                <bdi>#{o.id.slice(0, 8)}</bdi> · {o.address.city}
              </small>
              <time dateTime={o.createdAt}>{orderStamp(o.createdAt)}</time>
            </span>
            <span className="staff-order-progress">
              <StaffOrderStages order={o} />
              <span className="staff-order-meta">
                <span
                  className={`badge ${["review", "cancelled", "expired"].includes(o.status) ? "draft-badge" : ""}`}
                >
                  {statuses[o.status]}
                </span>
                <span>
                  {fa(o.items.reduce((sum, item) => sum + item.quantity, 0))}{" "}
                  بسته محصول · {fa(o.items.filter((i) => i.packed).length)} از{" "}
                  {fa(o.items.length)} ردیف آماده
                </span>
              </span>
            </span>
            <span className="staff-order-amount">
              <strong>
                {money(o.totalRials)} <small>تومان</small>
              </strong>
              <span>
                مشاهده سفارش <ChevronLeft size={16} />
              </span>
            </span>
          </button>
        ))}
        {loading && !visible.length && (
          <div className="workspace-list-loading" role="status">
            در حال دریافت اطلاعات…
          </div>
        )}
        {!visible.length && !loading && (
          <div className="form-card empty-state">
            سفارشی با این جستجو و وضعیت پیدا نشد.
          </div>
        )}
      </div>
    </div>
  );
}
