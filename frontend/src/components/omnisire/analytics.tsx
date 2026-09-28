"use client";
import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { api } from "@/lib/api";
import { fa } from "@/lib/format";
import {
  Workspace,
  Panel,
  Feedback,
  Pager,
  DataTable,
  useLoad,
  reportSections,
  type PageData,
} from "./shared";
import { LineChart, PieChart, type ChartData } from "./charts";
function isoDay(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tehran",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
const metrics: Record<string, [string, string][]> = {
  overview: [
    ["revenue", "فروش خالص (تومان)"],
    ["orders", "تعداد سفارش"],
  ],
  products: [
    ["quantity", "تعداد بسته فروخته‌شده"],
    ["clicks", "کلیک"],
    ["views", "بازدید"],
    ["revenue", "فروش خالص (تومان)"],
  ],
  packages: [
    ["quantity", "تعداد بسته فروخته‌شده"],
    ["revenue", "فروش خالص (تومان)"],
  ],
  prices: [["price", "قیمت بسته پس از تخفیف (تومان)"]],
  customers: [
    ["revenue", "خرید (تومان)"],
    ["orders", "تعداد سفارش"],
  ],
  categories: [
    ["quantity", "تعداد بسته فروخته‌شده"],
    ["clicks", "کلیک"],
    ["revenue", "فروش خالص (تومان)"],
  ],
  searches: [["orders", "تعداد جستجو"]],
};
type ExportJob = {
  id: string;
  status: string;
  progress: number;
  error?: string;
};
export function AnalyticsPage({
  initialSection = "overview",
}: {
  initialSection?: string;
}) {
  const [section, setSection] = useState(
    reportSections.some(([key]) => key === initialSection)
      ? initialSection
      : "overview",
  );
  const [from, setFrom] = useState(() =>
      isoDay(new Date(Date.now() - 6 * 86400000)),
    ),
    [to, setTo] = useState(() => isoDay(new Date()));
  const [q, setQ] = useState(""),
    [sort, setSort] = useState(""),
    [direction, setDirection] = useState("desc"),
    [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]),
    [metric, setMetric] = useState(""),
    [customer, setCustomer] = useState("");
  const [exportJob, setExportJob] = useState<ExportJob | null>(null),
    [error, setError] = useState(""),
    [exportBusy, setExportBusy] = useState(false);
  const chartSection = section === "customer-orders" ? "customers" : section;
  const choices = metrics[chartSection];
  const activeMetric = choices.some(([key]) => key === metric)
    ? metric
    : choices[0][0];
  const params = new URLSearchParams({
    section,
    from,
    to,
    q,
    sort,
    direction,
    page: String(page),
    customer,
  });
  const result = useLoad<PageData>("/omnisire/analytics?" + params);
  const chartParams = new URLSearchParams({
    section: chartSection,
    from,
    to,
    q,
    ids: customer || selected.join(","),
  });
  const chart = useLoad<ChartData>("/omnisire/analytics/charts?" + chartParams);
  useEffect(() => {
    if (!exportJob || ["ready", "failed"].includes(exportJob.status)) return;
    let live = true;
    const timer = setInterval(() => {
      api<ExportJob>(`/omnisire/exports/${exportJob.id}`)
        .then((v) => {
          if (live) setExportJob(v);
        })
        .catch((e) => {
          if (live) setError(e.message);
        });
    }, 2000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [exportJob?.id, exportJob?.status]);
  function changeSection(key: string) {
    setSection(key);
    setPage(1);
    setSelected([]);
    setSort("");
    setQ("");
    setCustomer("");
    setMetric("");
    setError("");
    window.history.replaceState(null, "", `/omnisire/analytics?section=${key}`);
  }
  function toggle(id: string) {
    setSelected((prev) =>
      prev.includes(id)
        ? prev.filter((x) => x !== id)
        : prev.length < 12
          ? [...prev, id]
          : prev,
    );
  }
  async function download() {
    setError("");
    setExportBusy(true);
    try {
      const filters = Object.fromEntries(params);
      delete filters.page;
      const job = await api<{ id: string }>(
        "/omnisire/exports",
        "POST",
        filters,
      );
      setExportJob({ ...job, status: "pending", progress: 0 });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setExportBusy(false);
    }
  }
  const label =
    reportSections.find(([key]) => key === section)?.[1] || "خریدهای مشتری";
  const data = chart.data;
  return (
    <Workspace
      owner
      title={label}
      activeSection={chartSection}
      onSectionChange={changeSection}
    >
      <Panel
        title="بازه گزارش"
        action={
          <button
            className="button secondary"
            disabled={exportBusy || !from || !to || from > to}
            onClick={() => void download()}
          >
            <Download size={17} />
            دریافت اکسل
          </button>
        }
      >
        <div className="omni-filters">
          <label>
            از تاریخ
            <input
              type="date"
              value={from}
              max={to}
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
              min={from}
              onChange={(e) => {
                setTo(e.target.value);
                setPage(1);
              }}
            />
          </label>
          <label>
            جستجو در گزارش
            <input
              type="search"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
              placeholder="نام یا مشخصات"
            />
          </label>
          <button
            className="button secondary"
            onClick={() => {
              setFrom(isoDay(new Date(Date.now() - 6 * 86400000)));
              setTo(isoDay(new Date()));
              setPage(1);
            }}
          >
            هفته اخیر
          </button>
        </div>
        <p className="omni-help">
          روزها بر اساس زمان تهران محاسبه می‌شوند. فروش خالص پس از تخفیف‌ها و
          بدون هزینه ارسال است.
        </p>
        <Feedback error={error} />
        {exportJob && (
          <div className="notice" role="status">
            {exportJob.status === "ready" ? (
              <a
                className="text-link"
                href={`/api/v1/omnisire/exports/${exportJob.id}/download`}
              >
                دانلود فایل اکسل
              </a>
            ) : exportJob.status === "failed" ? (
              <span>
                {exportJob.error || "خروجی آماده نشد؛ دوباره تلاش کنید."}
              </span>
            ) : (
              <>
                در حال آماده‌سازی اکسل · {fa(exportJob.progress)}٪{" "}
                <progress max={100} value={exportJob.progress} />
              </>
            )}
          </div>
        )}
      </Panel>
      <Panel
        title={section === "prices" ? "روند قیمت بسته‌ها" : "روند روزانه"}
        action={
          <label className="omni-metric">
            شاخص نمودار
            <select
              value={activeMetric}
              onChange={(e) => setMetric(e.target.value)}
            >
              {choices.map(([key, text]) => (
                <option key={key} value={key}>
                  {text}
                </option>
              ))}
            </select>
          </label>
        }
      >
        <Feedback error={chart.error} loading={chart.loading} />
        {!chart.loading && !chart.error && data && (
          <>
            {chartSection !== "overview" && section !== "customer-orders" && (
              <details
                className="chart-selection"
                open={selected.length > 0 || undefined}
              >
                <summary>
                  انتخاب برای مقایسه{" "}
                  {selected.length ? `(${fa(selected.length)})` : ""}
                </summary>
                <p className="omni-help">
                  حداکثر ۱۲ مورد. بدون انتخاب،{" "}
                  {section === "prices"
                    ? "قیمت بسته‌های سه محصول اول"
                    : "پنج مورد اول"}{" "}
                  نمایش داده می‌شود. نمودارهای سهم، کل نتایج این بازه را نشان
                  می‌دهند.
                </p>
                <div className="chart-options">
                  {data.totals.map((row) => (
                    <label key={row.id} className="check-label">
                      <input
                        type="checkbox"
                        checked={selected.includes(row.id)}
                        disabled={
                          selected.length >= 12 && !selected.includes(row.id)
                        }
                        onChange={() => toggle(row.id)}
                      />
                      {row.name}
                    </label>
                  ))}
                </div>
                {selected.length > 0 && (
                  <button className="text-link" onClick={() => setSelected([])}>
                    پاک کردن انتخاب‌ها
                  </button>
                )}
              </details>
            )}
            {section === "prices" && (
              <p className="omni-help">
                قیمت پایان هر روز پس از تخفیف. آخرین قیمت ثبت‌شده ادامه می‌یابد؛
                روزهای پیش از اولین ثبت، داده ندارند.
              </p>
            )}
            <LineChart
              key={section + activeMetric + from + to + selected.join(",")}
              data={data}
              metric={activeMetric}
              label={choices.find(([key]) => key === activeMetric)![1]}
              monetary={["revenue", "price"].includes(activeMetric)}
            />
            <details className="chart-data-table">
              <summary>جدول داده‌های نمودار</summary>
              <DataTable
                data={data.points}
                columns={[
                  { key: "name", label: "مورد", kind: "text" },
                  { key: "day", label: "روز", kind: "text" },
                  {
                    key: activeMetric,
                    label: choices.find(([key]) => key === activeMetric)![1],
                    kind: ["price", "revenue"].includes(activeMetric)
                      ? "money"
                      : "number",
                  },
                ]}
              />
            </details>
          </>
        )}
      </Panel>
      {!chart.loading &&
        !chart.error &&
        data &&
        chartSection !== "overview" && (
          <div className="chart-pies">
            {section === "prices" ? (
              <PieChart
                rows={data.totals}
                metric="changes"
                title="سهم محصولات از تغییرات قیمت"
              />
            ) : (
              <>
                <PieChart
                  rows={data.totals}
                  metric={
                    chartSection === "customers" || chartSection === "searches"
                      ? "orders"
                      : "quantity"
                  }
                  title={
                    chartSection === "customers"
                      ? "سهم مشتریان از سفارش‌ها"
                      : chartSection === "searches"
                        ? "سهم عبارت‌های جستجو"
                        : "سهم فروش بسته‌ها"
                  }
                />
                {chartSection !== "searches" && (
                  <PieChart
                    rows={data.totals}
                    metric={
                      ["products", "categories"].includes(chartSection)
                        ? "clicks"
                        : "revenue"
                    }
                    title={
                      ["products", "categories"].includes(chartSection)
                        ? "سهم کلیک‌ها"
                        : "سهم مبلغ خرید"
                    }
                    monetary={
                      !["products", "categories"].includes(chartSection)
                    }
                  />
                )}
              </>
            )}
          </div>
        )}
      {!chart.loading &&
        !chart.error &&
        data &&
        ["products", "packages"].includes(section) && (
          <Panel title="فروش هر بسته در محصولات">
            <DataTable
              data={data.packages}
              columns={[
                { key: "name", label: "محصول", kind: "text" },
                { key: "package", label: "بسته", kind: "text" },
                { key: "quantity", label: "تعداد فروخته‌شده", kind: "number" },
                { key: "revenue", label: "فروش خالص (تومان)", kind: "money" },
              ]}
            />
          </Panel>
        )}
      <Panel
        title="داده‌های گزارش"
        action={
          section === "customer-orders" ? (
            <button
              className="text-link"
              onClick={() => changeSection("customers")}
            >
              بازگشت به مشتریان
            </button>
          ) : undefined
        }
      >
        <div className="omni-filters">
          <label>
            مرتب‌سازی
            <select
              value={sort}
              onChange={(e) => {
                setSort(e.target.value);
                setPage(1);
              }}
            >
              <option value="">پیشنهادی</option>
              {result.data?.columns?.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            ترتیب
            <select
              value={direction}
              onChange={(e) => {
                setDirection(e.target.value);
                setPage(1);
              }}
            >
              <option value="desc">نزولی</option>
              <option value="asc">صعودی</option>
            </select>
          </label>
        </div>
        <Feedback error={result.error} loading={result.loading} />
        {!result.loading && !result.error && (
          <DataTable
            data={result.data?.items || []}
            columns={result.data?.columns || []}
            selected={new Set(selected)}
            onSelect={
              [
                "products",
                "packages",
                "customers",
                "categories",
                "searches",
              ].includes(section)
                ? toggle
                : undefined
            }
            onRow={
              section === "customers"
                ? (row) => {
                    setCustomer(String(row.id));
                    setSection("customer-orders");
                    setPage(1);
                    setSort("");
                  }
                : undefined
            }
          />
        )}
        <Pager data={result.data} page={page} onPage={setPage} />
      </Panel>
    </Workspace>
  );
}
