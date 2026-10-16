"use client";
import { Check, Plus, ChartNoAxesCombined } from "lucide-react";
import { fa, money } from "@/lib/format";
import type { ChartData, ChartRow } from "./charts";
import type { ReportSection, Selection } from "./analytics-model";
export function AnalyticsSummary({
  data,
  section,
  customer,
}: {
  data: ChartData;
  section: ReportSection;
  customer: string;
}) {
  const s = customer
    ? data.points.reduce<Record<string, number>>(
        (sum, p) => ({
          revenue: sum.revenue + Number(p.revenue || 0),
          orders: sum.orders + Number(p.orders || 0),
        }),
        { revenue: 0, orders: 0 },
      )
    : data.summary;
  const item = (
    label: string,
    value: number,
    hint: string,
    monetary = false,
  ) => ({ label, value, hint, monetary });
  const sales = item(
    "فروش خالص کالا",
    s.revenue,
    "پس از تخفیف · بدون ارسال",
    true,
  );
  const orders = item("سفارش پرداخت‌شده", s.orders, "در بازه انتخاب‌شده");
  const average = item(
    "میانگین مبلغ سفارش",
    s.orders ? s.revenue / s.orders : 0,
    "فروش خالص ÷ تعداد سفارش",
    true,
  );
  const count = s.entityCount || 0,
    active = s.activeCount || 0;
  const items =
    section === "overview" || customer
      ? [sales, orders, average]
      : section === "prices"
        ? [
            item("تغییر قیمت و تخفیف", s.changes, "بدون ثبت‌های اولیه"),
            item("بسته‌های تغییرکرده", active, "حداقل یک تغییر در بازه"),
            item("بسته‌های دارای سابقه", count, "تا پایان بازه انتخاب‌شده"),
          ]
        : section === "searches"
          ? [
              item("جستجوی ثبت‌شده", s.orders, "با محدودیت تکرار ۳۰ دقیقه‌ای"),
              item("عبارت متفاوت", count, "در بازه انتخاب‌شده"),
              item(
                "میانگین روزانه",
                s.orders / data.days.length,
                "شامل روزهای بدون جستجو",
              ),
            ]
          : section === "customers"
            ? [
                sales,
                item("مشتری خریدار", active, `از ${fa(count)} مشتری ثبت‌شده`),
                average,
              ]
            : [
                sales,
                item("بسته فروخته‌شده", s.quantity, "تعداد بسته، مستقل از وزن"),
                item(
                  section === "products"
                    ? "محصول بدون فروش"
                    : section === "categories"
                      ? "دسته بدون فروش"
                      : "بسته دارای فروش",
                  section === "packages" ? active : count - active,
                  section === "packages"
                    ? "در بازه انتخاب‌شده"
                    : `از ${fa(count)} مورد`,
                ),
              ];
  return (
    <div className="analytics-summary" aria-label="خلاصه بازه">
      {items.map((x, i) => (
        <article key={x.label} className={i === 0 ? "primary" : ""}>
          <span>{x.label}</span>
          <strong>
            {x.monetary
              ? money(Math.round(x.value || 0))
              : fa(Math.round((x.value || 0) * 10) / 10)}
            {x.monetary && <small>تومان</small>}
          </strong>
          <p>{x.hint}</p>
        </article>
      ))}
    </div>
  );
}
export function Ranking({
  data,
  metric,
  label,
  onSelect,
  selected,
}: {
  data: ChartData;
  metric: string;
  label: string;
  onSelect: (row: Selection) => void;
  selected: Selection[];
}) {
  const key = metric === "price" ? "changes" : metric;
  const total = data.summary[key] || 0;
  const rows = data.totals.filter((row) => Number(row[key]) > 0);
  const shown = rows.reduce((n, row) => n + Number(row[key]), 0);
  const monetary = key === "revenue";
  return (
    <section className="analytics-ranking" aria-label="رتبه‌بندی">
      <div className="analytics-card-heading">
        <div>
          <span className="analytics-eyebrow">در کل بازه</span>
          <h2>
            {key === "changes" ? "بیشترین تغییر قیمت" : "بالاترین " + label}
          </h2>
        </div>
        <ChartNoAxesCombined size={20} />
      </div>
      <p className="omni-help">
        حداکثر ۸ مورد · سهم از کل {key === "changes" ? "تغییرات" : label}
      </p>
      {!rows.length ? (
        <div className="analytics-no-data">
          برای این شاخص، فعالیتی در بازه ثبت نشده است.
        </div>
      ) : (
        <ol className="analytics-ranks">
          {rows.map((row, i) => {
            const chosen = selected.some((s) => s.id === row.id),
              share = total ? (Number(row[key]) / total) * 100 : 0;
            return (
              <li key={row.id}>
                <button
                  disabled={selected.length >= 5 && !chosen}
                  aria-pressed={chosen}
                  aria-label={`${chosen ? "حذف" : "مقایسه"} ${row.name}`}
                  onClick={() => onSelect({ id: row.id, name: row.name })}
                >
                  <span className="analytics-rank-index">{fa(i + 1)}</span>
                  <span className="analytics-rank-content">
                    <span>
                      <b>{row.name}</b>
                      <small>{fa(Math.round(share * 10) / 10)}٪</small>
                    </span>
                    <span className="analytics-bar">
                      <i style={{ width: `${share}%` }} />
                    </span>
                    <span className="analytics-rank-value">
                      {monetary
                        ? money(Number(row[key])) + " تومان"
                        : fa(Number(row[key]))}
                    </span>
                  </span>
                  {chosen ? <Check size={15} /> : <Plus size={15} />}
                </button>
              </li>
            );
          })}
        </ol>
      )}
      {total > shown && (
        <div className="analytics-other">
          <span>سایر موارد</span>
          <b>{fa(Math.round(((total - shown) / total) * 1000) / 10)}٪</b>
          <small>
            {monetary ? money(total - shown) + " تومان" : fa(total - shown)}
          </small>
        </div>
      )}
      <p className="omni-help">
        انتخاب هر مورد، آن را به مقایسه روند اضافه می‌کند.
      </p>
    </section>
  );
}
export function comparisonRow(
  row: Record<string, unknown>,
  section: ReportSection,
): Selection {
  return {
    id: String(section === "prices" ? row.comparisonId : row.id),
    name: String(row.name || row.id),
  };
}
export function chartRows(data: ChartData, metric: string): ChartRow[] {
  const names = new Map(data.points.map((p) => [p.id, p.name]));
  const points = new Map(
    data.points.map((p) => [JSON.stringify([p.id, p.day]), p]),
  );
  return data.days.flatMap((day) =>
    [...names].map(
      ([id, name]) =>
        points.get(JSON.stringify([id, day])) || {
          id,
          name,
          day,
          [metric]: metric === "price" ? null : 0,
        },
    ),
  );
}
