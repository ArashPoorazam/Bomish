"use client";
import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "@/hooks/use-live-query";
import { useStore } from "../store-provider";
import type { components } from "@/lib/api-types";
export type NotificationCounts = components["schemas"]["NotificationCounts"];
export function useRequestNotifications() {
  const { user } = useStore();
  const allowed = !!user?.permissions?.some(
    (p) => p === "orders" || p === "requests",
  );
  const result = useLiveQuery<NotificationCounts>(
    "/staff/notifications",
    allowed,
  );
  useEffect(() => {
    const load = () => {
      void result.refresh();
    };
    window.addEventListener("bomish:notifications", load);
    return () => window.removeEventListener("bomish:notifications", load);
  }, [result.refresh]);
  return { ...result, allowed };
}
export function NotificationSound({
  counts,
}: {
  counts: NotificationCounts | null;
}) {
  const [enabled, setEnabled] = useState(false);
  const audio = useRef<AudioContext | null>(null),
    previous = useRef<NotificationCounts | null>(null);
  useEffect(
    () => () => {
      void audio.current?.close().catch(() => {});
    },
    [],
  );
  useEffect(() => {
    if (
      counts &&
      previous.current &&
      enabled &&
      (["supportEvent", "customEvent", "orderEvent"] as const).some(
        (key) => counts[key] > previous.current![key],
      )
    ) {
      const context = audio.current;
      if (context?.state === "running") {
        try {
          const oscillator = context.createOscillator(),
            gain = context.createGain();
          oscillator.connect(gain);
          gain.connect(context.destination);
          oscillator.frequency.value = 660;
          gain.gain.setValueAtTime(0.08, context.currentTime);
          gain.gain.exponentialRampToValueAtTime(
            0.001,
            context.currentTime + 0.3,
          );
          oscillator.start();
          oscillator.stop(context.currentTime + 0.3);
        } catch {
          /* Audio failures must not interrupt notification updates. */
        }
      }
    }
    previous.current = counts;
  }, [counts, enabled]);
  return (
    <button
      className="notification-sound"
      aria-pressed={enabled}
      onClick={async () => {
        if (enabled) {
          setEnabled(false);
          return;
        }
        try {
          audio.current ||= new AudioContext();
          await audio.current.resume();
          setEnabled(true);
        } catch {
          setEnabled(false);
        }
      }}
    >
      {enabled ? "صدای اعلان روشن است" : "فعال‌کردن صدای اعلان"}
    </button>
  );
}
