"use client";
import { useEffect, useState } from "react";
import { BadgePercent, Coins, TicketPercent } from "lucide-react";
import type { Product } from "@/lib/types";
import { PriceAdjustment } from "./price-adjustment";
import { DiscountCodeManager } from "./discount-code-manager";

export function PriceManager({
  products,
  reload,
  onStateChange,
}: {
  products: Product[];
  reload: () => Promise<void>;
  onStateChange: (state: { dirty: boolean; busy: boolean }) => void;
}) {
  const [tab, setTab] = useState<"discount" | "adjust" | "codes">("discount");
  const [busy, setBusy] = useState(false);
  useEffect(() => onStateChange({ dirty: false, busy }), [busy, onStateChange]);
  return (
    <div className="pricing-workspace stack">
      <div
        className="pricing-tabs"
        role="tablist"
        aria-label="ابزارهای قیمت و تخفیف"
      >
        {(
          [
            [
              "discount",
              "تخفیف محصولات",
              "تخفیف قابل نمایش در فروشگاه",
              BadgePercent,
            ],
            ["adjust", "اصلاح قیمت پایه", "افزایش یا کاهش قیمت بسته‌ها", Coins],
            [
              "codes",
              "کدهای تخفیف",
              "کد قابل استفاده هنگام خرید",
              TicketPercent,
            ],
          ] as const
        ).map(([key, title, subtitle, Icon]) => (
          <button
            role="tab"
            disabled={busy}
            tabIndex={tab === key ? 0 : -1}
            aria-selected={tab === key}
            aria-controls={`pricing-panel-${key}`}
            id={`pricing-tab-${key}`}
            key={key}
            onClick={() => setTab(key)}
            onKeyDown={(e) => {
              const keys = ["discount", "adjust", "codes"] as const;
              const index = keys.indexOf(key);
              const next =
                e.key === "ArrowLeft"
                  ? (index + 1) % 3
                  : e.key === "ArrowRight"
                    ? (index + 2) % 3
                    : e.key === "Home"
                      ? 0
                      : e.key === "End"
                        ? 2
                        : -1;
              if (next >= 0) {
                e.preventDefault();
                setTab(keys[next]);
                document.getElementById(`pricing-tab-${keys[next]}`)?.focus();
              }
            }}
          >
            <Icon size={24} />
            <span>
              <strong>{title}</strong>
              <small>{subtitle}</small>
            </span>
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={`pricing-panel-${tab}`}
        aria-labelledby={`pricing-tab-${tab}`}
      >
        {tab === "codes" ? (
          <DiscountCodeManager onBusyChange={setBusy} />
        ) : (
          <PriceAdjustment
            key={tab}
            products={products}
            reload={reload}
            mode={tab}
            onBusyChange={setBusy}
          />
        )}
      </div>
    </div>
  );
}
