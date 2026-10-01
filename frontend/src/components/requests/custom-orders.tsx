"use client";
import Link from "next/link";
import { useState } from "react";
import { Plus, ClipboardList } from "lucide-react";
import { AccountShell } from "../account-shell";
import { useStore } from "../store-provider";
import { date, fa, money } from "@/lib/format";
import { useLiveQuery } from "@/hooks/use-live-query";
import {
  requestStatuses,
  type RequestPage,
  type CustomerRequest,
} from "./types";
function CustomRequestCard({ request: r }: { request: CustomerRequest }) {
  const [expanded, setExpanded] = useState(false);
  const long = r.description.length > 220;
  return (
    <article className="account-panel request-card customer-request-card">
      <div className="between">
        <div className="custom-request-reference">
          <ClipboardList size={19} />
          <h3>
            درخواست <bdi>{r.id.slice(0, 8)}</bdi>
          </h3>
        </div>
        <span className={`request-status status-${r.status}`}>
          {requestStatuses[r.status]}
        </span>
      </div>
      <time dateTime={r.createdAt}>{date(r.createdAt)}</time>
      <p className="customer-request-description">
        {long && !expanded ? r.description.slice(0, 220) + "…" : r.description}
      </p>
      {long && (
        <button
          className="text-link request-expand"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "نمایش کمتر" : "نمایش شرح کامل"}
        </button>
      )}
      <dl className="customer-request-facts">
        <div>
          <dt>مقدار درخواستی</dt>
          <dd>{r.quantity}</dd>
        </div>
        <div>
          <dt>بودجه کل پیشنهادی</dt>
          <dd>
            {money(r.budgetRials)} <small>تومان</small>
          </dd>
        </div>
      </dl>
      {r.response && (
        <div className="customer-request-response">
          <strong>پاسخ بومیش</strong>
          <p>{r.response}</p>
        </div>
      )}
    </article>
  );
}
export function CustomOrders({ created = false }: { created?: boolean }) {
  const { user } = useStore();
  const [page, setPage] = useState(1);
  const { data, error, loading, refresh } = useLiveQuery<RequestPage>(
    `/requests?kind=custom&page=${page}&pageSize=10`,
    !!user?.authenticated,
  );
  return (
    <AccountShell
      section="custom"
      title="سفارش‌های اختصاصی"
      actions={
        <>
          <button
            className="button secondary order-refresh"
            disabled={loading}
            onClick={refresh}
          >
            {loading ? "در حال به‌روزرسانی…" : "به‌روزرسانی درخواست‌ها"}
          </button>
          <Link href="/account/custom/new" className="button">
            <Plus size={17} /> سفارش اختصاصی جدید
          </Link>
        </>
      }
    >
      {created && (
        <p className="account-success" role="status">
          درخواست ثبت شد؛ نتیجه بررسی در همین صفحه نمایش داده می‌شود.
        </p>
      )}
      {error && (
        <div className="account-panel" role="alert">
          <p className="error">{error}</p>
          <button disabled={loading} onClick={refresh}>
            تلاش دوباره
          </button>
        </div>
      )}
      {!data && !error && <p role="status">در حال دریافت درخواست‌ها…</p>}
      <div className="customer-request-list">
        {data?.items.map((r) => (
          <CustomRequestCard key={r.id} request={r} />
        ))}
      </div>
      {data?.total === 0 && (
        <div className="empty-state">
          <ClipboardList size={32} />
          <h3>هنوز درخواست اختصاصی ندارید</h3>
          <p>محصول و مقدار دلخواهتان را برای بررسی به ما بگویید.</p>
          <Link href="/account/custom/new" className="button">
            سفارش اختصاصی جدید
          </Link>
        </div>
      )}
      {data && data.total > 10 && (
        <nav className="custom-pagination" aria-label="صفحه‌های درخواست‌ها">
          <button
            disabled={page <= 1 || loading}
            onClick={() => setPage(page - 1)}
          >
            قبلی
          </button>
          <span>
            صفحه {fa(page)} از {fa(Math.ceil(data.total / 10))}
          </span>
          <button
            disabled={page * 10 >= data.total || loading}
            onClick={() => setPage(page + 1)}
          >
            بعدی
          </button>
        </nav>
      )}
    </AccountShell>
  );
}
