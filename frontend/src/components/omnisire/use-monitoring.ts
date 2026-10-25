"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { components } from "@/lib/api-types";

export type MonitoringSnapshot = components["schemas"]["ServerMonitoring"];

export function useMonitoring() {
  const [data, setData] = useState<MonitoringSnapshot | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [paused, setPaused] = useState(false);
  const [revision, setRevision] = useState(0);
  const [receivedAt, setReceivedAt] = useState(0);
  const [now, setNow] = useState(0);

  useEffect(() => {
    let disposed = false;
    let controller: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      if (document.hidden || disposed) return;
      controller?.abort();
      const request = new AbortController();
      controller = request;
      const timeout = setTimeout(() => request.abort(), 12000);
      setLoading(true);
      try {
        const snapshot = await api<MonitoringSnapshot>(
          "/omnisire/monitoring",
          "GET",
          undefined,
          request.signal,
        );
        if (!disposed && controller === request) {
          setData(snapshot);
          setError("");
          setReceivedAt(Date.now());
          setNow(Date.now());
        }
      } catch {
        if (!disposed && controller === request)
          setError("ارتباط با سرور برقرار نشد. وضعیت فعلی قابل تأیید نیست.");
      } finally {
        clearTimeout(timeout);
        if (!disposed && controller === request) {
          setLoading(false);
          if (!paused) timer = setTimeout(poll, 15000);
        }
      }
    };
    const visibility = () => {
      clearTimeout(timer);
      if (!document.hidden && !paused) void poll();
    };
    void poll();
    document.addEventListener("visibilitychange", visibility);
    const clock = setInterval(() => setNow(Date.now()), 5000);
    return () => {
      disposed = true;
      controller?.abort();
      clearTimeout(timer);
      clearInterval(clock);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [revision, paused]);

  return {
    data,
    error,
    loading,
    paused,
    setPaused,
    refresh: () => setRevision((n) => n + 1),
    stale: !!data && (!!error || now - receivedAt > 45000),
  };
}
