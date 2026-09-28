"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import type { ShippingConfig } from "@/lib/types";
import { digits } from "@/lib/format";

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
