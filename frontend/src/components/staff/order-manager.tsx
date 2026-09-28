"use client";
import { useEffect, useState } from "react";
import { ChevronLeft, RefreshCw, Search } from "lucide-react";
import type { Order } from "@/lib/types";
import { digits, fa, money, statuses } from "@/lib/format";
import { StaffOrderStages, orderStamp } from "./order-stages";
import { StaffOrderDetail } from "./order-detail";
export function OrderManager({
  initialQuery = "",
  orders,
  onFilters,
  reload,
  onStateChange,
}: {
  initialQuery?: string;
  orders: Order[];
  onFilters?: (filters: Record<string, string>) => void;
  reload: () => Promise<void>;
  onStateChange: (state: { dirty: boolean; busy: boolean }) => void;
}) {
  const [query, setQuery] = useState(initialQuery),
    [filter, setFilter] = useState(initialQuery ? "" : "active");
  const [selected, setSelected] = useState<Order | null>(null),
    [busy, setBusy] = useState(false),
    [refreshing, setRefreshing] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    const timer = setTimeout(
      () => onFilters?.({ q: query, status: filter }),
      250,
    );
    return () => clearTimeout(timer);
  }, [query, filter, onFilters]);
  useEffect(() => onStateChange({ dirty: false, busy }), [busy, onStateChange]);
  const visible = onFilters
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
  return (
    <div className="staff-orders stack">
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
            onClick={() => setSelected(o)}
            aria-haspopup="dialog"
            aria-label={`جزئیات سفارش ${o.id.slice(0, 8)}، ${o.address.recipient}`}
          >
            <span className="staff-order-identity">
              <strong>{o.address.recipient}</strong>
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
                  بسته · {fa(o.items.filter((i) => i.packed).length)} از{" "}
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
        {!visible.length && (
          <div className="form-card empty-state">
            سفارشی با این جستجو و وضعیت پیدا نشد.
          </div>
        )}
      </div>
      {selected && (
        <StaffOrderDetail
          key={selected.id}
          initial={selected}
          onClose={() => setSelected(null)}
          onBusyChange={setBusy}
          onChanged={reload}
        />
      )}
    </div>
  );
}
