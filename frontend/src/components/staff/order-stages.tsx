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
  const active = stopped || current === stages.length - 1 ? -1 : current + 1;
  const actionLabel =
    order.status === "pending"
      ? "در انتظار پرداخت"
      : order.status === "shipped"
        ? "در انتظار تحویل"
        : "اقدام اکنون";
  return (
    <span
      className={`staff-order-stages ${stopped ? "is-stopped" : ""} ${expanded ? "is-expanded" : ""}`}
      role="img"
      aria-label={`وضعیت سفارش: ${statuses[order.status] || order.status}${active >= 0 ? `؛ مرحله بعد: ${stages[active].label}` : ""}`}
    >
      {stages.map(({ id, label, icon: Icon }, index) => (
        <span
          key={id}
          className={`staff-order-stage ${index <= reached ? "is-done" : ""} ${index === active ? "is-current" : ""}`}
          aria-hidden="true"
        >
          <span className="staff-stage-dot">
            {index <= reached ? (
              <Check size={expanded ? 30 : 11} strokeWidth={2.5} />
            ) : expanded ? (
              <Icon size={30} strokeWidth={1.7} />
            ) : null}
          </span>
          <span>{label}</span>
          {expanded && (
            <small className="staff-stage-state">
              {index <= reached
                ? "انجام شد"
                : index === active
                  ? actionLabel
                  : "در انتظار"}
            </small>
          )}
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
