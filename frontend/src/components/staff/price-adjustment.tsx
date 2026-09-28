"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { api } from "@/lib/api";
import { digits, fa, money, packageLabel, packagePrice } from "@/lib/format";
import type { Product } from "@/lib/types";
import { PricingProductPicker } from "./pricing-product-picker";
import { ProductDiscountList } from "./product-discount-list";

export function PriceAdjustment({
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
  const [scope, setScope] = useState("selected");
  const [selected, setSelected] = useState<Product[]>([]);
  const [sample, setSample] = useState<Product[]>([]);
  const [targetCount, setTargetCount] = useState(0);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState("");
  const [direction, setDirection] = useState("increase");
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const lock = useRef(false);
  useEffect(() => onBusyChange(busy), [busy, onBusyChange]);
  useEffect(() => {
    let live = true;
    setCatalogLoading(true);
    setCatalogError("");
    api<{ items: Product[]; total: number }>(
      "/staff/product-options?page=1&pageSize=5",
    )
      .then((v) => {
        if (live) {
          setSample(v.items);
          setTargetCount(v.total);
        }
      })
      .catch((e) => {
        if (live) setCatalogError(e.message);
      })
      .finally(() => {
        if (live) setCatalogLoading(false);
      });
    return () => {
      live = false;
    };
  }, [products, revision]);
  const amount =
    Number(value.replace(/,/g, "")) *
    (mode === "adjust" ? 10 * (direction === "decrease" ? -1 : 1) : 1);
  const targets = scope === "all" ? sample : selected;
  const count = scope === "all" ? targetCount : selected.length;
  const invalid =
    mode === "adjust" &&
    targets.some((p) =>
      p.packages.some(
        (pack) =>
          pack.priceRials + amount <= 0 ||
          pack.priceRials + amount > 100000000000,
      ),
    );
  async function changed() {
    setSelected([]);
    setRevision((v) => v + 1);
    await reload();
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (
      lock.current ||
      busy ||
      !count ||
      invalid ||
      !value ||
      amount === 0 ||
      (scope === "all" && (catalogLoading || catalogError))
    )
      return;
    lock.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await api<{ count: number }>(
        mode === "discount" ? "/staff/product-discounts" : "/staff/pricing",
        "POST",
        mode === "discount"
          ? {
              id: crypto.randomUUID(),
              name: name.trim(),
              percent: amount,
              all: scope === "all",
              productIds: scope === "all" ? [] : selected.map((p) => p.id),
            }
          : {
              amount,
              ...(scope === "all"
                ? { all: true }
                : { productIds: selected.map((p) => p.id) }),
            },
      );
      setMessage(
        mode === "discount"
          ? `تخفیف برای ${fa(result.count)} محصول ساخته شد.`
          : `قیمت ${fa(result.count)} محصول به‌روز شد.`,
      );
      setValue("");
      setName("");
      try {
        await changed();
      } catch {
        setError("تغییر ذخیره شد، اما اطلاعات تازه دریافت نشد.");
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="stack">
      <form className="pricing-layout" onSubmit={submit}>
        <div className="form-card stack">
          <h3>
            {mode === "discount" ? "تخفیف روی محصولات" : "اصلاح قیمت پایه"}
          </h3>
          <fieldset className="product-step-fields stack" disabled={busy}>
            {mode === "discount" && (
              <label>
                نام تخفیف
                <input
                  required
                  maxLength={120}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="مثلاً تخفیف پاییزی"
                />
              </label>
            )}
            <div
              className="pricing-scope"
              role="group"
              aria-label="دامنه تغییر"
            >
              <button
                type="button"
                aria-pressed={scope === "selected"}
                onClick={() => setScope("selected")}
              >
                انتخاب یک یا چند محصول
              </button>
              <button
                type="button"
                aria-pressed={scope === "all"}
                onClick={() => setScope("all")}
              >
                همه محصولات
              </button>
            </div>
            {scope === "selected" ? (
              <PricingProductPicker
                key={revision}
                selected={selected}
                onChange={setSelected}
              />
            ) : (
              <div className="notice">
                {catalogLoading ? (
                  "در حال دریافت تعداد محصولات…"
                ) : catalogError ? (
                  <span role="alert">
                    {catalogError}{" "}
                    <button
                      type="button"
                      className="text-link"
                      onClick={() => setRevision(revision + 1)}
                    >
                      تلاش دوباره
                    </button>
                  </span>
                ) : (
                  `${fa(targetCount)} محصول فعلی و پیش‌نویس‌های آن‌ها انتخاب شده‌اند.`
                )}
                {mode === "discount" && (
                  <p>
                    محصولاتی که بعداً ساخته می‌شوند، به این گروه اضافه نمی‌شوند.
                  </p>
                )}
              </div>
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
              {mode === "discount"
                ? "درصد تخفیف"
                : "میزان تغییر هر بسته (تومان)"}
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
                  ? "بین ۱ تا ۹۰ درصد؛ برای حذف تخفیف از فهرست پایین استفاده کنید."
                  : "این مبلغ به قیمت پایه همه بسته‌های محصولات انتخاب‌شده اعمال می‌شود."}
              </small>
            </label>
          </fieldset>
          {invalid && (
            <p role="alert" className="error">
              قیمت یک یا چند بسته خارج از محدوده مجاز می‌شود؛ مبلغ را اصلاح
              کنید.
            </p>
          )}
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          {message && (
            <p role="status" className="success">
              {message}
            </p>
          )}
          <button
            className="button"
            disabled={
              busy ||
              !count ||
              !value ||
              amount === 0 ||
              invalid ||
              (mode === "discount" && !name.trim()) ||
              (scope === "all" && (catalogLoading || !!catalogError))
            }
          >
            {busy
              ? "در حال ذخیره…"
              : `${mode === "discount" ? "ساخت تخفیف" : "اعمال تغییر قیمت"} برای ${fa(count)} محصول`}
            <ArrowLeft size={17} />
          </button>
        </div>
        <aside className="form-card stack pricing-preview">
          <h3>پیش‌نمایش قیمت</h3>
          <p>
            {mode === "discount"
              ? "قیمت پایه حفظ می‌شود. اگر محصول تخفیف بالاتری داشته باشد، همان تخفیف باقی می‌ماند."
              : "قیمت پایه بسته‌ها تغییر می‌کند و درصد تخفیف فعلی حفظ می‌شود."}
          </p>
          {!targets.length ? (
            <p className="muted">
              محصولات را انتخاب کنید تا قیمت‌ها را ببینید.
            </p>
          ) : (
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
                                        ? Math.max(
                                            p.discountPercent || 0,
                                            amount,
                                          )
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
          )}
          {count > 5 && (
            <p className="muted">نمایش نمونه ۵ محصول از {fa(count)} محصول.</p>
          )}
          {mode === "adjust" && (
            <p className="muted">
              پیش از ذخیره، قیمت تمام بسته‌ها و پیش‌نویس‌ها بررسی می‌شود؛ اگر
              حتی یک قیمت نامعتبر باشد، هیچ تغییری اعمال نمی‌شود.
            </p>
          )}
        </aside>
      </form>
      {mode === "discount" && (
        <ProductDiscountList
          revision={revision}
          busy={busy}
          onBusyChange={setBusy}
          onChanged={changed}
        />
      )}
    </div>
  );
}
