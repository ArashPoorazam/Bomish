"use client";
import { useState } from "react";
import Link from "next/link";
import {
  Workspace,
  Panel,
  Feedback,
  Pager,
  useLoad,
  stamp,
  type PageData,
} from "./shared";
export const actionLabels: Record<string, string> = {
  "auth.customer_login": "ورود مشتری",
  "auth.login": "ورود همکار",
  "auth.failed": "ورود ناموفق",
  "auth.logout": "خروج",
  "staff.create": "ایجاد همکار",
  "staff.update": "ویرایش دسترسی و مشخصات",
  "staff.archive": "بایگانی همکار",
  "staff.credentials": "بازیابی اطلاعات ورود",
  "product.draft": "ذخیره پیش‌نویس محصول",
  "product.publish": "انتشار محصول",
  "product.archive": "بایگانی محصول",
  "product.availability": "تغییر وضعیت فروش",
  "article.save": "ذخیره مقاله",
  "category.save": "ذخیره دسته‌بندی",
  "category.delete": "حذف دسته‌بندی",
  "pricing.adjust": "تغییر قیمت",
  "pricing.discount": "تغییر تخفیف",
  "discount.create": "ایجاد کد تخفیف",
  "discount.update": "تغییر کد تخفیف",
  "shipping.update": "تنظیم ارسال",
  "order.paid": "پرداخت موفق سفارش",
  "order.cancelled": "پرداخت ناموفق / لغو",
  "order.expired": "پایان مهلت پرداخت",
  "order.review": "سفارش نیازمند بررسی",
  "order.packing": "بسته‌بندی سفارش",
  "order.shipped": "ارسال سفارش",
  "order.received": "تحویل سفارش",
  "referral.signup": "عضویت با لینک معرفی",
  "commission.earned": "ثبت کمیسیون",
  "commission.refund": "اصلاح کمیسیون استرداد",
  "payment.recorded": "ثبت پرداخت همکار",
  "payment.reversed": "اصلاح پرداخت همکار",
  "export.requested": "درخواست خروجی اکسل",
  "export.ready": "آماده شدن خروجی اکسل",
};
export function EventsContent({ actor = "" }: { actor?: string }) {
  const [q, setQ] = useState(""),
    [action, setAction] = useState(""),
    [entity, setEntity] = useState(""),
    [staff, setStaff] = useState(actor),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [sort, setSort] = useState("newest"),
    [page, setPage] = useState(1);
  const params = new URLSearchParams({
    q,
    action,
    entity,
    actor: staff,
    from,
    to,
    sort,
    page: String(page),
  });
  const { data, error, loading } = useLoad<PageData>(
    "/omnisire/events?" + params,
  );
  return (
    <Panel title="تاریخچه رویدادها">
      <div className="omni-filters">
        <label>
          جستجو
          <input
            type="search"
            placeholder="نام همکار یا شناسه"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
          />
        </label>
        <label>
          نوع رویداد
          <select
            value={action}
            onChange={(e) => {
              setAction(e.target.value);
              setPage(1);
            }}
          >
            <option value="">همه رویدادها</option>
            {Object.entries(actionLabels).map(([a, l]) => (
              <option value={a} key={a}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label>
          از تاریخ
          <input
            type="date"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              setPage(1);
            }}
          />
        </label>
        <label>
          تا تاریخ
          <input
            type="date"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              setPage(1);
            }}
          />
        </label>
        <label>
          مرتب‌سازی
          <select
            value={sort}
            onChange={(e) => {
              setSort(e.target.value);
              setPage(1);
            }}
          >
            <option value="newest">جدیدترین</option>
            <option value="oldest">قدیمی‌ترین</option>
          </select>
        </label>
        <label>
          شناسه مورد
          <input
            value={entity}
            onChange={(e) => {
              setEntity(e.target.value);
              setPage(1);
            }}
          />
        </label>
        {!actor && (
          <label>
            شناسه همکار
            <input
              value={staff}
              onChange={(e) => {
                setStaff(e.target.value);
                setPage(1);
              }}
            />
          </label>
        )}
      </div>
      <Feedback error={error} loading={loading} />
      <div className="omni-event-list">
        {data?.items.map((e) => (
          <article key={String(e.id)} className="omni-event">
            <span className="omni-event-dot" />
            <div>
              <div className="between">
                <strong>
                  {actionLabels[String(e.action)] || String(e.action)}
                </strong>
                <time>{stamp(e.createdAt)}</time>
              </div>
              <p>
                {String(e.actorName || "سیستم")} ·{" "}
                <span dir="ltr">{String(e.entityId)}</span>
              </p>
              <details>
                <summary>جزئیات رویداد</summary>
                <pre dir="ltr">{JSON.stringify(e.detail, null, 2)}</pre>
                {String(e.action).startsWith("staff.") && (
                  <Link
                    className="text-link"
                    href={`/omnisire/members/${e.entityId}`}
                  >
                    پرونده همکار
                  </Link>
                )}
                {/^(order|product|inventory|article)\./.test(
                  String(e.action),
                ) && (
                  <Link
                    className="text-link"
                    href={
                      "/staff?" +
                      new URLSearchParams({
                        section: String(e.action).startsWith("order.")
                          ? "orders"
                          : String(e.action).startsWith("article.")
                            ? "articles"
                            : "products",
                        q: String(e.entityId),
                      })
                    }
                  >
                    مشاهده رکورد مرتبط
                  </Link>
                )}
                {Boolean(e.staffId) && (
                  <Link
                    className="text-link"
                    href={`/omnisire/members/${e.staffId}`}
                  >
                    مشاهده انجام‌دهنده
                  </Link>
                )}
              </details>
            </div>
          </article>
        ))}
        {data && !data.items.length && (
          <p className="omni-empty">رویدادی در این بازه پیدا نشد.</p>
        )}
      </div>
      <Pager data={data} page={page} onPage={setPage} />
    </Panel>
  );
}
export function EventsPage() {
  return (
    <Workspace owner title="رویدادها">
      <p className="omni-intro">
        تاریخچه تصمیم‌ها و فعالیت‌ها؛ هر تغییر با زمان و انجام‌دهنده مشخص.
      </p>
      <EventsContent />
    </Workspace>
  );
}
