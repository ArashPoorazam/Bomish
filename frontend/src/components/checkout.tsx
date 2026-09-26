"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import type { Address, Quote, Order } from "@/lib/types";
import { useStore } from "./store-provider";
import { LoginForm } from "./login-form";
import { money, weight, digits } from "@/lib/format";
import { CheckCircle2, ArrowLeft } from "lucide-react";
const blank: Address = {
  id: "",
  recipient: "",
  phone: "",
  province: "تهران",
  city: "",
  street: "",
  postalCode: "",
};
const provinces = [
  "تهران",
  "البرز",
  "اصفهان",
  "فارس",
  "خراسان رضوی",
  "گیلان",
  "مازندران",
  "آذربایجان شرقی",
  "آذربایجان غربی",
  "اردبیل",
  "ایلام",
  "بوشهر",
  "چهارمحال و بختیاری",
  "خراسان جنوبی",
  "خراسان شمالی",
  "خوزستان",
  "زنجان",
  "سمنان",
  "سیستان و بلوچستان",
  "قزوین",
  "قم",
  "کردستان",
  "کرمان",
  "کرمانشاه",
  "کهگیلویه و بویراحمد",
  "گلستان",
  "لرستان",
  "مرکزی",
  "هرمزگان",
  "همدان",
  "یزد",
];
export function Checkout() {
  const { cart, user, refresh } = useStore();
  const [address, setAddress] = useState<Address>(blank),
    [saved, setSaved] = useState<Address[]>([]),
    [save, setSave] = useState(true),
    [quote, setQuote] = useState<Quote | null>(null),
    [orderId, setOrderId] = useState(""),
    [outcome, setOutcome] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [key, setKey] = useState("");
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
    setAddress((a) => ({ ...a, [k]: v }));
    setQuote(null);
    setKey(crypto.randomUUID());
  }
  async function getQuote(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const q = await api<Quote>("/checkout/quote", "POST", {
        province: address.province,
      });
      setQuote(q);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function createOrder() {
    if (!quote) return;
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
      <div className="auth-layout">
        <LoginForm onSuccess={() => {}} />
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
    <div className="container section">
      <div className="page-heading">
        <span className="eyebrow">چند قدم تا یک طعم تازه</span>
        <h1>تکمیل خرید</h1>
      </div>
      <div className="checkout-steps">
        <span>۱. ورود به حساب ✓</span>
        <strong>۲. نشانی و ارسال</strong>
        <span>۳. پرداخت</span>
      </div>
      <div className="checkout-layout">
        <div className="form-card">
          {orderId ? (
            <div className="stack">
              <h2>درگاه پرداخت آزمایشی</h2>
              <div className="dev-note">
                هیچ پولی جابه‌جا نمی‌شود. نتیجه پرداخت را برای آزمایش انتخاب
                کنید. موجودی به مدت ۱۵ دقیقه برای سفارش نگه داشته می‌شود.
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
              <h2>سفارش را کجا بفرستیم؟</h2>
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
                <label>
                  استان
                  <select
                    value={address.province}
                    onChange={(e) => update("province", e.target.value)}
                  >
                    {provinces.map((p) => (
                      <option key={p}>{p}</option>
                    ))}
                  </select>
                </label>
                <label>
                  شهر
                  <input
                    autoComplete="address-level2"
                    required
                    value={address.city}
                    onChange={(e) => update("city", e.target.value)}
                  />
                </label>
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
            </form>
          )}
          {error ? (
            <p className="error" role="alert">
              {error}
            </p>
          ) : null}
        </div>
        <aside className="form-card checkout-summary">
          <h2>خلاصه سفارش</h2>
          {cart.items.map((it) => (
            <div className="summary-line" key={it.product.id}>
              <strong>
                {it.product.name}
                <small>{weight(it.grams)}</small>
              </strong>
              <span>{money(it.totalRials)} تومان</span>
            </div>
          ))}
          <div className="summary-line">
            <span>جمع محصولات</span>
            <strong>{money(cart.subtotalRials)} تومان</strong>
          </div>
          <div className="summary-line">
            <span>هزینه ارسال</span>
            <span>
              {quote
                ? money(quote.shippingRials) + " تومان"
                : "پس از انتخاب نشانی"}
            </span>
          </div>
          {quote ? (
            <>
              <div className="summary-line">
                <strong>مبلغ قابل پرداخت</strong>
                <strong>{money(quote.totalRials)} تومان</strong>
              </div>
              {!orderId ? (
                <button
                  className="button full"
                  style={{ marginTop: 24 }}
                  disabled={busy}
                  onClick={createOrder}
                >
                  تأیید سفارش و پرداخت
                </button>
              ) : null}
            </>
          ) : null}
          <p className="muted" style={{ marginTop: 20 }}>
            قیمت محصولات بر اساس وزن انتخابی شما محاسبه شده است.
          </p>
        </aside>
      </div>
    </div>
  );
}
export function Account() {
  const { user, refresh } = useStore();
  const [orders, setOrders] = useState<Order[]>([]),
    [addresses, setAddresses] = useState<Address[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function load() {
    const [o, a] = await Promise.all([
      api<Order[]>("/orders"),
      api<Address[]>("/addresses"),
    ]);
    setOrders(o);
    setAddresses(a);
  }
  useEffect(() => {
    if (user?.authenticated) load().catch((e) => setError(e.message));
  }, [user?.authenticated]);
  async function pay(id: string) {
    setBusy(true);
    try {
      await api(`/orders/${id}/simulate`, "POST", { success: true });
      await load();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!user) return <div className="loading">در حال دریافت حساب…</div>;
  if (!user.authenticated)
    return (
      <div className="auth-layout">
        <LoginForm onSuccess={() => {}} />
      </div>
    );
  return (
    <div className="container section">
      <div className="section-heading">
        <h1>حساب من</h1>
        <button
          className="button secondary"
          onClick={async () => {
            try {
              await api("/logout", "POST");
              await refresh();
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          خروج از حساب
        </button>
      </div>
      {error ? (
        <p role="alert" className="error">
          {error}
        </p>
      ) : null}
      <h2 style={{ marginBottom: 20 }}>سفارش‌های شما</h2>
      {orders.length ? (
        orders.map((o) => (
          <OrderView key={o.id} order={o}>
            {o.status === "pending" && user.development ? (
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => pay(o.id)}
              >
                ادامه پرداخت آزمایشی
              </button>
            ) : null}
          </OrderView>
        ))
      ) : (
        <div className="empty-state">
          <p>هنوز سفارشی ثبت نکرده‌اید.</p>
          <Link className="button" href="/products">
            شروع خرید
          </Link>
        </div>
      )}
      <h2 style={{ margin: "32px 0 20px" }}>نشانی‌های ذخیره‌شده</h2>
      {addresses.length ? (
        addresses.map((a) => (
          <div className="order-card" key={a.id}>
            <strong>{a.recipient}</strong>
            <p>
              {a.province}، {a.city}، {a.street}
            </p>
            <p>{a.postalCode}</p>
          </div>
        ))
      ) : (
        <p>نشانی را هنگام خرید می‌توانید ذخیره کنید.</p>
      )}
    </div>
  );
}
import { date, statuses } from "@/lib/format";
export function OrderView({
  order: o,
  children,
}: {
  order: Order;
  children?: React.ReactNode;
}) {
  return (
    <article className="order-card">
      <div className="between">
        <h3>سفارش {o.id.slice(0, 8)}</h3>
        <span className="badge">{statuses[o.status] || o.status}</span>
      </div>
      <p className="muted">{date(o.createdAt)}</p>
      <ul>
        {o.items.map((i) => (
          <li key={i.productId}>
            <span>
              {i.name} · {weight(i.grams)}
            </span>
            <span>{money(i.totalRials)} تومان</span>
          </li>
        ))}
      </ul>
      <div className="between">
        <strong>جمع با ارسال: {money(o.totalRials)} تومان</strong>
        {children}
      </div>
      {o.tracking ? (
        <p>
          کد رهگیری: <bdi>{o.tracking}</bdi>
        </p>
      ) : null}
    </article>
  );
}
