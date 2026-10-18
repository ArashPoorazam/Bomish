"use client";
import { useState } from "react";
import Link from "next/link";
import { ArrowRight, ChevronLeft, ChevronRight } from "lucide-react";
import { useLiveQuery } from "@/hooks/use-live-query";
import { useStore } from "@/components/store-provider";
import { Workspace } from "@/components/omnisire/shared";
import { OrderManager } from "@/components/staff/order-manager";
import type { Order } from "@/lib/types";
import type { CustomerRequest } from "./types";
import { fa } from "@/lib/format";

export function CustomerOrderHistory({ requestId }: { requestId: string }) {
  const { user } = useStore();
  const enabled = !!user?.permissions?.includes("requests");
  const [page, setPage] = useState(1);
  const [viewingOrder, setViewingOrder] = useState(false);
  const [editor, setEditor] = useState({ dirty: false, busy: false });
  const { data: customer } = useLiveQuery<CustomerRequest>(
    `/staff/requests/${encodeURIComponent(requestId)}`,
    enabled,
    0,
  );
  const { data, error, loading, refresh } = useLiveQuery<{
    items: Order[];
    total: number;
  }>(
    `/staff/requests/${encodeURIComponent(requestId)}/orders?page=${page}&pageSize=20`,
    enabled,
  );
  const section = customer?.kind === "custom" ? "custom" : "support";
  return (
    <Workspace
      title="سفارش‌های مشتری"
      activeSection={section}
      navigationLocked={editor.busy}
      description="همه سفارش‌های این مشتری در تمام وضعیت‌ها؛ برای مشاهده جزئیات، روی سفارش بزنید."
      titleDetail={customer ? <bdi>{customer.phone}</bdi> : undefined}
    >
      <div className="stack">
        {!viewingOrder && (
          <div className="between">
            <Link
              className="button secondary"
              href={`/staff?section=${section}`}
            >
              <ArrowRight size={18} />
              {section === "custom"
                ? "بازگشت به درخواست‌های مشتریان"
                : "بازگشت به گفتگوهای مشتریان"}
            </Link>
            {data && <span className="badge">{fa(data.total)} سفارش</span>}
          </div>
        )}
        {!enabled && user?.role && (
          <p className="error" role="alert">
            دسترسی به سفارش‌های مشتری ندارید.
          </p>
        )}
        {error && (
          <div role="alert" className="form-card">
            <p className="error">{error}</p>
            <button
              className="button secondary"
              onClick={refresh}
              disabled={loading}
            >
              تلاش دوباره
            </button>
          </div>
        )}
        {enabled && !data && !error && (
          <p role="status">در حال دریافت سفارش‌ها…</p>
        )}
        {data?.total === 0 && (
          <div className="form-card empty-state">
            این مشتری هنوز سفارشی ثبت نکرده است.
          </div>
        )}
        {data && data.total > 0 && (
          <OrderManager
            customerHistory
            orders={data.items}
            reload={refresh}
            onStateChange={setEditor}
            onDetailChange={setViewingOrder}
          />
        )}
        {!viewingOrder && data && data.total > 20 && (
          <nav className="between" aria-label="صفحه‌بندی سفارش‌های مشتری">
            <button
              className="button secondary"
              disabled={loading || page === 1}
              onClick={() => setPage(page - 1)}
            >
              <ChevronRight size={18} /> قبلی
            </button>
            <span aria-live="polite">
              صفحه {fa(page)} از {fa(Math.ceil(data.total / 20))}
            </span>
            <button
              className="button secondary"
              disabled={loading || page * 20 >= data.total}
              onClick={() => setPage(page + 1)}
            >
              بعدی <ChevronLeft size={18} />
            </button>
          </nav>
        )}
      </div>
    </Workspace>
  );
}
