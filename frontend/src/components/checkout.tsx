"use client";
import { CheckoutSteps } from "./checkout-steps";
import { ShippingLocalities } from "./shipping-address";
import { providerName } from "@/lib/shipping";
import { AddressMap } from "./address-map";
import { useRouter } from "next/navigation";
import { packageLabel, fa } from "@/lib/format";
import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import type { Address, Quote } from "@/lib/types";
import { useStore } from "./store-provider";
import { money, digits } from "@/lib/format";
import { CheckCircle2, ArrowLeft, TicketPercent } from "lucide-react";
const blank: Address = {
  id: "",
  recipient: "",
  phone: "",
  province: "تهران",
  city: "",
  street: "",
  postalCode: "",
};

export function Checkout() {
  const { user } = useStore();
  if (!user) return <p className="container section">در حال دریافت اطلاعات…</p>;
  if (user.catalogOnly)
    return (
      <div className="container section">
        <h1>فروش آنلاین به‌زودی</h1>
        <p>در حال حاضر می‌توانید محصولات و قیمت‌ها را مشاهده کنید.</p>
        <Link href="/products">مشاهده محصولات</Link>
      </div>
    );
  return <CommerceCheckout />;
}
function CommerceCheckout() {
  const router = useRouter();
  const { cart, user, refresh } = useStore();
  useEffect(() => {
    if (user && !user.authenticated) {
      router.replace("/login?next=/checkout");
    }
  }, [user, router]);
  const [address, setAddress] = useState<Address>(blank),
    [saved, setSaved] = useState<Address[]>([]),
    [save, setSave] = useState(true),
    [quote, setQuote] = useState<Quote | null>(null),
    [orderId, setOrderId] = useState(""),
    [outcome, setOutcome] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [key, setKey] = useState("");
  const [quoteBusy, setQuoteBusy] = useState(false),
    [quoteRetry, setQuoteRetry] = useState(0);
  const quoteSequence = useRef(0);
  const [codeInput, setCodeInput] = useState("");
  const [appliedCode, setAppliedCode] = useState("");
  const [codeError, setCodeError] = useState("");
  const cartSnapshot = JSON.stringify(
    cart.items.map((item) => [
      item.product.id,
      item.package.id,
      item.quantity,
      item.totalRials,
    ]),
  );
  useEffect(() => {
    if (!orderId) {
      setQuote(null);
      setKey(crypto.randomUUID());
    }
  }, [cartSnapshot, orderId]);
  useEffect(() => {
    setKey(crypto.randomUUID());
  }, []);
  useEffect(() => {
    if (user?.authenticated)
      api<Address[]>("/addresses")
        .then(setSaved)
        .catch((e) => setError(e.message));
  }, [user?.authenticated]);
  function update(k: keyof Address, v: string) {
    setAddress((a) => ({
      ...a,
      [k]: v,
      ...(["city", "province"].includes(k) ? { pinConfirmed: false } : {}),
    }));
    setQuote(null);
    setKey(crypto.randomUUID());
  }
  const destinationKey = JSON.stringify(address);
  useEffect(() => {
    if (orderId) return;
    const sequence = ++quoteSequence.current;
    setQuote(null);
    setKey(crypto.randomUUID());
    if (
      !user?.authenticated ||
      !address.cityId ||
      !address.recipient ||
      address.street.length < 10 ||
      digits(address.postalCode).length !== 10
    ) {
      setQuoteBusy(false);
      return;
    }
    setQuoteBusy(true);
    const timer = setTimeout(() => {
      api<Quote>("/checkout/quote", "POST", {
        address,
        province: address.province,
        discountCode: appliedCode,
      })
        .then((q) => {
          if (sequence === quoteSequence.current) {
            setQuote(q);
            setError("");
          }
        })
        .catch((e) => {
          if (sequence === quoteSequence.current) setError(e.message);
        })
        .finally(() => {
          if (sequence === quoteSequence.current) setQuoteBusy(false);
        });
    }, 400);
    return () => {
      clearTimeout(timer);
      quoteSequence.current++;
    };
  }, [
    destinationKey,
    cartSnapshot,
    appliedCode,
    orderId,
    quoteRetry,
    user?.authenticated,
  ]);
  useEffect(() => {
    if (!quote?.expiresAt || orderId) return;
    const timer = setTimeout(
      () => {
        setQuote(null);
        setError("استعلام ارسال منقضی شد؛ هزینه را دوباره بررسی کنید.");
      },
      Math.max(0, Date.parse(quote.expiresAt) - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [quote, orderId]);
  function getQuote(e: React.FormEvent) {
    e.preventDefault();
    setQuoteRetry((n) => n + 1);
  }
  async function applyCode(remove = false) {
    if (busy || orderId) return;
    setBusy(true);
    setCodeError("");
    try {
      const next = remove ? "" : codeInput.trim().toUpperCase();
      const result = await api<Quote>("/checkout/quote", "POST", {
        province: address.province,
        address,
        discountCode: next,
      });
      // Only an address-validated quote can unlock placing the order.
      if (quote) setQuote(result);
      setAppliedCode(result.discountCode);
      setCodeInput(result.discountCode);
      setKey(crypto.randomUUID());
    } catch (e) {
      setCodeError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function createOrder() {
    if (
      !quote ||
      quote.requiresAcceptance ||
      quoteBusy ||
      (quote.expiresAt && Date.parse(quote.expiresAt) <= Date.now())
    )
      return;
    setBusy(true);
    setError("");
    try {
      const a = {
        ...address,
        phone: digits(address.phone),
        postalCode: digits(address.postalCode),
      };
      const response = await api<{ orderId: string }>("/checkout", "POST", {
        address: a,
        expectedTotalRials: quote.totalRials,
        idempotencyKey: key,
        discountCode: quote.discountCode,
        shippingQuoteId: quote.shippingQuoteId ?? "",
        method: quote.method ?? "",
      });
      setOrderId(response.orderId);
      if (save && !address.id) {
        try {
          await api("/addresses", "POST", a);
        } catch {
          setError("سفارش ساخته شد، اما نشانی در حساب ذخیره نشد.");
        }
      }
    } catch (e) {
      setError((e as Error).message);
      setQuote(null);
    } finally {
      setBusy(false);
    }
  }
  async function pay(success: boolean) {
    setBusy(true);
    setError("");
    try {
      const r = await api<{ status: string }>(
        `/orders/${orderId}/simulate`,
        "POST",
        { success },
      );
      setOutcome(r.status);
      if (r.status === "paid") router.push("/account/orders/" + orderId);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!user) return <div className="loading">در حال آماده‌سازی خرید…</div>;
  if (!user.authenticated)
    return (
      <div className="loading" role="status">
        در حال انتقال به صفحه ورود…
      </div>
    );
  if (outcome)
    return (
      <div className="container section">
        <div className="empty-state">
          <CheckCircle2 size={54} />
          <h1>
            {outcome === "paid"
              ? "سفارش شما ثبت شد"
              : outcome === "review"
                ? "پرداخت نیاز به بررسی دارد"
                : "پرداخت انجام نشد"}
          </h1>
          <p>
            {outcome === "paid"
              ? "پرداخت آزمایشی با موفقیت انجام شد. وضعیت سفارش را در حساب خود ببینید."
              : "می‌توانید وضعیت را در حساب خود بررسی کنید."}
          </p>
          <Link className="button" href="/account">
            دیدن سفارش‌ها
          </Link>
        </div>
      </div>
    );
  if (!cart.items.length && !orderId)
    return (
      <div className="container empty-state">
        <h1>سبد خرید خالی است</h1>
        <p>ابتدا محصولی انتخاب کنید.</p>
        <Link className="button" href="/products">
          دیدن محصولات
        </Link>
      </div>
    );
  return (
    <div className="container section checkout-page">
      <div className="page-heading checkout-heading">
        <span className="eyebrow">چند قدم تا یک طعم تازه</span>
        <h1>تکمیل خرید</h1>
        <p>نشانی را وارد کنید، هزینه نهایی را ببینید و سفارش را تأیید کنید.</p>
      </div>
      <CheckoutSteps payment={!!orderId} />
      <div className="checkout-layout">
        <div className="form-card">
          {orderId ? (
            <div className="stack">
              <h2>درگاه پرداخت آزمایشی</h2>
              <div className="dev-note">
                هیچ پولی جابه‌جا نمی‌شود. نتیجه پرداخت را برای آزمایش انتخاب
                کنید. مهلت پرداخت این سفارش ۱۵ دقیقه است.
              </div>
              <button
                className="button"
                disabled={busy}
                onClick={() => pay(true)}
              >
                شبیه‌سازی پرداخت موفق
              </button>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => pay(false)}
              >
                شبیه‌سازی پرداخت ناموفق
              </button>
            </div>
          ) : (
            <form onSubmit={getQuote} className="stack">
              <fieldset
                className="product-step-fields stack"
                disabled={busy}
                inert={busy}
              >
                <div className="checkout-form-heading">
                  <h2>سفارش را کجا بفرستیم؟</h2>
                  <p>اطلاعات گیرنده و نشانی دقیق تحویل را وارد کنید.</p>
                  <p>
                    روی محل خانه بزنید؛ استان، شهر و نشانی با نشان تکمیل
                    می‌شوند. پلاک و واحد را بررسی و اضافه کنید.
                  </p>
                </div>
                {saved.length > 0 ? (
                  <label>
                    نشانی‌های ذخیره‌شده
                    <select
                      value={address.id}
                      onChange={(e) => {
                        setAddress(
                          saved.find((a) => a.id === e.target.value) || blank,
                        );
                        setQuote(null);
                      }}
                    >
                      <option value="">نشانی جدید</option>
                      {saved.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.recipient} — {a.city}، {a.street}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                <div className="checkout-map">
                  <AddressMap
                    autoConfirm
                    showInstructions={false}
                    key={address.id || "new"}
                    address={address}
                    onChange={(v) => {
                      setAddress(v);
                      setQuote(null);
                    }}
                  />
                  <p className="muted">
                    با انتخاب موقعیت روی نقشه، استان و شهر تکمیل می‌شوند؛ در
                    صورت نیاز آن‌ها را اصلاح کنید.
                  </p>
                </div>
                <div className="form-grid">
                  <label>
                    نام گیرنده
                    <input
                      autoComplete="name"
                      required
                      value={address.recipient}
                      onChange={(e) => update("recipient", e.target.value)}
                    />
                  </label>
                  <label>
                    شماره همراه گیرنده
                    <input
                      type="tel"
                      autoComplete="tel"
                      required
                      value={address.phone}
                      onChange={(e) => update("phone", e.target.value)}
                    />
                  </label>
                </div>
                <ShippingLocalities
                  address={address}
                  onChange={setAddress}
                  showMapHint={false}
                />
                <div className="form-grid">
                  <label className="span-2">
                    نشانی کامل، پلاک و واحد
                    <textarea
                      autoComplete="street-address"
                      required
                      minLength={10}
                      value={address.street}
                      onChange={(e) => update("street", e.target.value)}
                    />
                  </label>
                  <label>
                    کد پستی
                    <input
                      inputMode="numeric"
                      autoComplete="postal-code"
                      required
                      minLength={10}
                      maxLength={10}
                      value={address.postalCode}
                      onChange={(e) => update("postalCode", e.target.value)}
                    />
                  </label>
                </div>
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={save}
                    onChange={(e) => setSave(e.target.checked)}
                  />
                  ذخیره نشانی برای خرید بعدی
                </label>
                <button className="button" disabled={busy}>
                  محاسبه هزینه ارسال <ArrowLeft size={18} />
                </button>
              </fieldset>
            </form>
          )}
          {error ? (
            <p className="error" role="alert">
              {error}
            </p>
          ) : null}
        </div>
        <aside className="form-card checkout-summary">
          <div className="checkout-summary-heading">
            <h2>خلاصه سفارش</h2>
            <span>
              {fa(cart.items.reduce((total, item) => total + item.quantity, 0))}{" "}
              بسته
            </span>
          </div>
          <section className="delivery-selection stack" aria-live="polite">
            <h3>روش ارسال</h3>
            {quoteBusy ? (
              <p>در حال دریافت هزینه ارسال…</p>
            ) : quote ? (
              <>
                <strong>
                  {quote.method === "snapp"
                    ? "ارسال با پیک در تهران"
                    : providerName(quote.method)}{" "}
                  · {quote.parcelCount} کارتن ارسال
                </strong>
                {quote.simulated && (
                  <span className="badge">شبیه‌سازی‌شده</span>
                )}
                <p>
                  {quote.method === "snapp"
                    ? "هزینه بر اساس نرخ اسنپ محاسبه می‌شود. پس از بسته‌بندی، سفارش با اسنپ یا پیک بومیش ارسال خواهد شد."
                    : "مرسوله پس از بسته‌بندی به پست سپرده می‌شود."}
                </p>
                {quote.fallbackReason && <p>{quote.fallbackReason}</p>}
                {quote.requiresAcceptance && (
                  <button
                    type="button"
                    className="button secondary"
                    disabled={busy || quoteBusy}
                    onClick={async () => {
                      const sequence = quoteSequence.current;
                      setQuoteBusy(true);
                      setError("");
                      try {
                        const accepted = await api<Quote>(
                          "/checkout/quote",
                          "POST",
                          {
                            address,
                            discountCode: appliedCode,
                            method: "post",
                            acceptFallback: true,
                            acceptedQuoteId: quote.shippingQuoteId,
                          },
                        );
                        if (sequence === quoteSequence.current)
                          setQuote(accepted);
                      } catch (e) {
                        if (sequence === quoteSequence.current) {
                          setError((e as Error).message);
                          setQuote(null);
                        }
                      } finally {
                        if (sequence === quoteSequence.current)
                          setQuoteBusy(false);
                      }
                    }}
                  >
                    ارسال با پست به مبلغ {money(quote.shippingRials)} تومان را
                    می‌پذیرم
                  </button>
                )}
                <small>
                  اعتبار تا{" "}
                  {quote.expiresAt
                    ? new Date(quote.expiresAt).toLocaleTimeString("fa-IR")
                    : "—"}
                </small>
              </>
            ) : (
              <p>هزینه ارسال پس از تکمیل نشانی مشخص می‌شود.</p>
            )}
            <button
              type="button"
              className="button secondary"
              disabled={quoteBusy}
              onClick={() => setQuoteRetry((n) => n + 1)}
            >
              محاسبه دوباره ارسال
            </button>
          </section>
          {cart.items.map((it) => (
            <div
              className="summary-line checkout-product"
              key={it.product.id + it.package.id}
            >
              <strong>
                {it.product.name}
                <small>
                  {packageLabel(it.package)} · {fa(it.quantity)} بسته
                </small>
              </strong>
              <span>{money(it.totalRials)} تومان</span>
            </div>
          ))}
          {!orderId && (
            <form
              className="checkout-code"
              onSubmit={(e) => {
                e.preventDefault();
                void applyCode();
              }}
            >
              <label htmlFor="checkout-discount-code">
                <TicketPercent size={18} />
                کد تخفیف دارید؟
              </label>
              <div>
                <input
                  id="checkout-discount-code"
                  aria-label="کد تخفیف"
                  placeholder="کد را وارد کنید"
                  dir="ltr"
                  maxLength={32}
                  autoComplete="off"
                  disabled={busy}
                  value={codeInput}
                  onChange={(e) => {
                    setCodeInput(e.target.value);
                    setCodeError("");
                  }}
                />
                <button
                  className="button secondary"
                  disabled={busy || !codeInput.trim() || !quote}
                >
                  اعمال کد
                </button>
              </div>
              {!quote && (
                <small className="muted">
                  ابتدا نشانی را کامل و هزینه ارسال را محاسبه کنید.
                </small>
              )}
              {appliedCode && (
                <div className="applied-code">
                  <span>
                    کد <bdi>{appliedCode}</bdi>
                    {quote ? " اعمال شد" : "؛ نیازمند محاسبه دوباره"}
                  </span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void applyCode(true)}
                  >
                    حذف کد
                  </button>
                </div>
              )}
              {codeError && (
                <p role="alert" className="error">
                  {codeError}
                </p>
              )}
            </form>
          )}
          <div className="summary-line">
            <span>جمع محصولات</span>
            <strong>{money(cart.subtotalRials)} تومان</strong>
          </div>
          <div className="summary-line">
            <span>هزینه ارسال</span>
            <span>
              {quote
                ? quote.shippingRials === 0
                  ? "رایگان"
                  : money(quote.shippingRials) + " تومان"
                : "پس از انتخاب نشانی"}
            </span>
          </div>
          {quote && quote.discountRials > 0 && (
            <div className="summary-line coupon-saving">
              <span>
                تخفیف کد <bdi>{quote.discountCode}</bdi>
              </span>
              <strong>−{money(quote.discountRials)} تومان</strong>
            </div>
          )}
          {quote ? (
            <>
              <div className="summary-line checkout-total" aria-live="polite">
                <strong>مبلغ قابل پرداخت</strong>
                <strong>{money(quote.totalRials)} تومان</strong>
              </div>
              {!orderId ? (
                <button
                  className="button full"
                  style={{ marginTop: 16 }}
                  disabled={busy || quoteBusy || !!quote.requiresAcceptance}
                  onClick={createOrder}
                >
                  تأیید سفارش و پرداخت
                </button>
              ) : null}
            </>
          ) : null}
          {!quote && !orderId && (
            <p className="checkout-next-hint">
              پس از تکمیل نشانی و محاسبه ارسال، مبلغ نهایی و دکمه پرداخت نمایش
              داده می‌شود.
            </p>
          )}
          <p className="muted checkout-price-note">
            قیمت‌ها برای بسته‌ها و تعداد انتخابی شما محاسبه شده است.
          </p>
        </aside>
      </div>
    </div>
  );
}
