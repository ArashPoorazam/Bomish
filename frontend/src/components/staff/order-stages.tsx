import { Check } from "lucide-react";
import type { Order } from "@/lib/types";
import { statuses } from "@/lib/format";
const stages = [
  ["pending", "ثبت سفارش"],
  ["paid", "پرداخت"],
  ["packing", "بسته‌بندی"],
  ["shipped", "ارسال"],
  ["received", "تحویل"],
] as const;
export function StaffOrderStages({ order }: { order: Order }) {
  const current = stages.findIndex(([id]) => id === order.status);
  const stopped = current < 0;
  const reached = stopped
    ? Math.max(
        0,
        ...order.events.map((event) =>
          stages.findIndex(([id]) => id === event.status),
        ),
      )
    : current;
  return (
    <span
      className={`staff-order-stages ${stopped ? "is-stopped" : ""}`}
      role="img"
      aria-label={`وضعیت سفارش: ${statuses[order.status] || order.status}`}
    >
      {stages.map(([id, label], index) => (
        <span
          key={id}
          className={`staff-order-stage ${index <= reached ? "is-done" : ""} ${!stopped && index === current ? "is-current" : ""}`}
          aria-hidden="true"
        >
          <span className="staff-stage-dot">
            {index < reached || current === 4 ? <Check size={11} /> : null}
          </span>
          <span>{label}</span>
        </span>
      ))}
    </span>
  );
}
export const orderStamp = (value: string) =>
  new Intl.DateTimeFormat("fa-IR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Tehran",
  }).format(new Date(value));
