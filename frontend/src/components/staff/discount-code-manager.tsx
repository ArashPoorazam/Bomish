"use client";
import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Copy, Plus, TicketPercent, X } from "lucide-react";
import { api } from "@/lib/api";
import type { DiscountCode, DiscountCodeInput } from "@/lib/types";
import { date, digits, fa, money } from "@/lib/format";

export function DiscountCodeManager({
  onBusyChange,
}: {
  onBusyChange: (busy: boolean) => void;
}) {
  const [codes, setCodes] = useState<DiscountCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [creating, setCreating] = useState(false);
  useEffect(
    () => onBusyChange(!!busy || creating),
    [busy, creating, onBusyChange],
  );
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  async function load() {
    try {
      setCodes(await api<DiscountCode[]>("/staff/discount-codes"));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  return (
    <div className="stack">
      <div className="form-card discount-code-intro">
        <div>
          <h3>کدهای تخفیف خرید</h3>
          <p>
            مشتری کد را در مرحله تکمیل خرید وارد می‌کند. تخفیف روی قیمت فعلی
            محصولات محاسبه می‌شود و هزینه ارسال را تغییر نمی‌دهد.
          </p>
        </div>
        <button
          className="button"
          disabled={!!busy}
          onClick={() => {
            setMessage("");
            dialog.current?.showModal();
          }}
        >
          <Plus size={18} />
          کد تخفیف جدید
        </button>
      </div>
      <div className="form-card stack">
        <div className="between">
          <h3>
            کدهای شما <span className="badge">{fa(codes.length)}</span>
          </h3>
          <label className="code-search">
            <span className="sr-only">جستجوی کد تخفیف</span>
            <input
              type="search"
              aria-label="جستجوی کد تخفیف"
              placeholder="جستجوی کد…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        </div>
        {error && (
          <div role="alert" className="error">
            {error}
            <button className="button secondary" onClick={() => void load()}>
              تلاش دوباره
            </button>
          </div>
        )}
        {message && (
          <p className="success" role="status">
            <CheckCircle2 size={18} /> {message}
          </p>
        )}
        {loading ? (
          <p role="status">در حال دریافت کدها…</p>
        ) : (
          <div className="discount-code-list">
            {codes
              .filter((c) => c.code.includes(query.trim().toUpperCase()))
              .map((c) => {
                const expired =
                  c.expiresAt && Date.parse(c.expiresAt) <= Date.now();
                const full =
                  c.maxUses > 0 && c.usedCount + c.reservedCount >= c.maxUses;
                return (
                  <article className="discount-code-card" key={c.code}>
                    <div className="between">
                      <div className="code-title">
                        <TicketPercent size={24} />
                        <strong dir="ltr">{c.code}</strong>
                        <button
                          className="button secondary copy-code"
                          aria-label={`کپی کد ${c.code}`}
                          onClick={async () => {
                            try {
                              await navigator.clipboard.writeText(c.code);
                              setMessage("کد تخفیف کپی شد.");
                            } catch {
                              setError(
                                "کپی خودکار ممکن نشد؛ متن کد را انتخاب و کپی کنید.",
                              );
                            }
                          }}
                        >
                          <Copy size={15} />
                        </button>
                      </div>
                      <span
                        className={`badge ${!c.active || expired || full ? "draft-badge" : ""}`}
                      >
                        {!c.active
                          ? "غیرفعال"
                          : expired
                            ? "پایان‌یافته"
                            : full
                              ? "ظرفیت تکمیل"
                              : "فعال"}
                      </span>
                    </div>
                    <h4>
                      {c.kind === "percent"
                        ? `${fa(c.value)}٪ تخفیف`
                        : `${money(c.value)} تومان تخفیف`}
                    </h4>
                    <dl>
                      <div>
                        <dt>حداقل خرید</dt>
                        <dd>
                          {c.minSubtotalRials
                            ? `${money(c.minSubtotalRials)} تومان`
                            : "بدون حداقل"}
                        </dd>
                      </div>
                      <div>
                        <dt>سقف تخفیف</dt>
                        <dd>
                          {c.maxDiscountRials
                            ? `${money(c.maxDiscountRials)} تومان`
                            : c.kind === "fixed"
                              ? `${money(c.value)} تومان`
                              : "بدون سقف"}
                        </dd>
                      </div>
                      <div>
                        <dt>زمان پایان</dt>
                        <dd>
                          {c.expiresAt ? date(c.expiresAt) : "بدون انقضا"}
                        </dd>
                      </div>
                      <div>
                        <dt>استفاده موفق</dt>
                        <dd>
                          {fa(c.usedCount)}
                          {c.maxUses ? ` از ${fa(c.maxUses)}` : " · نامحدود"}
                        </dd>
                      </div>
                    </dl>
                    {c.reservedCount > 0 && (
                      <small className="muted">
                        {fa(c.reservedCount)} سفارش در انتظار پرداخت؛ این تعداد
                        موقتاً از ظرفیت کم شده است.
                      </small>
                    )}
                    <button
                      className={`button ${c.active ? "secondary" : ""}`}
                      disabled={!!busy || !!expired}
                      onClick={async () => {
                        setBusy(c.code);
                        setError("");
                        setMessage("");
                        try {
                          await api(
                            `/staff/discount-codes/${encodeURIComponent(c.code)}`,
                            "PATCH",
                            { active: !c.active },
                          );
                          setCodes((items) =>
                            items.map((item) =>
                              item.code === c.code
                                ? { ...item, active: !item.active }
                                : item,
                            ),
                          );
                          setMessage(
                            c.active
                              ? "کد غیرفعال شد؛ سفارش‌های ثبت‌شده تغییری نمی‌کنند."
                              : "کد فعال شد.",
                          );
                        } catch (e) {
                          setError((e as Error).message);
                        } finally {
                          setBusy("");
                        }
                      }}
                    >
                      {busy === c.code
                        ? "در حال ذخیره…"
                        : c.active
                          ? "غیرفعال کردن کد"
                          : "فعال کردن کد"}
                    </button>
                  </article>
                );
              })}
          </div>
        )}
        {!loading && !codes.length && !error && (
          <div className="product-empty">
            <TicketPercent size={36} />
            <h4>اولین کد تخفیف را بسازید</h4>
            <p>مثلاً WELCOME10 برای خوشامدگویی به مشتری‌ها.</p>
          </div>
        )}
        {!loading &&
          codes.length > 0 &&
          !codes.some((c) => c.code.includes(query.trim().toUpperCase())) && (
            <p className="empty-state">کدی با این عبارت پیدا نشد.</p>
          )}
      </div>
      <dialog
        ref={dialog}
        className="discount-code-dialog"
        aria-labelledby="new-code-title"
        onCancel={(e) => {
          if (creating) e.preventDefault();
        }}
      >
        <CodeForm
          onBusyChange={setCreating}
          onClose={() => dialog.current?.close()}
          onCreated={(code) => {
            setCodes((items) => [code, ...items]);
            setMessage(`کد ${code.code} ساخته شد و آماده استفاده است.`);
            dialog.current?.close();
          }}
        />
      </dialog>
    </div>
  );
}
function CodeForm({
  onClose,
  onCreated,
  onBusyChange,
}: {
  onClose: () => void;
  onCreated: (code: DiscountCode) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const form = useRef<HTMLFormElement>(null);
  const [kind, setKind] = useState<"percent" | "fixed">("percent");
  const [busy, setBusy] = useState(false);
  useEffect(() => onBusyChange(busy), [busy, onBusyChange]);
  const [error, setError] = useState("");
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const data = new FormData(e.currentTarget);
    const number = (name: string) =>
      Number(digits(String(data.get(name) || "").replace(/[,٬،\s]/g, "")));
    const end = String(data.get("expiry") || "");
    const payload: DiscountCodeInput = {
      code: String(data.get("code") || "")
        .trim()
        .toUpperCase(),
      kind,
      value: number("value") * (kind === "fixed" ? 10 : 1),
      minSubtotalRials: number("minimum") * 10,
      maxDiscountRials: kind === "percent" ? number("cap") * 10 : 0,
      maxUses: number("limit"),
      expiresAt: end ? new Date(end).toISOString() : null,
    };
    try {
      const code = await api<DiscountCode>(
        "/staff/discount-codes",
        "POST",
        payload,
      );
      form.current?.reset();
      setKind("percent");
      onCreated(code);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form ref={form} className="stack" onSubmit={submit}>
      <div className="between">
        <div>
          <span className="eyebrow">یک پیشنهاد تازه</span>
          <h2 id="new-code-title">کد تخفیف جدید</h2>
        </div>
        <button
          type="button"
          className="button secondary"
          aria-label="بستن فرم کد تخفیف"
          disabled={busy}
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </div>
      <fieldset className="product-step-fields stack" disabled={busy}>
        <label>
          کد تخفیف
          <input
            name="code"
            aria-label="کد تخفیف"
            required
            minLength={3}
            maxLength={32}
            pattern="[A-Za-z0-9][A-Za-z0-9_-]{2,31}"
            placeholder="WELCOME10"
            dir="ltr"
            autoComplete="off"
            style={{ textTransform: "uppercase" }}
          />
          <small className="muted">
            ۳ تا ۳۲ حرف انگلیسی، عدد، خط تیره یا زیرخط؛ حروف کوچک و بزرگ تفاوتی
            ندارند.
          </small>
        </label>
        <div className="form-grid">
          <label>
            نوع تخفیف
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as typeof kind)}
            >
              <option value="percent">درصدی</option>
              <option value="fixed">مبلغ ثابت</option>
            </select>
          </label>
          <MoneyField
            key={kind}
            name="value"
            label={kind === "percent" ? "درصد تخفیف" : "مبلغ تخفیف (تومان)"}
            required
            max={kind === "percent" ? 90 : 10000000000}
          />
        </div>
        <details>
          <summary>شرایط استفاده · اختیاری</summary>
          <div className="form-grid">
            <MoneyField name="minimum" label="حداقل خرید (تومان)" />
            {kind === "percent" && (
              <MoneyField name="cap" label="سقف تخفیف (تومان)" />
            )}
            <MoneyField
              name="limit"
              label="حداکثر تعداد استفاده"
              max={1000000000}
            />
            <label>
              زمان پایان
              <input type="datetime-local" name="expiry" />
              <small className="muted">
                بر اساس ساعت دستگاه شما؛ خالی یعنی بدون انقضا.
              </small>
            </label>
          </div>
        </details>
        <p className="notice">
          هر سفارش یک کد می‌پذیرد. تخفیف روی قیمت فعلی محصولات اعمال می‌شود،
          حداکثر تا مبلغ محصولات؛ هزینه ارسال شامل تخفیف نیست.
        </p>
      </fieldset>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <button className="button" disabled={busy}>
        {busy ? "در حال ساخت…" : "ساخت کد تخفیف"}
        <Plus size={18} />
      </button>
    </form>
  );
}
function MoneyField({
  name,
  label,
  required,
  max = 10000000000,
}: {
  name: string;
  label: string;
  required?: boolean;
  max?: number;
}) {
  return (
    <label>
      {label}
      <input
        name={name}
        required={required}
        inputMode="numeric"
        dir="ltr"
        pattern="[0-9,]+"
        placeholder={required ? "" : "بدون محدودیت"}
        onInput={(e) => {
          const input = e.currentTarget;
          const value = digits(input.value.replace(/[,٬،\s]/g, ""));
          if (/^\d*$/.test(value)) {
            input.value = value ? Number(value).toLocaleString("en-US") : "";
            input.setCustomValidity(
              Number(value) > max || (required && Number(value) < 1)
                ? "مقدار واردشده خارج از محدوده مجاز است."
                : "",
            );
          } else {
            input.setCustomValidity("فقط عدد وارد کنید.");
          }
        }}
      />
    </label>
  );
}
