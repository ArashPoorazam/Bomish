"use client";
import { useEffect, useState } from "react";
import { CalendarDays, Download, RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import { fa } from "@/lib/format";
import {
  dateError,
  recentDays,
  reports,
  type ReportSection,
} from "./analytics-model";

type ExportJob = {
  id: string;
  status: string;
  progress: number;
  error?: string;
};
export function ExportReport({
  filters,
  disabled,
}: {
  filters: string;
  disabled: boolean;
}) {
  const [job, setJob] = useState<ExportJob | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [exportScope, setExportScope] = useState("");
  useEffect(() => {
    if (!job || ["ready", "failed"].includes(job.status)) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      api<ExportJob>(
        `/omnisire/exports/${job.id}`,
        "GET",
        undefined,
        controller.signal,
      )
        .then((v) => {
          if (!controller.signal.aborted) {
            setJob(v);
            setError("");
          }
        })
        .catch((e) => {
          if (!controller.signal.aborted) setError(e.message);
        });
    }, 2000);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [job]);
  async function start() {
    setBusy(true);
    setError("");
    try {
      const params = new URLSearchParams(filters);
      params.delete("page");
      params.delete("pageSize");
      const result = await api<{ id: string }>(
        "/omnisire/exports",
        "POST",
        Object.fromEntries(params),
      );
      const section = params.get("section") || "overview";
      const label = Object.hasOwn(reports, section)
        ? reports[section as ReportSection].title
        : "سفارش‌های مشتری";
      setExportScope(
        `${label} · ${params.get("from")} تا ${params.get("to")}${params.get("q") ? " · جستجو: " + params.get("q") : ""}`,
      );
      setJob({ ...result, status: "pending", progress: 0 });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const running = !!job && !["ready", "failed"].includes(job.status);
  return (
    <div className="analytics-export">
      <button
        className="button secondary"
        disabled={disabled || busy || running}
        onClick={() => void start()}
      >
        <Download size={16} />
        {busy || running ? "آماده‌سازی اکسل…" : "دریافت اکسل"}
      </button>
      {job?.status === "ready" && (
        <a
          className="text-link"
          href={`/api/v1/omnisire/exports/${job.id}/download`}
        >
          دانلود فایل اکسل
        </a>
      )}
      {running && (
        <span role="status">
          {fa(job.progress)}٪ <progress max={100} value={job.progress} />
        </span>
      )}
      {(error || job?.status === "failed") && (
        <div role="alert" className="error">
          {error || job?.error || "خروجی آماده نشد."}
          {error && running && (
            <button
              className="text-link"
              onClick={() => {
                setError("");
                setJob({ ...job });
              }}
            >
              بررسی دوباره خروجی
            </button>
          )}
        </div>
      )}
      {job && <small>خروجی درخواست‌شده: {exportScope}</small>}
      <small>تمام ردیف‌های مطابق جستجوی جدول؛ مستقل از انتخاب‌های نمودار</small>
    </div>
  );
}
export function DateControls({
  from,
  to,
  onApply,
  onRefresh,
}: {
  from: string;
  to: string;
  onApply: (from: string, to: string) => void;
  onRefresh: () => void;
}) {
  const [start, setStart] = useState(from),
    [end, setEnd] = useState(to);
  const error = dateError(start, end);
  const changed = start !== from || end !== to;
  return (
    <section className="analytics-period" aria-label="بازه گزارش">
      <div className="analytics-period-top">
        <span>
          <CalendarDays size={18} /> بازه گزارش
        </span>
        <div className="analytics-presets" aria-label="بازه‌های آماده">
          {[7, 30, 90].map((days) => {
            const range = recentDays(days);
            return (
              <button
                key={days}
                aria-pressed={from === range.from && to === range.to}
                onClick={() => {
                  setStart(range.from);
                  setEnd(range.to);
                  onApply(range.from, range.to);
                }}
              >
                {fa(days)} روز اخیر
              </button>
            );
          })}
        </div>
        <button className="analytics-refresh" onClick={onRefresh}>
          <RefreshCw size={15} />
          به‌روزرسانی
        </button>
      </div>
      <form
        className="analytics-date-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!error) onApply(start, end);
        }}
      >
        <label>
          از تاریخ
          <input
            type="date"
            value={start}
            max={end || undefined}
            onChange={(e) => setStart(e.target.value)}
            aria-describedby={error ? "date-error" : undefined}
          />
        </label>
        <label>
          تا تاریخ
          <input
            type="date"
            value={end}
            min={start || undefined}
            onChange={(e) => setEnd(e.target.value)}
            aria-describedby={error ? "date-error" : undefined}
          />
        </label>
        <button className="button" disabled={!!error || !changed}>
          اعمال بازه
        </button>
        <p>
          ورودی تاریخ میلادی است؛ گزارش به وقت تهران. امروز ممکن است کامل نباشد.
        </p>
      </form>
      {error && (
        <p id="date-error" className="error" role="alert">
          {error}
        </p>
      )}
      {changed && !error && (
        <p className="omni-help" role="status">
          برای به‌روزرسانی گزارش، بازه جدید را اعمال کنید.
        </p>
      )}
    </section>
  );
}
