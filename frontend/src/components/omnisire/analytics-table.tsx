"use client";
import { useState } from "react";
import { ArrowDown, ArrowUp, Search, X } from "lucide-react";
import { fa } from "@/lib/format";
import { DataTable, Pager, valueText, type PageData, type Row } from "./shared";
import { type Filters, type Selection, reports } from "./analytics-model";
import { comparisonRow, chartRows } from "./analytics-insights";
import { dayLabel, type ChartData } from "./charts";
export function ReportTable({
  data,
  filters,
  pending,
  error,
  onChange,
  onSelect,
  onCustomer,
  onRetry,
}: {
  data: PageData | null;
  filters: Filters;
  pending: boolean;
  error: string;
  onChange: (patch: Partial<Filters>) => void;
  onSelect: (row: Selection) => void;
  onCustomer: (row: Row) => void;
  onRetry: () => void;
}) {
  const report = reports[filters.section];
  const activeSort =
    filters.sort ||
    (filters.customer || filters.section === "prices"
      ? "createdAt"
      : filters.section === "overview"
        ? "name"
        : filters.section === "searches"
          ? "searches"
          : "revenue");
  const activeDirection = filters.sort ? filters.direction : "desc";
  return (
    <section
      className="omni-panel analytics-table-panel"
      id="analytics-details"
    >
      <div className="analytics-card-heading">
        <div>
          <span className="analytics-eyebrow">بررسی جزئیات</span>
          <h2>
            {filters.customer
              ? "سفارش‌های مشتری"
              : filters.section === "prices"
                ? "رویدادهای قیمت و تخفیف"
                : "داده‌های گزارش"}
          </h2>
        </div>
        {data && (
          <span className="analytics-count">{fa(data.total)} نتیجه</span>
        )}
      </div>
      <div className="analytics-table-tools">
        <label className="analytics-search">
          <span>جستجو در جدول</span>
          <span>
            <Search size={17} />
            <input
              type="search"
              maxLength={120}
              value={filters.q}
              placeholder={
                filters.customer ? "شناسه سفارش یا نام محصول" : report.search
              }
              onChange={(e) => onChange({ q: e.target.value, page: 1 })}
            />
            {filters.q && (
              <button
                aria-label="پاک کردن جستجو"
                onClick={() => onChange({ q: "", page: 1 })}
              >
                <X size={15} />
              </button>
            )}
          </span>
        </label>
        <label>
          تعداد در صفحه
          <select
            value={filters.pageSize}
            onChange={(e) =>
              onChange({ pageSize: Number(e.target.value), page: 1 })
            }
          >
            {[25, 50, 100].map((n) => (
              <option key={n} value={n}>
                {fa(n)} ردیف
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="omni-help">
        جستجو فقط جدول و فایل اکسل را فیلتر می‌کند؛ خلاصه و رتبه‌بندی، کل بازه
        را نشان می‌دهند. برای مرتب‌سازی، عنوان ستون را انتخاب کنید.
      </p>
      {error ? (
        <div className="analytics-no-data" role="alert">
          <p>{error}</p>
          <button className="button secondary" onClick={onRetry}>
            تلاش دوباره
          </button>
        </div>
      ) : pending ? (
        <div className="analytics-table-loading" role="status">
          در حال دریافت ردیف‌ها…
        </div>
      ) : data && !data.items.length ? (
        <div className="analytics-no-data">
          <Search size={26} />
          <h3>
            {filters.q
              ? "نتیجه‌ای برای این جستجو پیدا نشد"
              : "داده‌ای در این بازه ثبت نشده است"}
          </h3>
          <p>
            {filters.q
              ? "عبارت کوتاه‌تر یا نام دیگری را امتحان کنید."
              : "بازه زمانی دیگری را انتخاب کنید. نبود داده به معنی خطای گزارش نیست."}
          </p>
          {filters.q && (
            <button
              className="button secondary"
              onClick={() => onChange({ q: "", page: 1 })}
            >
              پاک کردن جستجو
            </button>
          )}
          {data.total > 0 && (
            <button
              className="button secondary"
              onClick={() => onChange({ page: 1 })}
            >
              رفتن به صفحه اول
            </button>
          )}
        </div>
      ) : (
        data && (
          <>
            <div
              className="table-scroll omni-table"
              tabIndex={0}
              role="region"
              aria-label="جدول گزارش؛ برای دیدن ستون‌های بیشتر حرکت کنید"
            >
              <table>
                <thead>
                  <tr>
                    {filters.section !== "overview" && !filters.customer && (
                      <th scope="col">مقایسه</th>
                    )}
                    {data.columns?.map((c) => (
                      <th
                        key={c.key}
                        scope="col"
                        aria-sort={
                          activeSort === c.key
                            ? activeDirection === "asc"
                              ? "ascending"
                              : "descending"
                            : "none"
                        }
                      >
                        <button
                          className="analytics-sort"
                          onClick={() =>
                            onChange({
                              sort: c.key,
                              direction:
                                activeSort === c.key &&
                                activeDirection === "desc"
                                  ? "asc"
                                  : "desc",
                              page: 1,
                            })
                          }
                        >
                          {c.label}
                          {activeSort === c.key &&
                            (activeDirection === "asc" ? (
                              <ArrowUp size={13} />
                            ) : (
                              <ArrowDown size={13} />
                            ))}
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((row, i) => {
                    const selection = comparisonRow(row, filters.section),
                      checked = filters.selected.some(
                        (s) => s.id === selection.id,
                      );
                    return (
                      <tr
                        key={String(row.id ?? i)}
                        data-selected={checked || undefined}
                      >
                        {filters.section !== "overview" &&
                          !filters.customer && (
                            <td>
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={
                                  !checked && filters.selected.length >= 5
                                }
                                aria-label={`انتخاب ${selection.name}`}
                                onChange={() => onSelect(selection)}
                              />
                            </td>
                          )}
                        {data.columns?.map((c, index) => (
                          <td key={c.key}>
                            {filters.section === "customers" &&
                            !filters.customer &&
                            index === 0 ? (
                              <button
                                className="text-link"
                                onClick={() => onCustomer(row)}
                              >
                                {valueText(row[c.key], c)}
                              </button>
                            ) : filters.section === "overview" &&
                              c.key === "name" ? (
                              dayLabel(String(row[c.key]))
                            ) : (
                              valueText(row[c.key], c)
                            )}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pager
              data={data}
              page={filters.page}
              onPage={(page) => onChange({ page })}
            />
          </>
        )
      )}
    </section>
  );
}
export function ChartTable({
  data,
  metric,
  label,
}: {
  data: ChartData;
  metric: string;
  label: string;
}) {
  const [page, setPage] = useState(1);
  const rows = chartRows(data, metric);
  return (
    <details className="chart-data-table">
      <summary>مشاهده داده‌های نمودار به صورت جدول</summary>
      <DataTable
        data={rows
          .slice((page - 1) * 25, page * 25)
          .map((r) => ({ ...r, day: dayLabel(r.day!) }))}
        columns={[
          { key: "name", label: "مورد", kind: "text" },
          { key: "day", label: "روز", kind: "text" },
          {
            key: metric,
            label:
              label + (["price", "revenue"].includes(metric) ? " (تومان)" : ""),
            kind: ["price", "revenue"].includes(metric) ? "money" : "number",
          },
        ]}
      />
      <Pager
        data={{ items: [], total: rows.length, pageSize: 25, page }}
        page={page}
        onPage={setPage}
      />
    </details>
  );
}
