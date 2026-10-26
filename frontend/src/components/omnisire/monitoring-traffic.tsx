import { useState } from "react";
import { Activity, TriangleAlert } from "lucide-react";
import { decimal, time } from "./monitoring-format";
import { HistoryChart } from "./monitoring-chart";
import type { MonitoringSnapshot } from "./use-monitoring";

export function MonitoringTraffic({ data }: { data: MonitoringSnapshot }) {
  const [minutes, setMinutes] = useState(30);
  const [view, setView] = useState<"volume" | "latency">("volume");
  const end = Date.parse(data.checkedAt);
  const buckets = data.traffic.filter(
    (b) =>
      Date.parse(b.at) >=
      Math.floor(end / 60000) * 60000 - (minutes - 1) * 60000,
  );
  const total = buckets.reduce((n, b) => n + b.requests, 0);
  const errors = buckets.reduce((n, b) => n + b.errors, 0);
  const average = total
    ? buckets.reduce((n, b) => n + b.averageMs * b.requests, 0) / total
    : null;
  const max = Math.max(1, ...buckets.map((b) => b.requests));
  const peakLatency = Math.max(1, ...buckets.map((b) => b.averageMs));
  return (
    <section className="monitor-panel monitor-traffic">
      <div className="monitor-panel-heading">
        <div>
          <span className="monitor-eyebrow">API OBSERVABILITY</span>
          <h2>Traffic & response health</h2>
          <p>Understand demand, spot failures, and track response time.</p>
        </div>
        <div className="monitor-segments" aria-label="API traffic window">
          {[5, 15, 30].map((m) => (
            <button
              key={m}
              aria-pressed={minutes === m}
              onClick={() => setMinutes(m)}
            >
              {m}m
            </button>
          ))}
        </div>
      </div>
      <div className="monitor-traffic-stats">
        <div>
          <span>Total requests</span>
          <strong>{decimal(total)}</strong>
          <small>Last {minutes} minutes</small>
        </div>
        <div className={errors ? "monitor-error-count" : ""}>
          <span>Server errors</span>
          <strong>
            {decimal(errors)} <small>5xx</small>
          </strong>
          <small>
            {total
              ? `${decimal((errors / total) * 100)}% error rate`
              : "No requests yet"}
          </small>
        </div>
        <div>
          <span>Avg. response time</span>
          <strong>
            {average === null ? "—" : decimal(average)} <small>ms</small>
          </strong>
          <small>Request-weighted server time</small>
        </div>
        <div>
          <span>Peak traffic</span>
          <strong>
            {total ? decimal(max) : "—"} <small>req/min</small>
          </strong>
          <small>Highest minute in this window</small>
        </div>
      </div>
      <div className="monitor-traffic-layout">
        <div className="monitor-traffic-main">
          <div className="monitor-panel-heading">
            <div className="monitor-chart-tabs" aria-label="API chart">
              <button
                aria-pressed={view === "volume"}
                onClick={() => setView("volume")}
              >
                Request volume
              </button>
              <button
                aria-pressed={view === "latency"}
                onClick={() => setView("latency")}
              >
                Response time
              </button>
            </div>
            <span className="monitor-note">1-minute buckets</span>
          </div>
          {total === 0 ? (
            <div className="monitor-empty">
              No requests recorded in this window.
            </div>
          ) : view === "latency" ? (
            <HistoryChart
              key={minutes}
              points={buckets.map((b) => ({
                at: b.at,
                value: b.requests ? b.averageMs : null,
              }))}
              label="Average response time"
              unit="ms"
              max={Math.ceil(peakLatency / 10) * 10}
              start={Date.parse(buckets[0].at)}
              end={end}
              color="#6b6ca7"
            />
          ) : (
            <>
              <div className="monitor-volume-label">
                <span>Requests per minute</span>
                <span>Peak {max}</span>
              </div>
              <div
                className="monitor-bars"
                role="img"
                aria-label={`${total} requests and ${errors} server errors. Minute-by-minute values are in the table below.`}
              >
                {buckets.map((b) => (
                  <div
                    className="monitor-bar-slot"
                    key={b.at}
                    title={`${time(b.at)} · ${b.requests} requests · ${b.errors} errors · ${decimal(b.averageMs)} ms`}
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
              <div className="monitor-chart-axis">
                <span>{time(buckets[0].at)}</span>
                <span>{time(buckets.at(-1)!.at)} · partial</span>
              </div>
              <div className="monitor-chart-caption">
                <span>
                  <i />
                  Responses below 500 (includes 4xx)
                </span>
                <span>
                  <i />
                  Server errors (5xx)
                </span>
              </div>
            </>
          )}
        </div>
        <aside
          className={`monitor-error-summary ${errors ? "has-errors" : ""}`}
          aria-label="Error summary"
        >
          {errors ? <TriangleAlert size={21} /> : <Activity size={21} />}
          <h3>
            {errors
              ? "Server errors detected"
              : total
                ? "No server errors"
                : "Waiting for traffic"}
          </h3>
          <p>
            {errors
              ? `${errors} requests returned a 5xx response across ${buckets.filter((b) => b.errors > 0).length} minute buckets. Check API logs around these times.`
              : total
                ? "All recorded responses are below 500. This includes client errors (4xx)."
                : "Traffic appears here as requests reach this API instance."}
          </p>
          {errors > 0 && (
            <div className="monitor-error-minutes">
              {buckets
                .filter((b) => b.errors > 0)
                .slice(-3)
                .reverse()
                .map((b) => (
                  <div key={b.at}>
                    <time dateTime={b.at}>{time(b.at)}</time>
                    <strong>{b.errors} errors</strong>
                  </div>
                ))}
            </div>
          )}
          <small>
            Health alerts use a 5% error threshold across the full 30-minute
            window.
          </small>
        </aside>
      </div>
      <details className="monitor-details monitor-traffic-details">
        <summary>Minute-by-minute data</summary>
        <div className="monitor-table-wrap">
          <table>
            <caption>
              Tehran time. Response time measures server processing. The current
              minute is incomplete.
            </caption>
            <thead>
              <tr>
                <th>Time</th>
                <th>Requests</th>
                <th>5xx errors</th>
                <th>Error rate</th>
                <th>Avg. response (ms)</th>
              </tr>
            </thead>
            <tbody>
              {buckets.map((b) => (
                <tr key={b.at}>
                  <td>{time(b.at)}</td>
                  <td>{b.requests}</td>
                  <td>{b.errors}</td>
                  <td>
                    {b.requests
                      ? `${decimal((b.errors / b.requests) * 100)}%`
                      : "—"}
                  </td>
                  <td>{b.requests ? decimal(b.averageMs) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      <p className="monitor-note">
        This API instance only. Health checks and monitoring requests are
        excluded. Traffic history resets on restart.
      </p>
    </section>
  );
}
