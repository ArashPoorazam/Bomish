"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";

// One request at a time; failures preserve the last successful view. Hidden tabs
// pause polling and refresh immediately when brought back to the foreground.
export function useLiveQuery<T>(url: string, enabled = true, interval = 10000) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const runner = useRef<() => Promise<void>>(async () => {});
  const refresh = useCallback(() => runner.current(), []);
  useEffect(() => {
    let live = true;
    const controller = new AbortController();
    let pending: Promise<void> | null = null;
    setData(null);
    setError("");
    setLoading(false);
    const load = (): Promise<void> => {
      if (!enabled || !live) return Promise.resolve();
      if (pending) return pending;
      setLoading(true);
      pending = api<T>(url, "GET", undefined, controller.signal)
        .then((value) => {
          if (live) {
            setData(value);
            setError("");
          }
        })
        .catch((e: Error) => {
          if (live) setError(e.message);
        })
        .finally(() => {
          pending = null;
          if (live) setLoading(false);
        });
      return pending;
    };
    runner.current = load;
    if (interval === 0 || document.visibilityState === "visible") void load();
    const visible = () => {
      if (document.visibilityState === "visible") void load();
    };
    const timer =
      interval > 0 && enabled
        ? window.setInterval(visible, interval)
        : undefined;
    if (interval > 0) document.addEventListener("visibilitychange", visible);
    return () => {
      live = false;
      controller.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [url, enabled, interval]);
  return { data, error, loading, refresh };
}
