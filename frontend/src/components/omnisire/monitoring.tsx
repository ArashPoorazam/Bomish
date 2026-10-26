"use client";

import {
  ArrowUpRight,
  Check,
  Clock3,
  Database,
  MemoryStick,
  RefreshCw,
  Server,
  TriangleAlert,
} from "lucide-react";
import Link from "next/link";
import { Workspace } from "./shared";
import {
  decimal,
  bytes,
  duration,
  stamp,
  utilization,
} from "./monitoring-format";
import { MonitoringTraffic } from "./monitoring-traffic";
import { MonitoringResources } from "./monitoring-resources";
import { useMonitoring } from "./use-monitoring";

export function ServerMonitoring() {
  return (
    <Workspace
      owner
      title="Server"
      contentLanguage="en"
      description="Resources, availability, and API performance."
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
  const diskUsed = utilization(data?.disk);
  return (
    <div className="server-monitor">
      <div className="monitor-toolbar">
        <div className="monitor-live">
          <span
            className={`monitor-dot ${paused || uncertain || !data ? "is-muted" : ""}`}
          />
          {paused ? "Auto-refresh paused" : "Auto-refresh every 15 seconds"}
          {data && (
            <span className="monitor-last-update">
              Updated {stamp(data.checkedAt)} · Tehran
            </span>
          )}
        </div>
        <div className="monitor-controls">
          <label>
            <input
              type="checkbox"
              checked={!paused}
              onChange={(event) => setPaused(!event.target.checked)}
            />
            Auto-refresh
          </label>
          <button
            className="button secondary"
            onClick={refresh}
            disabled={loading}
          >
            <RefreshCw
              size={15}
              className={loading ? "monitor-spinning" : undefined}
            />
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>
      <section
        className={`monitor-health ${uncertain || attention ? "needs-attention" : ""}`}
        aria-label="Server health summary"
      >
        <div className="monitor-health-icon">
          {!data && !error ? <Server size={22} /> : <StatusIcon size={22} />}
        </div>
        <div className="monitor-health-copy">
          <span className="monitor-eyebrow">SERVICE STATUS</span>
          <h2 aria-live="polite">
            {uncertain
              ? "Current health is unknown"
              : !data
                ? "Checking your server…"
                : attention
                  ? "Needs attention"
                  : "Monitored services are online"}
          </h2>
          <p>
            {uncertain
              ? "Refresh to verify current health. Previous readings are retained below."
              : "API and database availability for this instance."}
          </p>
        </div>
        {data && (
          <div className="monitor-health-meta">
            <span className="monitor-environment">{data.environment}</span>
            <span>
              <Clock3 size={14} /> Uptime{" "}
              <strong>{duration(data.uptimeSeconds)}</strong>
            </span>
          </div>
        )}
      </section>
      {error && (
        <p className="monitor-error" role="alert">
          {error}
        </p>
      )}
      {!data && (
        <div className="monitor-placeholder" role="status">
          {error
            ? "No measurements received. Select Refresh to try again."
            : "Loading server measurements…"}
        </div>
      )}
      {data && (
        <>
          <MonitoringResources data={data} stale={uncertain} />
          <MonitoringTraffic data={data} />
          <div className="monitor-columns">
            <section className="monitor-panel">
              <div className="monitor-panel-heading">
                <h2>Service checks</h2>
                <Server size={18} />
              </div>
              <Service
                name="API"
                detail="Monitoring endpoint reachable"
                status={uncertain ? "unknown" : "healthy"}
              />
              <Service
                name="PostgreSQL"
                detail={
                  data.database.status === "healthy"
                    ? `${decimal(data.database.latencyMs)} ms connection latency`
                    : "Database connection failed"
                }
                status={uncertain ? "unknown" : data.database.status}
              />
              <Service
                name="File storage"
                detail={
                  data.disk
                    ? `${bytes(data.disk.availableBytes)} available on uploads filesystem`
                    : "Storage capacity unavailable"
                }
                status={
                  uncertain || diskUsed === null
                    ? "unknown"
                    : diskUsed > 85
                      ? "attention"
                      : "healthy"
                }
              />
              <p className="monitor-note">
                Payment, SMS, and delivery providers are outside these checks.
              </p>
            </section>
            <section className="monitor-panel">
              <div className="monitor-panel-heading">
                <h2>Runtime & database</h2>
                <Database size={18} />
              </div>
              <dl className="monitor-runtime">
                <div>
                  <dt>Go runtime</dt>
                  <dd>{data.runtime.version}</dd>
                </div>
                <div>
                  <dt>Operating system</dt>
                  <dd>
                    {data.runtime.os} / {data.runtime.arch}
                  </dd>
                </div>
                <div>
                  <dt>Go heap</dt>
                  <dd>{bytes(data.runtime.heapBytes)}</dd>
                </div>
                <div>
                  <dt>Go reserved memory</dt>
                  <dd>{bytes(data.runtime.reservedBytes)}</dd>
                </div>
                <div>
                  <dt>Goroutines</dt>
                  <dd>{data.runtime.goroutines}</dd>
                </div>
                <div>
                  <dt>Idle DB connections</dt>
                  <dd>{data.database.idleConnections}</dd>
                </div>
              </dl>
              <p className="monitor-note">
                <MemoryStick size={13} /> Go memory is separate from system RAM
                usage. Started {stamp(data.startedAt)} (Tehran).
              </p>
            </section>
          </div>
          <footer className="monitor-footer">
            <p>
              Measurements belong to this API instance. Independent uptime
              monitoring is needed to detect a complete outage.
            </p>
            <Link href="/omnisire/events">
              Admin events <ArrowUpRight size={15} />
            </Link>
          </footer>
        </>
      )}
    </div>
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
      ? "Healthy"
      : status === "unknown"
        ? "Unknown"
        : status === "attention"
          ? "Low space"
          : "Unavailable";
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
