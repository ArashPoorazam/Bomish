import { useState } from "react";
import {
  Cpu,
  MemoryStick,
  HardDrive,
  Database,
  type LucideIcon,
} from "lucide-react";
import { bytes, decimal, utilization, time } from "./monitoring-format";
import { HistoryChart } from "./monitoring-chart";
import type { MonitoringSnapshot } from "./use-monitoring";

type ResourceKey = "cpu" | "memory" | "disk" | "connections";
type Sample = NonNullable<MonitoringSnapshot["resources"]>[number];
const resources: {
  key: ResourceKey;
  label: string;
  Icon: LucideIcon;
  scope: string;
}[] = [
  { key: "cpu", label: "CPU", Icon: Cpu, scope: "System CPU utilization" },
  {
    key: "memory",
    label: "Memory",
    Icon: MemoryStick,
    scope: "System RAM in use",
  },
  { key: "disk", label: "Disk", Icon: HardDrive, scope: "Uploads filesystem" },
  {
    key: "connections",
    label: "Connections",
    Icon: Database,
    scope: "Database pool utilization",
  },
];
function value(sample: Sample | undefined, key: ResourceKey) {
  if (!sample) return null;
  if (key === "cpu") return sample.cpuPercent;
  if (key === "connections") return sample.connectionsPercent;
  return utilization(sample[key]);
}
function Gauge({ percent, label }: { percent: number | null; label: string }) {
  const bounded = Math.max(0, Math.min(100, percent ?? 0));
  const angle = Math.PI + (bounded / 100) * Math.PI;
  return (
    <svg
      className="monitor-gauge"
      viewBox="0 0 200 145"
      role="img"
      aria-label={`${label}: ${percent === null ? "unavailable" : `${decimal(percent)} percent used`}`}
    >
      <path
        d="M24 100 A76 76 0 0 1 176 100"
        fill="none"
        stroke="#e8ede8"
        strokeWidth="11"
        strokeLinecap="round"
      />
      <path
        d="M24 100 A76 76 0 0 1 176 100"
        fill="none"
        stroke="currentColor"
        strokeWidth="11"
        strokeLinecap="round"
        pathLength="100"
        strokeDasharray={`${bounded} 100`}
        opacity={percent === null ? 0 : 1}
      />
      {[0, 25, 50, 75, 100].map((n) => {
        const a = Math.PI + (n / 100) * Math.PI;
        return (
          <line
            key={n}
            x1={100 + 60 * Math.cos(a)}
            y1={100 + 60 * Math.sin(a)}
            x2={100 + 65 * Math.cos(a)}
            y2={100 + 65 * Math.sin(a)}
            stroke="#9baaa3"
            strokeWidth="1.5"
          />
        );
      })}
      {percent !== null && (
        <>
          <line
            x1="100"
            y1="100"
            x2={100 + 49 * Math.cos(angle)}
            y2={100 + 49 * Math.sin(angle)}
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
          <circle cx="100" cy="100" r="5" fill="currentColor" />
        </>
      )}
      <text x="100" y="135" textAnchor="middle" className="monitor-gauge-value">
        {percent === null ? "—" : `${decimal(percent)}%`}
      </text>
      <text x="24" y="121" textAnchor="middle" className="monitor-gauge-limit">
        0
      </text>
      <text x="176" y="121" textAnchor="middle" className="monitor-gauge-limit">
        100
      </text>
    </svg>
  );
}
export function MonitoringResources({
  data,
  stale,
}: {
  data: MonitoringSnapshot;
  stale: boolean;
}) {
  const [selected, setSelected] = useState<ResourceKey>("cpu");
  const [minutes, setMinutes] = useState(30);
  const history = data.resources ?? [];
  const latest = history.at(-1);
  const end = Date.parse(data.checkedAt),
    start = end - minutes * 60000;
  const visible = history.filter((p) => Date.parse(p.at) >= start);
  const chosen = resources.find((r) => r.key === selected)!;
  const samplesStale = stale || !latest || end - Date.parse(latest.at) > 45000;
  return (
    <section
      className="monitor-resources"
      aria-label="Hardware and resource usage"
    >
      <div className="monitor-section-heading">
        <div>
          <span className="monitor-eyebrow">RESOURCE MONITOR</span>
          <h2>A pulse on your server</h2>
        </div>
        <span className="monitor-note">
          Select a gauge to explore its history
        </span>
      </div>
      <div className="monitor-gauges">
        {resources.map(({ key, label, Icon, scope }) => {
          const percent =
            key === "disk"
              ? utilization(data.disk)
              : key === "connections"
                ? data.database.maxConnections > 0
                  ? (data.database.activeConnections /
                      data.database.maxConnections) *
                    100
                  : null
                : value(latest, key);
          const warning =
            percent !== null && percent >= (key === "disk" ? 85 : 90);
          const capacity = key === "memory" ? latest?.memory : data.disk;
          const detail =
            key === "cpu"
              ? percent === null
                ? "Waiting for two CPU samples"
                : `${data.runtime.cpuCount} CPUs available to Go`
              : key === "connections"
                ? `${data.database.activeConnections} active / ${data.database.maxConnections} max`
                : capacity
                  ? `${bytes(capacity.totalBytes - capacity.availableBytes)} / ${bytes(capacity.totalBytes)}`
                  : "Measurement unavailable";
          return (
            <button
              key={key}
              className={`monitor-gauge-card ${selected === key ? "is-selected" : ""} ${warning ? "metric-warning" : ""}`}
              aria-pressed={selected === key}
              onClick={() => setSelected(key)}
            >
              <span className="monitor-gauge-heading">
                <span>
                  <Icon size={17} />
                  {label}
                </span>
                <span className="monitor-gauge-state">
                  {samplesStale
                    ? "Last sample"
                    : percent === null
                      ? "No data"
                      : warning
                        ? "High usage"
                        : "Live"}
                </span>
              </span>
              <Gauge percent={percent} label={label} />
              <strong className="monitor-gauge-detail">{detail}</strong>
              <span className="monitor-gauge-scope">{scope}</span>
            </button>
          );
        })}
      </div>
      <div className="monitor-panel monitor-resource-history">
        <div className="monitor-panel-heading">
          <div>
            <h3>{chosen.label} usage history</h3>
            <p>15-second samples · Tehran time · gaps mean missing data</p>
          </div>
          <div
            className="monitor-segments"
            aria-label="Resource history window"
          >
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
        <HistoryChart
          key={`${selected}-${minutes}`}
          points={visible.map((p) => ({ at: p.at, value: value(p, selected) }))}
          label={chosen.label}
          unit="%"
          start={start}
          end={end}
        />
        <details className="monitor-details">
          <summary>Resource sample data</summary>
          <div className="monitor-table-wrap">
            <table>
              <caption>
                Measured usage percentages. Unavailable readings are shown as —.
              </caption>
              <thead>
                <tr>
                  <th>Time (Tehran)</th>
                  {resources.map((r) => (
                    <th key={r.key}>{r.label} %</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((p) => (
                  <tr key={p.at}>
                    <td>{time(p.at)}</td>
                    {resources.map((r) => (
                      <td key={r.key}>
                        {value(p, r.key) === null
                          ? "—"
                          : decimal(value(p, r.key)!)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
        <p className="monitor-note">
          CPU and RAM describe the system visible to the API, not container
          limits. Disk measures the uploads filesystem. History is kept for 30
          minutes in this API instance and resets on restart.
        </p>
      </div>
    </section>
  );
}
