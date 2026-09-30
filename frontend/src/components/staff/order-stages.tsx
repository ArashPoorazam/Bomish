import { Check } from "lucide-react";
import type { Order } from "@/lib/types";
import { statuses } from "@/lib/format";
import { orderStages as stages } from "@/lib/order-stages";
export function StaffOrderStages({
  order,
  expanded = false,
}: {
  order: Order;
  expanded?: boolean;
}) {
  const current = stages.findIndex(({ id }) => id === order.status);
  const stopped = current < 0;
  const reached = stopped
    ? Math.max(
        0,
        ...order.events.map((event) =>
          stages.findIndex(({ id }) => id === event.status),
        ),
      )
    : current;
  return (
    <span
      className={`staff-order-stages ${stopped ? "is-stopped" : ""} ${expanded ? "is-expanded" : ""}`}
      role="img"
      aria-label={`وضعیت سفارش: ${statuses[order.status] || order.status}`}
    >
      {stages.map(({ id, label, icon: Icon }, index) => (
        <span
          key={id}
          className={`staff-order-stage ${index <= reached ? "is-done" : ""} ${!stopped && index === current ? "is-current" : ""}`}
          aria-hidden="true"
        >
          <span className="staff-stage-dot">
            {expanded ? (
              <Icon size={30} strokeWidth={1.7} />
            ) : index < reached || current === 4 ? (
              <Check size={11} />
            ) : null}
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
