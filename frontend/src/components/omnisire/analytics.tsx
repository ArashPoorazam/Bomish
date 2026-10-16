"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, Info, SlidersHorizontal, X } from "lucide-react";
import { fa } from "@/lib/format";
import { Workspace, useLoad, type PageData } from "./shared";
import { LineChart, dayLabel, type ChartData } from "./charts";
import {
  reports,
  initialFilters,
  filtersQuery,
  type Filters,
  type ReportSection,
  type Selection,
} from "./analytics-model";
import { AnalyticsSummary, Ranking } from "./analytics-insights";
import { DateControls, ExportReport } from "./analytics-controls";
import { ReportTable, ChartTable } from "./analytics-table";
function readLocation() {
  const p = new URLSearchParams(window.location.search);
  return { ...Object.fromEntries(p), id: p.getAll("id") };
}
export function AnalyticsPage({
  initialParams = {},
}: {
  initialParams?: Record<string, string | string[] | undefined>;
}) {
  const [filters, setFilters] = useState(() => initialFilters(initialParams));
  const [revision, setRevision] = useState(0);
  const [debouncedQuery, setDebouncedQuery] = useState(filters.q);
  const [selectionNotice, setSelectionNotice] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(filters.q), 350);
    return () => clearTimeout(timer);
  }, [filters.q]);
  const report = reports[filters.section];
  const metric = report.metrics.some(([key]) => key === filters.metric)
    ? filters.metric
    : report.metrics[0][0];
  const metricLabel = report.metrics.find(([key]) => key === metric)![1];
  const urlQuery = filtersQuery(filters).toString();
  const previousQuery = useRef(urlQuery);
  useEffect(() => {
    // Initial URL already came from the server; only persist user changes.
    if (previousQuery.current === urlQuery) return;
    previousQuery.current = urlQuery;
    window.history.replaceState(null, "", `/omnisire/analytics?${urlQuery}`);
  }, [urlQuery]);
  useEffect(() => {
    const restore = () => setFilters(initialFilters(readLocation()));
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);
  const tableParams = new URLSearchParams({
    section: filters.customer ? "customer-orders" : filters.section,
    from: filters.from,
    to: filters.to,
    q: debouncedQuery,
    sort: filters.sort,
    direction: filters.direction,
    page: String(filters.page),
    pageSize: String(filters.pageSize),
    customer: filters.customer,
  });
  const chartParams = new URLSearchParams({
    section: filters.section,
    from: filters.from,
    to: filters.to,
    metric,
  });
  (filters.customer
    ? [filters.customer]
    : filters.selected.map((s) => s.id)
  ).forEach((id) => chartParams.append("id", id));
  const result = useLoad<PageData>(
    "/omnisire/analytics?" + tableParams,
    revision,
  );
  const chart = useLoad<ChartData>(
    "/omnisire/analytics/charts?" + chartParams,
    revision,
  );
  function update(patch: Partial<Filters>) {
    setFilters((f) => ({ ...f, ...patch }));
  }
  function changeSection(section: string) {
    if (!Object.hasOwn(reports, section)) return;
    setFilters((f) => ({
      ...f,
      section: section as ReportSection,
      q: "",
      sort: "",
      page: 1,
      metric: "",
      customer: "",
      customerName: "",
      selected: [],
    }));
    setDebouncedQuery("");
    setSelectionNotice("");
  }
  function toggle(row: Selection) {
    setSelectionNotice("");
    setFilters((f) => ({
      ...f,
      selected: f.selected.some((s) => s.id === row.id)
        ? f.selected.filter((s) => s.id !== row.id)
        : f.selected.length < 5
          ? [...f.selected, row]
          : f.selected,
    }));
    if (
      filters.selected.length >= 5 &&
      !filters.selected.some((s) => s.id === row.id)
    )
      setSelectionNotice(
        "برای خوانایی نمودار، حداکثر ۵ مورد را مقایسه کنید. ابتدا یکی از انتخاب‌ها را حذف کنید.",
      );
  }
  const data = chart.data;
  const isOverview = filters.section === "overview";
  return (
    <Workspace
      owner
      title={
        filters.customer
          ? `خریدهای ${filters.customerName || "مشتری"}`
          : report.title
      }
      description={
        filters.customer
          ? "سفارش‌های پرداخت‌شده این مشتری در بازه انتخاب‌شده"
          : report.description
      }
      activeSection={filters.section}
      onSectionChange={changeSection}
      titleDetail={<span className="analytics-heading-tag">تحلیل داده‌ها</span>}
    >
      <div className="analytics-workspace">
        {filters.customer && (
          <button
            className="text-link analytics-back"
            onClick={() =>
              update({
                customer: "",
                customerName: "",
                q: "",
                sort: "",
                page: 1,
              })
            }
          >
            <ArrowRight size={16} />
            بازگشت به مشتریان
          </button>
        )}
        <DateControls
          key={filters.from + filters.to}
          from={filters.from}
          to={filters.to}
          onApply={(from, to) => update({ from, to, page: 1 })}
          onRefresh={() => setRevision((n) => n + 1)}
        />
        <div className="analytics-scope">
          <span>
            <i /> {dayLabel(filters.from)} تا {dayLabel(filters.to)} ·{" "}
            {fa(
              Math.round(
                (Date.parse(filters.to) - Date.parse(filters.from)) / 86400000,
              ) + 1,
            )}{" "}
            روز
          </span>
          <span>
            {filters.customer
              ? "خلاصه خرید همین مشتری"
              : "خلاصه کل بازه · مستقل از جستجوی جدول"}
          </span>
        </div>
        {chart.error ? (
          <div className="analytics-no-data" role="alert">
            <p>{chart.error}</p>
            <button
              className="button secondary"
              onClick={() => setRevision((n) => n + 1)}
            >
              تلاش دوباره نمودار
            </button>
          </div>
        ) : chart.loading ? (
          <div className="analytics-summary-skeleton" role="status">
            <span>در حال محاسبه گزارش…</span>
            <i />
            <i />
            <i />
          </div>
        ) : (
          data && (
            <AnalyticsSummary
              data={data}
              section={filters.section}
              customer={filters.customer}
            />
          )
        )}
        <div className="analytics-analysis-heading">
          <div>
            <span className="analytics-eyebrow">از عدد به تصمیم</span>
            <h2>
              {isOverview
                ? "مسیر فروش در طول زمان"
                : filters.section === "prices"
                  ? "چه زمانی قیمت تغییر کرد؟"
                  : "روند و سهم در یک نگاه"}
            </h2>
          </div>
          <label className="analytics-metric">
            <SlidersHorizontal size={16} />
            <span>شاخص نمودار</span>
            <select
              aria-label="شاخص نمودار"
              value={metric}
              onChange={(e) => update({ metric: e.target.value })}
            >
              {report.metrics.map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div
          className={`analytics-analysis-grid ${isOverview || filters.customer ? "single" : ""}`}
        >
          <section className="analytics-trend">
            <div className="analytics-card-heading">
              <div>
                <h2>
                  {filters.section === "prices"
                    ? "روند قیمت پایان روز"
                    : "روند روزانه"}
                </h2>
                <p className="omni-help">
                  {isOverview
                    ? "مجموع فروشگاه در هر روز"
                    : filters.customer
                      ? "سفارش‌ها و خریدهای این مشتری"
                      : filters.selected.length
                        ? `${fa(filters.selected.length)} مورد انتخاب‌شده · مستقل از جستجوی جدول`
                        : `۵ مورد اول بر اساس ${filters.section === "prices" ? "تعداد تغییر قیمت" : metricLabel}`}
                </p>
              </div>
              <span className="analytics-count">
                {filters.section === "prices" ? "تومان / بسته" : "روزانه"}
              </span>
            </div>
            {!isOverview && !filters.customer && (
              <div className="analytics-comparison">
                <div>
                  <span>مقایسه {fa(filters.selected.length)} از ۵</span>
                  {filters.selected.length > 0 && (
                    <button
                      className="text-link"
                      onClick={() => update({ selected: [] })}
                    >
                      بازگشت به موارد برتر
                    </button>
                  )}
                </div>
                {filters.selected.length > 0 ? (
                  <div className="analytics-chips">
                    {filters.selected.map((s) => (
                      <button
                        key={s.id}
                        onClick={() => toggle(s)}
                        aria-label={`حذف ${s.name}`}
                      >
                        <span>
                          {data?.points.find((p) => p.id === s.id)?.name ||
                            s.name}
                        </span>
                        <X size={13} />
                      </button>
                    ))}
                  </div>
                ) : (
                  <p>
                    برای ساخت مقایسه، موارد دلخواه را از رتبه‌بندی یا جدول پایین
                    انتخاب کنید.
                  </p>
                )}
                {filters.selected.length === 5 && (
                  <p role="status">
                    ظرفیت مقایسه تکمیل است؛ برای افزودن مورد جدید، یکی را حذف
                    کنید.
                  </p>
                )}
              </div>
            )}
            {selectionNotice && <p role="status">{selectionNotice}</p>}
            {chart.loading ? (
              <div className="analytics-chart-loading" role="status">
                در حال آماده‌سازی نمودار…
              </div>
            ) : (
              data && (
                <>
                  <LineChart
                    key={filters.section + metric + chartParams}
                    data={data}
                    metric={metric}
                    label={metricLabel}
                    monetary={["revenue", "price"].includes(metric)}
                  />
                  <ChartTable
                    key={chartParams.toString()}
                    data={data}
                    metric={metric}
                    label={metricLabel}
                  />
                </>
              )
            )}
          </section>
          {!isOverview && !filters.customer && !chart.loading && data && (
            <Ranking
              data={data}
              metric={metric}
              label={metricLabel}
              selected={filters.selected}
              onSelect={toggle}
            />
          )}
        </div>
        <details className="analytics-definition">
          <summary>
            <Info size={16} />
            تعریف شاخص‌ها و روش خواندن این گزارش
          </summary>
          <p>{report.note}</p>
          {filters.section !== "overview" && (
            <p>
              انتخاب‌های مقایسه فقط نمودار روند را تغییر می‌دهند. خلاصه و سهم
              رتبه‌بندی همیشه از تمام داده‌های بازه محاسبه می‌شوند؛ «سایر موارد»
              سهم خارج از هشت رتبه اول است.
            </p>
          )}
        </details>
        <div className="analytics-export-row">
          <p>جزئیات قابل جستجو و دریافت</p>
          <ExportReport
            filters={tableParams.toString()}
            disabled={
              result.loading ||
              !!result.error ||
              !result.data?.total ||
              debouncedQuery !== filters.q
            }
          />
        </div>
        <ReportTable
          data={result.data}
          filters={filters}
          pending={result.loading || debouncedQuery !== filters.q}
          error={result.error}
          onChange={update}
          onSelect={toggle}
          onCustomer={(row) => {
            setDebouncedQuery("");
            update({
              customer: String(row.id),
              customerName: String(row.name),
              q: "",
              sort: "",
              page: 1,
            });
          }}
          onRetry={() => setRevision((n) => n + 1)}
        />
      </div>
    </Workspace>
  );
}
