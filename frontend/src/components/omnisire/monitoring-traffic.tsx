import { fa } from "@/lib/format";
import { decimal, time } from "./monitoring-format";
import type { MonitoringSnapshot } from "./use-monitoring";

export function MonitoringTraffic({
  data,
  total,
  errors,
}: {
  data: MonitoringSnapshot;
  total: number;
  errors: number;
}) {
  const max = Math.max(1, ...data.traffic.map((b) => b.requests));
  return (
    <section className="monitor-panel monitor-traffic">
      <div className="monitor-panel-heading">
        <div>
          <h2>ترافیک و خطاهای API</h2>
          <p>۳۰ دقیقه اخیر · هر ستون یک دقیقه · دقیقه جاری ناتمام است</p>
        </div>
        <span className="monitor-badge status-unknown">همین نمونه</span>
      </div>
      <div className="monitor-traffic-stats">
        <div>
          <strong>{fa(total)}</strong>
          <span>درخواست</span>
        </div>
        <div className={errors ? "monitor-error-count" : ""}>
          <strong>{fa(errors)}</strong>
          <span>خطای سرور (5xx)</span>
        </div>
        <div>
          <strong>{total ? `${decimal((errors / total) * 100)}٪` : "—"}</strong>
          <span>نرخ خطا</span>
        </div>
      </div>
      {errors > 0 && (
        <p className="monitor-error">
          در این بازه خطای سرور ثبت شده است. برای یافتن علت، لاگ سرویس API را
          بررسی کنید.
        </p>
      )}
      {total === 0 ? (
        <div className="monitor-empty">در این بازه درخواستی ثبت نشده است.</div>
      ) : (
        <>
          <div
            className="monitor-bars"
            role="img"
            aria-label={`${fa(total)} درخواست و ${fa(errors)} خطای سرور. جزئیات در جدول زیر نمودار در دسترس است.`}
          >
            {data.traffic.map((b) => (
              <div
                className="monitor-bar-slot"
                key={b.at}
                title={`${time(b.at)}: ${fa(b.requests)} درخواست، ${fa(b.errors)} خطا`}
              >
                <div
                  className="monitor-bar"
                  style={{ height: `${(b.requests / max) * 100}%` }}
                >
                  <span
                    style={{
                      height: `${b.requests ? (b.errors / b.requests) * 100 : 0}%`,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="monitor-chart-axis" dir="ltr">
            <span>{time(data.traffic[0].at)}</span>
            <span>{time(data.traffic[data.traffic.length - 1].at)}</span>
          </div>
        </>
      )}
      <div className="monitor-chart-caption">
        <span>
          <i /> درخواست موفق یا خطای کاربر (کمتر از 5xx)
        </span>
        <span>
          <i /> خطای سرور (5xx)
        </span>
      </div>
      <details className="monitor-details">
        <summary>جزئیات دقیقه‌ای</summary>
        <div className="monitor-table-wrap">
          <table>
            <caption>
              زمان‌ها به وقت تهران؛ زمان پاسخ، میانگین پردازش سمت سرور است.
            </caption>
            <thead>
              <tr>
                <th>زمان</th>
                <th>درخواست</th>
                <th>خطای سرور</th>
                <th>زمان پاسخ (ms)</th>
              </tr>
            </thead>
            <tbody>
              {data.traffic.map((b) => (
                <tr key={b.at}>
                  <td>{time(b.at)}</td>
                  <td>{fa(b.requests)}</td>
                  <td>{fa(b.errors)}</td>
                  <td>{b.requests ? decimal(b.averageMs) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      <p className="monitor-note">
        درخواست‌های بررسی سلامت و این صفحه در آمار نیستند. هشدار سلامت با نرخ
        خطای بیشتر از ۵٪ در این بازه فعال می‌شود.
      </p>
    </section>
  );
}
