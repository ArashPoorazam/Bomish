"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import type { Order, ShippingConfig, Member } from "@/lib/types";
import { digits } from "@/lib/format";
import { OrderView } from "@/components/checkout";

export function OrderManager({
  orders,
  reload,
}: {
  orders: Order[];
  reload: () => Promise<void>;
}) {
  const [tracking, setTracking] = useState<Record<string, string>>({}),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function move(o: Order) {
    setBusy(true);
    setError("");
    try {
      await api("/staff/orders/" + o.id, "PATCH", {
        status: o.status === "paid" ? "packing" : "shipped",
        tracking: tracking[o.id] || "",
      });
      await reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div>
      {error ? (
        <p role="alert" className="error">
          {error}
        </p>
      ) : null}
      {!orders.length ? <p>هنوز سفارشی ثبت نشده است.</p> : null}
      {orders.map((o) => (
        <OrderView order={o} key={o.id}>
          <div className="stack">
            <p>
              {o.address.recipient} · {o.address.phone}
              <br />
              {o.address.province}، {o.address.city}، {o.address.street}
              <br />
              کد پستی: {o.address.postalCode}
            </p>
            {o.status === "packing" ? (
              <label>
                کد رهگیری
                <input
                  value={tracking[o.id] || ""}
                  onChange={(e) =>
                    setTracking({ ...tracking, [o.id]: e.target.value })
                  }
                />
              </label>
            ) : null}
            {["paid", "packing"].includes(o.status) ? (
              <button
                className="button"
                disabled={busy}
                onClick={() => move(o)}
              >
                {o.status === "paid" ? "شروع آماده‌سازی" : "ثبت ارسال"}
              </button>
            ) : null}
            {o.status === "review" ? (
              <p className="error">
                پرداخت تأیید شده اما موجودی کافی نیست. مالک باید تأمین کالا یا
                بازپرداخت را پیگیری کند.
              </p>
            ) : null}
          </div>
        </OrderView>
      ))}
    </div>
  );
}
export function ShippingEditor({ initial }: { initial: ShippingConfig }) {
  const [v, setV] = useState(initial),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <div className="form-card stack">
      <h2>هزینه و محدوده ارسال</h2>
      <label>
        وزن بسته‌بندی (گرم)
        <input
          inputMode="numeric"
          min="0"
          value={v.packagingGrams}
          onChange={(e) =>
            setV({ ...v, packagingGrams: Number(digits(e.target.value)) })
          }
        />
      </label>
      <p>
        برای هر استان، سقف وزن هر بازه را وارد کنید. اولین بازه‌ای که کل وزن
        سفارش در آن جا شود انتخاب می‌شود.
      </p>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>استان</th>
              <th>حداکثر وزن (گرم)</th>
              <th>هزینه (تومان)</th>
              <th>عملیات</th>
            </tr>
          </thead>
          <tbody>
            {v.rules.map((r, i) => (
              <tr key={r.id}>
                <td>
                  <input
                    aria-label={`استان ${i + 1}`}
                    value={r.province}
                    onChange={(e) =>
                      setV({
                        ...v,
                        rules: v.rules.map((x, j) =>
                          i === j ? { ...x, province: e.target.value } : x,
                        ),
                      })
                    }
                  />
                </td>
                <td>
                  <input
                    aria-label={`حداکثر وزن ${i + 1}`}
                    inputMode="numeric"
                    min="1"
                    value={r.maxGrams}
                    onChange={(e) =>
                      setV({
                        ...v,
                        rules: v.rules.map((x, j) =>
                          i === j
                            ? { ...x, maxGrams: Number(digits(e.target.value)) }
                            : x,
                        ),
                      })
                    }
                  />
                </td>
                <td>
                  <input
                    aria-label={`هزینه ${i + 1}`}
                    inputMode="numeric"
                    min="0"
                    value={r.feeRials / 10}
                    onChange={(e) =>
                      setV({
                        ...v,
                        rules: v.rules.map((x, j) =>
                          i === j
                            ? {
                                ...x,
                                feeRials: Number(digits(e.target.value)) * 10,
                              }
                            : x,
                        ),
                      })
                    }
                  />
                </td>
                <td>
                  <button
                    className="icon-button"
                    aria-label={`حذف بازه ${i + 1}`}
                    onClick={() =>
                      setV({ ...v, rules: v.rules.filter((_, j) => i !== j) })
                    }
                  >
                    حذف
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="inline-actions">
        <button
          className="button secondary"
          onClick={() =>
            setV({
              ...v,
              rules: [
                ...v.rules,
                {
                  id: crypto.randomUUID(),
                  province: "",
                  maxGrams: 1000,
                  feeRials: 0,
                },
              ],
            })
          }
        >
          افزودن بازه
        </button>
        <button
          className="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            setMessage("");
            try {
              await api("/staff/shipping", "PUT", v);
              setMessage("تنظیمات ارسال ذخیره شد.");
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          ذخیره تنظیمات
        </button>
      </div>
      {message ? (
        <p className="success" role="status">
          {message}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
export function Members({
  members,
  reload,
}: {
  members: Member[];
  reload: () => Promise<void>;
}) {
  const [username, setUsername] = useState(""),
    [password, setPassword] = useState(""),
    [role, setRole] = useState("editor"),
    [error, setError] = useState(""),
    [secret, setSecret] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <div className="form-card stack">
      <h2>همکاران فروشگاه</h2>
      {members.map((m) => (
        <div className="between" key={m.id}>
          <span>
            {m.username} ·{" "}
            {m.role === "owner"
              ? "مالک"
              : m.role === "editor"
                ? "ویرایشگر محتوا"
                : "مسئول سفارش‌ها"}{" "}
            · {m.active ? "فعال" : "غیرفعال"}
          </span>
          <button
            className="button secondary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api("/staff/members", "POST", {
                  ...m,
                  password: "",
                  active: !m.active,
                });
                await reload();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {m.active ? "غیرفعال کردن" : "فعال کردن"}
          </button>
        </div>
      ))}
      <hr />
      <h3>افزودن همکار</h3>
      <div className="form-grid">
        <label>
          نام کاربری
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </label>
        <label>
          گذرواژه اولیه (حداقل ۱۲ نویسه)
          <input
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <label>
          نقش
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="editor">ویرایشگر محتوا</option>
            <option value="operator">مسئول سفارش‌ها</option>
            <option value="owner">مالک</option>
          </select>
        </label>
      </div>
      <button
        className="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          setSecret("");
          try {
            const r = await api<{ totpSecret: string }>(
              "/staff/members",
              "POST",
              { id: "", username, password, role, active: true },
            );
            setSecret(r.totpSecret);
            setPassword("");
            setUsername("");
            await reload();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        ساخت حساب همکار
      </button>
      {secret ? (
        <div className="notice">
          کلید برنامه رمزساز را یک‌بار به همکار تحویل دهید و در برنامه‌ای مانند
          Authenticator با حالت TOTP ثبت کنید:
          <br />
          <code dir="ltr">{secret}</code>
        </div>
      ) : null}
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
