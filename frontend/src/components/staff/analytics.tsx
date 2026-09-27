"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { money, fa, statuses } from "@/lib/format";
type Row = Record<string, string | number>;
type Report = Record<string, Row[]>;
const colors = [
  "#245c45",
  "#bd8332",
  "#77834a",
  "#467b97",
  "#9c5b61",
  "#64619b",
];
export function Analytics() {
  const [days, setDays] = useState("30"),
    [data, setData] = useState<Report | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setData(null);
    setError("");
    api<Report>("/staff/analytics?days=" + days)
      .then((v) => {
        if (active) setData(v);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [days]);
  const summary = data?.summary[0],
    sales = data?.sales || [],
    maximum = Math.max(1, ...sales.map((s) => Number(s.revenue))),
    categories = data?.categories || [],
    categoryTotal = categories.reduce((n, c) => n + Number(c.revenue), 0);
  let offset = 0;
  const gradient = categories
    .map((c, i) => {
      const start = offset;
      offset += (Number(c.revenue) / categoryTotal) * 100;
      return `${colors[i % colors.length]} ${start}% ${offset}%`;
    })
    .join(",");
  function table(key: string, columns: [string, string, boolean?][]) {
    const rows = data?.[key] || [];
    return rows.length ? (
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {columns.map(([k, title]) => (
                <th key={k}>{title}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {columns.map(([k, , currency]) => (
                  <td key={k}>
                    {currency
                      ? money(Number(r[k]))
                      : typeof r[k] === "number"
                        ? fa(Number(r[k]))
                        : String(r[k] || "—")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ) : (
      <p className="empty-chart">در این بازه هنوز داده‌ای ثبت نشده است.</p>
    );
  }
  return (
    <section className="analytics">
      <div className="between">
        <div>
          <span className="eyebrow">تصویر روشن از فروشگاه</span>
          <h2>تحلیل کسب‌وکار</h2>
        </div>
        <label>
          بازه زمانی
          <select value={days} onChange={(e) => setDays(e.target.value)}>
            <option value="7">۷ روز گذشته</option>
            <option value="30">۳۰ روز گذشته</option>
            <option value="90">۹۰ روز گذشته</option>
            <option value="365">یک سال گذشته</option>
          </select>
        </label>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {!data && !error ? (
        <p role="status">در حال محاسبه گزارش…</p>
      ) : (
        data && (
          <>
            <div className="metric-grid">
              {[
                ["فروش محصولات (تومان)", money(Number(summary?.revenue || 0))],
                ["سفارش‌های پرداخت‌شده", fa(Number(summary?.orders || 0))],
                ["میانگین سفارش (تومان)", money(Number(summary?.average || 0))],
                ["سفارش لغوشده یا منقضی", fa(Number(summary?.abandoned || 0))],
              ].map(([label, value]) => (
                <article className="metric" key={label}>
                  <span>{label}</span>
                  <strong>{value}</strong>
                </article>
              ))}
            </div>
            <div className="analytics-grid">
              <article className="form-card">
                <h3>روند فروش روزانه</h3>
                <p className="muted">
                  فروش محصولات پس از تخفیف، بدون هزینه ارسال · تومان
                </p>
                {sales.some((s) => Number(s.revenue) > 0) ? (
                  <>
                    <svg
                      className="sales-chart"
                      viewBox="0 0 640 200"
                      role="img"
                      aria-label="نمودار فروش روزانه"
                    >
                      <path d="M20 10 V180 H630" stroke="#d6dfd8" fill="none" />
                      <polyline
                        fill="none"
                        stroke="#245c45"
                        strokeWidth="3"
                        points={sales
                          .map(
                            (s, i) =>
                              `${20 + (i * 610) / Math.max(sales.length - 1, 1)},${180 - (Number(s.revenue) / maximum) * 160}`,
                          )
                          .join(" ")}
                      />
                      {sales.map((s, i) => (
                        <circle
                          key={i}
                          cx={20 + (i * 610) / Math.max(sales.length - 1, 1)}
                          cy={180 - (Number(s.revenue) / maximum) * 160}
                          r="3"
                          fill="#245c45"
                        >
                          <title>
                            {s.day}: {money(Number(s.revenue))} تومان
                          </title>
                        </circle>
                      ))}
                    </svg>
                    <div className="between muted">
                      <span>{sales[0]?.day}</span>
                      <span>{sales.at(-1)?.day}</span>
                    </div>
                  </>
                ) : (
                  <p className="empty-chart">
                    پس از اولین خرید، روند فروش اینجا نمایش داده می‌شود.
                  </p>
                )}
                <details>
                  <summary>جدول روزانه</summary>
                  {table("sales", [
                    ["day", "روز"],
                    ["orders", "سفارش"],
                    ["revenue", "فروش (تومان)", true],
                  ])}
                </details>
              </article>
              <article className="form-card">
                <h3>سهم دسته‌بندی‌ها از فروش</h3>
                {categoryTotal > 0 ? (
                  <>
                    <div
                      className="donut-chart"
                      role="img"
                      aria-label="سهم فروش دسته‌بندی‌ها"
                      style={{ background: `conic-gradient(${gradient})` }}
                    >
                      <span>
                        {fa(categories.length)}
                        <small>دسته</small>
                      </span>
                    </div>
                    <ul className="chart-legend">
                      {categories.map((c, i) => (
                        <li key={i}>
                          <i
                            style={{ background: colors[i % colors.length] }}
                          />
                          {c.name}
                          <strong>
                            {fa(
                              Math.round(
                                (Number(c.revenue) / categoryTotal) * 100,
                              ),
                            )}
                            ٪
                          </strong>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p className="empty-chart">
                    هنوز فروشی در این بازه ثبت نشده است.
                  </p>
                )}
              </article>
            </div>
            <article className="form-card">
              <h3>محصولات محبوب و پرفروش</h3>
              <p className="muted">
                بازدید صفحه محصول؛ بازدید تکراری هر کاربر در ۳۰ دقیقه یک بار
                شمرده می‌شود.
              </p>
              {table("products", [
                ["name", "محصول"],
                ["views", "بازدید"],
                ["quantity", "بسته فروخته‌شده"],
                ["revenue", "فروش (تومان)", true],
              ])}
            </article>
            <div className="analytics-grid">
              <article className="form-card">
                <h3>مشتریان برتر</h3>
                {table("customers", [
                  ["name", "مشتری"],
                  ["phone", "همراه"],
                  ["orders", "سفارش"],
                  ["revenue", "خرید (تومان)", true],
                ])}
              </article>
              <article className="form-card">
                <h3>عبارت‌های جستجوشده</h3>
                {table("searches", [
                  ["query", "عبارت"],
                  ["searches", "تعداد جستجو"],
                ])}
              </article>
            </div>
            <div className="analytics-grid">
              <article className="form-card">
                <h3>وضعیت سفارش‌ها</h3>
                {(data.fulfillment || []).map((r) => (
                  <div className="summary-line" key={r.status}>
                    <span>{statuses[r.status] || r.status}</span>
                    <strong>{fa(Number(r.orders))}</strong>
                  </div>
                ))}
              </article>
              <article className="form-card">
                <h3>پیامک‌های سفارش</h3>
                {(data.notifications || []).map((r) => (
                  <div className="summary-line" key={r.status}>
                    <span>
                      {{
                        pending: "در صف ارسال",
                        sent: "ارسال به سرویس پیامک",
                        failed: "نیازمند پیگیری",
                      }[r.status] || r.status}
                    </span>
                    <strong>{fa(Number(r.messages))}</strong>
                  </div>
                ))}
                <p className="muted">
                  پیامک‌های ناموفق به‌صورت خودکار دوباره تلاش می‌شوند.
                </p>
              </article>
            </div>
          </>
        )
      )}
    </section>
  );
}
