"use client";

import {
  Activity,
  ArrowUpLeft,
  Check,
  Clock3,
  Database,
  HardDrive,
  MemoryStick,
  RefreshCw,
  Server,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";
import { fa } from "@/lib/format";
import { Workspace, stamp } from "./shared";
import { decimal, bytes, duration } from "./monitoring-format";
import { MonitoringTraffic } from "./monitoring-traffic";
import { useMonitoring } from "./use-monitoring";

export function ServerMonitoring() {
  return (
    <Workspace
      owner
      title="پایش سرور"
      description="وضعیت سرویس‌ها، منابع و ترافیک سرور در یک نگاه."
    >
      <MonitoringContent />
    </Workspace>
  );
}

function MonitoringContent() {
  const { data, error, loading, paused, setPaused, refresh, stale } =
    useMonitoring();
  const attention = data?.status === "attention";
  const uncertain = stale || !!error;
  const StatusIcon = uncertain || attention ? TriangleAlert : Check;
  const total =
    data?.traffic.reduce((sum, bucket) => sum + bucket.requests, 0) || 0;
  const errors =
    data?.traffic.reduce((sum, bucket) => sum + bucket.errors, 0) || 0;
  const average =
    total && data
      ? data.traffic.reduce(
          (sum, bucket) => sum + bucket.averageMs * bucket.requests,
          0,
        ) / total
      : null;
  const diskFree = data?.disk
    ? (data.disk.availableBytes / data.disk.totalBytes) * 100
    : null;

  return (
    <div className="server-monitor">
      <div className="monitor-toolbar">
        <div className="monitor-live">
          <span
            className={`monitor-dot ${paused || uncertain ? "is-muted" : ""}`}
          />
          {paused
            ? "به‌روزرسانی خودکار متوقف است"
            : "به‌روزرسانی خودکار هر ۱۵ ثانیه"}
        </div>
        <div className="monitor-controls">
          <label>
            <input
              type="checkbox"
              checked={!paused}
              onChange={(event) => setPaused(!event.target.checked)}
            />{" "}
            خودکار
          </label>
          <button
            className="button secondary"
            onClick={refresh}
            disabled={loading}
          >
            <RefreshCw size={16} />
            {loading ? "در حال دریافت…" : "به‌روزرسانی"}
          </button>
        </div>
      </div>
      <section
        className={`monitor-health ${uncertain || attention ? "needs-attention" : ""}`}
        aria-label="خلاصه وضعیت سرور"
      >
        <div className="monitor-health-icon">
          {!data && !error ? <Server size={28} /> : <StatusIcon size={28} />}
        </div>
        <div className="monitor-health-copy">
          <span className="monitor-eyebrow">وضعیت سرور</span>
          <h2 aria-live="polite">
            {uncertain
              ? "وضعیت فعلی نامشخص است"
              : !data
                ? "در حال بررسی سرور…"
                : attention
                  ? "نیاز به بررسی"
                  : "سرویس‌های بررسی‌شده در دسترس‌اند"}
          </h2>
          <p>
            {uncertain
              ? "برای تأیید وضعیت، دوباره تلاش کنید. اطلاعات قبلی، در صورت وجود، در پایین نمایش داده می‌شود."
              : "بررسی سرویس API و پایگاه داده همین نمونه از برنامه."}
          </p>
        </div>
        {data && (
          <div className="monitor-environment">
            <span>
              {data.environment === "production" ? "محیط اصلی" : "محیط توسعه"}
            </span>
            <small>
              {data.catalogOnly ? "حالت کاتالوگ" : "فروش آنلاین فعال"}
            </small>
          </div>
        )}
      </section>
      {error && (
        <p className="monitor-error" role="alert">
          {error}
        </p>
      )}
      {!data && !error && (
        <div className="monitor-placeholder" role="status">
          در حال دریافت اطلاعات پایش…
        </div>
      )}
      {!data && error && (
        <div className="monitor-placeholder">
          داده‌ای برای نمایش دریافت نشده است. با دکمه «به‌روزرسانی» دوباره تلاش
          کنید.
        </div>
      )}
      {data && (
        <>
          <div className="monitor-updated">
            {stale ? "آخرین اطلاعات ثبت‌شده" : "آخرین بررسی"}:{" "}
            <time dateTime={data.checkedAt}>{stamp(data.checkedAt)}</time>
            {paused && " · دریافت خودکار خاموش"}
          </div>
          <div className="monitor-metrics">
            <Metric
              Icon={Clock3}
              label="زمان فعالیت API"
              value={duration(data.uptimeSeconds)}
              hint="از آخرین راه‌اندازی برنامه"
            />
            <Metric
              Icon={Activity}
              label="میانگین زمان پاسخ API"
              value={average === null ? "—" : `${decimal(average)} میلی‌ثانیه`}
              hint={
                total
                  ? "زمان پردازش درخواست‌ها در سرور"
                  : "هنوز درخواستی ثبت نشده است"
              }
            />
            <Metric
              Icon={MemoryStick}
              label="حافظه مصرفی برنامه"
              value={bytes(data.runtime.heapBytes)}
              hint="حافظه زنده Go؛ نه کل RAM سرور"
            />
            <Metric
              Icon={HardDrive}
              label="فضای آزاد فایل‌ها"
              value={data.disk ? bytes(data.disk.availableBytes) : "نامشخص"}
              hint={
                diskFree === null
                  ? "اندازه‌گیری این فضای ذخیره‌سازی در دسترس نیست"
                  : `${decimal(diskFree)}٪ از فضای فایل‌سیستم بارگذاری‌ها آزاد است`
              }
              warning={diskFree !== null && diskFree < 15}
            />
          </div>
          <div className="monitor-columns">
            <section className="monitor-panel">
              <div className="monitor-panel-heading">
                <h2>سلامت سرویس‌ها</h2>
                <Server size={18} />
              </div>
              <Service
                name="سرویس API"
                detail="پاسخ موفق به درخواست پایش"
                status={stale ? "unknown" : "healthy"}
              />
              <Service
                name="پایگاه داده"
                detail={
                  data.database.status === "healthy"
                    ? `زمان اتصال: ${decimal(data.database.latencyMs)} میلی‌ثانیه`
                    : "اتصال پایگاه داده برقرار نشد"
                }
                status={stale ? "unknown" : data.database.status}
              />
              <Service
                name="فضای ذخیره‌سازی فایل‌ها"
                detail={
                  diskFree === null
                    ? "اطلاعات ظرفیت در دسترس نیست"
                    : "هشدار در صورت کمتر از ۱۵٪ فضای آزاد"
                }
                status={
                  stale || diskFree === null
                    ? "unknown"
                    : diskFree < 15
                      ? "attention"
                      : "healthy"
                }
              />
              <p className="monitor-note">
                این بررسی شامل درگاه پرداخت، پیامک و سرویس‌های ارسال نیست.
              </p>
            </section>
            <section className="monitor-panel">
              <div className="monitor-panel-heading">
                <h2>اتصال‌های پایگاه داده</h2>
                <Database size={18} />
              </div>
              <div className="monitor-pool">
                <strong>
                  {fa(data.database.activeConnections)}
                  <small> / {fa(data.database.maxConnections)}</small>
                </strong>
                <span>اتصال در حال استفاده</span>
              </div>
              <meter
                min={0}
                max={data.database.maxConnections}
                value={data.database.activeConnections}
                aria-label="اتصال‌های فعال پایگاه داده"
              />
              <div className="monitor-pool-legend">
                <span>
                  آماده استفاده <b>{fa(data.database.idleConnections)}</b>
                </span>
                <span>
                  سقف اتصال‌ها <b>{fa(data.database.maxConnections)}</b>
                </span>
              </div>
              <p className="monitor-note">
                ظرفیت اتصال این نمونه از API به پایگاه داده.
              </p>
            </section>
          </div>
          <MonitoringTraffic data={data} total={total} errors={errors} />
          <section className="monitor-panel">
            <div className="monitor-panel-heading">
              <h2>مشخصات اجرای برنامه</h2>
              <MemoryStick size={18} />
            </div>
            <dl className="monitor-runtime">
              <div>
                <dt>محیط اجرا</dt>
                <dd dir="ltr">{data.runtime.version}</dd>
              </div>
              <div>
                <dt>سیستم‌عامل / معماری</dt>
                <dd dir="ltr">
                  {data.runtime.os} / {data.runtime.arch}
                </dd>
              </div>
              <div>
                <dt>پردازنده‌های قابل مشاهده</dt>
                <dd>{fa(data.runtime.cpuCount)}</dd>
              </div>
              <div>
                <dt>وظایف هم‌زمان Go</dt>
                <dd>{fa(data.runtime.goroutines)}</dd>
              </div>
              <div>
                <dt>حافظه رزروشده Go</dt>
                <dd>{bytes(data.runtime.reservedBytes)}</dd>
              </div>
              <div>
                <dt>شروع فعالیت</dt>
                <dd>{stamp(data.startedAt)}</dd>
              </div>
            </dl>
          </section>
          <footer className="monitor-footer">
            <p>
              آمار مربوط به همین نمونه از API است و با راه‌اندازی مجدد از نو ثبت
              می‌شود. این صفحه جایگزین پایش مستقل قطعی سرور نیست.
            </p>
            <Link href="/omnisire/events">
              رویدادهای مدیریتی <ArrowUpLeft size={16} />
            </Link>
          </footer>
        </>
      )}
    </div>
  );
}

function Metric({
  Icon,
  label,
  value,
  hint,
  warning = false,
}: {
  Icon: typeof Clock3;
  label: string;
  value: string;
  hint: string;
  warning?: boolean;
}) {
  return (
    <article className={`monitor-metric ${warning ? "metric-warning" : ""}`}>
      <div>
        <span>{label}</span>
        <Icon size={19} />
      </div>
      <strong>{value}</strong>
      <p>{hint}</p>
    </article>
  );
}

function Service({
  name,
  detail,
  status,
}: {
  name: string;
  detail: string;
  status: string;
}) {
  const label =
    status === "healthy"
      ? "سالم"
      : status === "unknown"
        ? "نامشخص"
        : status === "attention"
          ? "فضای کم"
          : "قطع ارتباط";
  return (
    <div className="monitor-service">
      <div>
        <h3>{name}</h3>
        <p>{detail}</p>
      </div>
      <span className={`monitor-badge status-${status}`}>
        {status === "healthy" ? (
          <Check size={13} />
        ) : (
          <TriangleAlert size={13} />
        )}
        {label}
      </span>
    </div>
  );
}
