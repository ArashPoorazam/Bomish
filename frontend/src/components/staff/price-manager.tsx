"use client";
import { useEffect, useState } from "react";
import {
  BadgePercent,
  Coins,
  TicketPercent,
  ArrowLeft,
  CheckCircle2,
} from "lucide-react";
import { api } from "@/lib/api";
import type { Product } from "@/lib/types";
import { digits, fa, money, packageLabel, packagePrice } from "@/lib/format";
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
      <div className="between">
        <div>
          <span className="eyebrow">مدیریت فروش</span>
          <h2>قیمت و تخفیف</h2>
          <p>قیمت بسته‌ها، تخفیف ویترین و کدهای خرید را مدیریت کنید.</p>
        </div>
      </div>
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
function PriceAdjustment({
  products,
  reload,
  mode,
  onBusyChange,
}: {
  products: Product[];
  reload: () => Promise<void>;
  mode: "discount" | "adjust";
  onBusyChange: (busy: boolean) => void;
}) {
  const [scope, setScope] = useState("one");
  const [id, setID] = useState("");
  const [direction, setDirection] = useState("increase");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => onBusyChange(busy), [busy, onBusyChange]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const amount =
    Number(value.replace(/,/g, "")) *
    (mode === "adjust" ? 10 * (direction === "decrease" ? -1 : 1) : 1);
  const targets =
    scope === "all" ? products : products.filter((p) => p.id === id);
  const invalid =
    mode === "adjust" &&
    targets.some((p) =>
      p.packages.some(
        (pack) =>
          pack.priceRials + amount <= 0 ||
          pack.priceRials + amount > 100000000000,
      ),
    );
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!targets.length || invalid) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await api<{ count: number }>("/staff/pricing", "POST", {
        productId: scope === "all" ? "" : id,
        mode,
        amount,
      });
      setMessage(
        `${mode === "discount" ? "تخفیف" : "قیمت"} ${fa(result.count)} محصول به‌روز شد.`,
      );
      try {
        await reload();
      } catch {
        setError(
          "تغییر ذخیره شد، اما فهرست تازه دریافت نشد. صفحه را دوباره باز کنید.",
        );
      }
      setValue("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="pricing-layout" onSubmit={submit}>
      <div className="form-card stack">
        <h3>
          {mode === "discount" ? "تخفیف روی محصولات" : "تغییر قیمت بسته‌ها"}
        </h3>
        <fieldset className="product-step-fields stack" disabled={busy}>
          <label>
            دامنه تغییر
            <select value={scope} onChange={(e) => setScope(e.target.value)}>
              <option value="one">یک محصول مشخص</option>
              <option value="all">همه محصولات</option>
            </select>
          </label>
          {scope === "one" && (
            <label>
              انتخاب محصول
              <select
                required
                value={id}
                onChange={(e) => setID(e.target.value)}
              >
                <option value="">محصول را انتخاب کنید</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {mode === "adjust" && (
            <label>
              نوع تغییر
              <select
                value={direction}
                onChange={(e) => setDirection(e.target.value)}
              >
                <option value="increase">افزایش قیمت</option>
                <option value="decrease">کاهش قیمت</option>
              </select>
            </label>
          )}
          <label>
            {mode === "discount" ? "درصد تخفیف" : "میزان تغییر هر بسته (تومان)"}
            <input
              required
              aria-label={
                mode === "discount"
                  ? "درصد تخفیف"
                  : "میزان تغییر هر بسته (تومان)"
              }
              inputMode="numeric"
              dir="ltr"
              placeholder={mode === "discount" ? "15" : "20,000"}
              value={value}
              onChange={(e) => {
                const raw = digits(e.target.value.replace(/[,٬،\s]/g, ""));
                if (
                  /^\d*$/.test(raw) &&
                  Number(raw) <= (mode === "discount" ? 90 : 10000000000)
                )
                  setValue(raw ? Number(raw).toLocaleString("en-US") : "");
              }}
            />
            <small className="muted">
              {mode === "discount"
                ? "از ۰ تا ۹۰ درصد؛ با صفر، تخفیف قبلی حذف می‌شود."
                : "این مبلغ به قیمت پایه تمام بسته‌های انتخاب‌شده اعمال می‌شود."}
            </small>
          </label>
        </fieldset>
        {invalid && (
          <p role="alert" className="error">
            قیمت یک یا چند بسته صفر یا منفی می‌شود. مبلغ کاهش را کمتر کنید.
          </p>
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {message && (
          <p role="status" className="success">
            <CheckCircle2 size={18} /> {message}
          </p>
        )}
        <button
          className="button"
          disabled={busy || !targets.length || value === "" || invalid}
        >
          {busy
            ? "در حال اعمال…"
            : `اعمال ${mode === "discount" ? "تخفیف" : "تغییر قیمت"} روی ${fa(targets.length)} محصول`}
          <ArrowLeft size={17} />
        </button>
      </div>
      <aside className="form-card stack pricing-preview">
        <span className="eyebrow">پیش از اعمال بررسی کنید</span>
        <h3>نتیجه تغییر</h3>
        <p>
          {mode === "discount"
            ? "قیمت پایه حفظ می‌شود و مشتری قیمت تخفیف‌خورده را می‌بیند. درصد جدید جایگزین تخفیف قبلی است."
            : "قیمت پایه تغییر می‌کند؛ درصد تخفیف فعلی محصول حفظ می‌شود."}
        </p>
        {!targets.length ? (
          <div className="product-empty">
            <Coins size={30} />
            <p>محصولی انتخاب کنید تا قیمت‌ها را ببینید.</p>
          </div>
        ) : (
          <>
            <div className="pricing-preview-list">
              {targets.slice(0, 5).map((p) => (
                <section key={p.id}>
                  <h4>{p.name}</h4>
                  {p.packages.map((pack) => (
                    <div className="price-comparison" key={pack.id}>
                      <span>{packageLabel(pack)}</span>
                      <div>
                        <span className="muted">
                          {money(packagePrice(p, pack))}
                        </span>
                        <ArrowLeft size={14} />
                        <strong>
                          {money(
                            value === ""
                              ? packagePrice(p, pack)
                              : packagePrice(
                                  {
                                    ...p,
                                    discountPercent:
                                      mode === "discount"
                                        ? amount
                                        : p.discountPercent,
                                  },
                                  {
                                    ...pack,
                                    priceRials:
                                      mode === "adjust"
                                        ? Math.max(0, pack.priceRials + amount)
                                        : pack.priceRials,
                                  },
                                ),
                          )}{" "}
                          تومان
                        </strong>
                      </div>
                    </div>
                  ))}
                </section>
              ))}
            </div>
            {targets.length > 5 && (
              <p className="muted">و {fa(targets.length - 5)} محصول دیگر</p>
            )}
            <p className="notice">
              {scope === "all"
                ? "این تغییر روی همه محصولات و پیش‌نویس‌های آن‌ها اعمال می‌شود."
                : "این تغییر روی محصول و پیش‌نویس آن اعمال می‌شود."}
            </p>
          </>
        )}
      </aside>
    </form>
  );
}
