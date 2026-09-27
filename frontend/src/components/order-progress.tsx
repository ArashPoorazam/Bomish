"use client";
import { useEffect, useState } from "react";
import { Check, Package, Truck, House, ShoppingBag } from "lucide-react";
import type { Order } from "@/lib/types";
import { date } from "@/lib/format";
import { api } from "@/lib/api";
export const stages = [
  { id: "paid", label: "خرید ثبت شد", icon: ShoppingBag },
  { id: "packing", label: "بسته‌بندی شد", icon: Package },
  { id: "shipped", label: "ارسال شد", icon: Truck },
  { id: "received", label: "تحویل شد", icon: House },
];
export function OrderProgress({
  order,
  trackingUrl,
}: {
  order: Order;
  trackingUrl?: string;
}) {
  const [support, setSupport] = useState(""),
    [copied, setCopied] = useState("");
  const index = stages.findIndex((x) => x.id === order.status);
  useEffect(() => {
    api<{ supportUrl: string }>("/settings")
      .then((x) => setSupport(x.supportUrl))
      .catch(() => {});
  }, []);
  if (index < 0) return null;
  return (
    <div className="order-progress">
      <ol className="order-timeline">
        {stages.map((s, i) => {
          const Icon = s.icon,
            event = order.events?.find((e) => e.status === s.id);
          return (
            <li
              key={s.id}
              className={i <= index ? "complete" : ""}
              aria-current={i === index ? "step" : undefined}
            >
              <span className="stage-icon">
                {i < index ? <Check size={20} /> : <Icon size={20} />}
              </span>
              <strong>{s.label}</strong>
              <small>
                {event ? date(event.createdAt) : i > index ? "در انتظار" : ""}
              </small>
            </li>
          );
        })}
      </ol>
      {order.tracking && (
        <div className="tracking-box">
          <span>کد رهگیری مرسوله</span>
          <strong dir="ltr">{order.tracking}</strong>
          <div className="inline-actions">
            <button
              className="button secondary"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(order.tracking);
                  setCopied("کد کپی شد");
                } catch {
                  setCopied("کد را انتخاب و کپی کنید");
                }
              }}
            >
              کپی کد
            </button>
            <a
              className="button"
              href={
                trackingUrl ||
                "https://pishkhan24.com/posttracking/?barcode=" +
                  encodeURIComponent(order.tracking)
              }
              target="_blank"
              rel="noopener noreferrer"
            >
              پیگیری در پیشخوان ۲۴
            </a>
          </div>
          <small role="status">{copied}</small>
        </div>
      )}
      {support && (
        <a
          className="support-link"
          href={support}
          target="_blank"
          rel="noopener noreferrer"
        >
          برای این سفارش کمک می‌خواهید؟ گفتگو با پشتیبانی ←
        </a>
      )}
    </div>
  );
}
