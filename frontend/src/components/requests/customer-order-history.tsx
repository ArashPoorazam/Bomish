"use client";
import { useState } from "react";
import { useLiveQuery } from "@/hooks/use-live-query";
import type { Order } from "@/lib/types";
import { date, fa, money, statuses } from "@/lib/format";
export function CustomerOrderHistory({ requestId }: { requestId: string }) {
  const [page, setPage] = useState(1);
  const { data, error, loading, refresh } = useLiveQuery<{
    items: Order[];
    total: number;
  }>(
    `/staff/requests/${encodeURIComponent(requestId)}/orders?page=${page}&pageSize=20`,
  );
  return (
    <main className="container stack" dir="rtl">
      <h1>همه سفارش‌های مشتری</h1>
      {error && (
        <div role="alert">
          <p className="error">{error}</p>
          <button onClick={refresh}>تلاش دوباره</button>
        </div>
      )}
      {loading && <p role="status">در حال دریافت سفارش‌ها…</p>}
      {data?.total === 0 && <p>این مشتری هنوز سفارشی ثبت نکرده است.</p>}
      {data?.items.map((order) => (
        <article className="card stack" key={order.id}>
          <h2>
            سفارش <bdi>{order.id}</bdi>
          </h2>
          <p>
            {date(order.createdAt)} · {statuses[order.status]} ·{" "}
            {money(order.totalRials)}
          </p>
          <p>
            {order.address.recipient} · <bdi>{order.address.phone}</bdi>
          </p>
          <ul>
            {order.items.map((item, index) => (
              <li key={index}>
                {item.name} · {fa(item.quantity)}
              </li>
            ))}
          </ul>
        </article>
      ))}
      {data && data.total > 20 && (
        <nav aria-label="صفحه‌بندی سفارش‌های مشتری">
          <button
            disabled={loading || page === 1}
            onClick={() => setPage(page - 1)}
          >
            قبلی
          </button>
          <span>
            {" "}
            صفحه {fa(page)} از {fa(Math.ceil(data.total / 20))}{" "}
          </span>
          <button
            disabled={loading || page * 20 >= data.total}
            onClick={() => setPage(page + 1)}
          >
            بعدی
          </button>
        </nav>
      )}
    </main>
  );
}
