"use client";
import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import type { Order, ShippingConfig } from "@/lib/types";
import { digits, statuses, fa } from "@/lib/format";
import { OrderView } from "@/components/checkout";

export function OrderManager({
  initialQuery = "",
  orders,
  onFilters,
  reload,
}: {
  initialQuery?: string;
  orders: Order[];
  onFilters?: (filters: Record<string, string>) => void;
  reload: () => Promise<void>;
}) {
  const [q, setQ] = useState(initialQuery),
    [filter, setFilter] = useState(initialQuery ? "" : "active");
  useEffect(() => {
    const timer = setTimeout(() => onFilters?.({ q, status: filter }), 250);
    return () => clearTimeout(timer);
  }, [q, filter, onFilters]);
  const [tracking, setTracking] = useState<Record<string, string>>({}),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function move(o: Order) {
    setBusy(true);
    setError("");
    try {
      await api("/staff/orders/" + o.id, "PATCH", {
        status:
          o.status === "paid"
            ? "packing"
            : o.status === "packing"
              ? "shipped"
              : "received",
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
      <div className="order-filters">
        <label>
          جستجوی سفارش
          <input
            type="search"
            placeholder="نام، همراه، کد سفارش یا رهگیری"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
        <label>
          وضعیت
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="active">نیازمند اقدام</option>
            <option value="">همه سفارش‌ها</option>
            {[
              "paid",
              "packing",
              "shipped",
              "received",
              "pending",
              "review",
              "cancelled",
              "expired",
            ].map((x) => (
              <option key={x} value={x}>
                {statuses[x]}
              </option>
            ))}
          </select>
        </label>
        <button
          className="button secondary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await reload();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          به‌روزرسانی
        </button>
      </div>
      {!orders.length ? <p>هنوز سفارشی ثبت نشده است.</p> : null}
      {orders
        .filter(
          (o) =>
            (!filter ||
              (filter === "active"
                ? ["paid", "packing", "shipped", "review"].includes(o.status)
                : o.status === filter)) &&
            `${o.id} ${o.address.recipient} ${o.address.phone} ${o.tracking}`.includes(
              q,
            ),
        )
        .map((o) => (
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
              {["paid", "packing", "shipped"].includes(o.status) ? (
                <button
                  className="button"
                  disabled={
                    busy ||
                    (o.status === "packing" &&
                      !/^[0-9]{10,30}$/.test(digits(tracking[o.id] || "")))
                  }
                  onClick={() => move(o)}
                >
                  {o.status === "paid"
                    ? "تأیید بسته‌بندی"
                    : o.status === "packing"
                      ? "ثبت ارسال و اطلاع‌رسانی"
                      : "تأیید تحویل به مشتری"}
                </button>
              ) : null}
              {o.status === "review" ? (
                <p className="error">
                  پرداخت تأیید شده اما سفارش نیازمند بررسی است. مالک باید تأیید یا
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
        ارسال رایگان از مبلغ (تومان؛ صفر برای غیرفعال)
        <input
          type="number"
          min="0"
          value={v.freeShippingRials / 10}
          onChange={(e) =>
            setV({ ...v, freeShippingRials: Number(e.target.value) * 10 })
          }
        />
      </label>
      <label>
        لینک پشتیبانی واتساپ یا تلگرام
        <input
          type="url"
          dir="ltr"
          placeholder="https://wa.me/989..."
          value={v.supportUrl}
          onChange={(e) => setV({ ...v, supportUrl: e.target.value })}
        />
      </label>
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
