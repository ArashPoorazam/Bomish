"use client";
import { useEffect, useRef, useState } from "react";
import { Bike, UserRoundCheck } from "lucide-react";
import { api } from "@/lib/api";
import { money } from "@/lib/format";
import type { DeliveryRecord, StaffCourier } from "@/lib/types";

export function ShippingDispatchChoice({
  data,
  busy,
  customerCharge,
  reviewFresh,
  act,
}: {
  data: DeliveryRecord;
  busy: boolean;
  customerCharge: number;
  reviewFresh: boolean;
  act: (path: string, body: unknown) => Promise<DeliveryRecord | undefined>;
}) {
  const [choice, setChoice] = useState<"snapp" | "own_courier" | "">("");
  const [couriers, setCouriers] = useState<StaffCourier[]>([]);
  const [courierId, setCourierId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [confirmed, setConfirmed] = useState(false);
  const idempotency = useRef("");
  useEffect(() => {
    if (choice !== "own_courier") return;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    api<StaffCourier[]>(
      "/staff/shipping/couriers",
      "GET",
      undefined,
      controller.signal,
    )
      .then((list) => {
        if (!controller.signal.aborted) setCouriers(list);
      })
      .catch((e: Error) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [choice, revision]);
  const selected = couriers.find((c) => c.id === courierId);
  const review = data.review?.method === "snapp" ? data.review : null;
  return (
    <section
      className="shipping-dispatch stack"
      aria-label="انتخاب پیک ارسال"
      aria-busy={busy}
    >
      <div>
        <h4>۲. انتخاب پیک و ارسال</h4>
        <p>
          بسته‌بندی تأیید شده است. همه کارتن‌های این سفارش با پیک انتخابی ارسال
          می‌شوند.
        </p>
        <p className="shipping-dispatch-price">
          مبلغ پرداخت‌شده مشتری: <strong>{money(customerCharge)} تومان</strong>{" "}
          · با انتخاب پیک تغییر نمی‌کند.
        </p>
      </div>
      <fieldset className="shipping-dispatch-options" disabled={busy}>
        <legend>سفارش را با چه پیکی ارسال می‌کنید؟</legend>
        {(
          [
            ["snapp", "اسنپ", "بررسی کرایه روز و ثبت درخواست پیک", Bike],
            [
              "own_courier",
              "پیک بومیش",
              "انتخاب همکار پیک و ثبت تحویل بسته",
              UserRoundCheck,
            ],
          ] as const
        ).map(([value, title, description, Icon]) => (
          <label
            key={value}
            className={`shipping-dispatch-option ${choice === value ? "selected" : ""}`}
          >
            <input
              type="radio"
              name={`dispatch-${data.orderId}`}
              value={value}
              checked={choice === value}
              onChange={() => {
                setChoice(value);
                setConfirmed(false);
              }}
            />
            <Icon size={24} aria-hidden="true" />
            <span>
              <strong>{title}</strong>
              <small>{description}</small>
            </span>
          </label>
        ))}
      </fieldset>
      {choice === "snapp" && (
        <div className="shipping-dispatch-body stack">
          <p>
            پیش از درخواست اسنپ، کرایه فعلی را بررسی کنید. اختلاف هزینه با مبلغ
            پرداخت‌شده بر عهده بومیش است.
          </p>
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={() =>
              void act("dispatch-quote", {
                version: data.version,
                method: "snapp",
              })
            }
          >
            {busy ? "در حال ثبت…" : "بررسی هزینه پیک"}
          </button>
          {review && (
            <div className="notice stack">
              <p>
                کرایه فعلی اسنپ:{" "}
                <strong>{money(review.quote.costRials)} تومان</strong>
              </p>
              <p>
                اختلاف هزینه برای بومیش:{" "}
                {money(review.quote.costRials - customerCharge)} تومان
              </p>
              <p role="status">
                {reviewFresh
                  ? `معتبر تا ${new Date(review.expiresAt).toLocaleTimeString("fa-IR")}`
                  : "بررسی منقضی یا تغییر کرده؛ دوباره بررسی کنید."}
              </p>
              <p>این استعلام تضمین ثابت‌ماندن کرایه یا موجود بودن پیک نیست.</p>
              <button
                type="button"
                className="button"
                disabled={busy || !reviewFresh}
                onClick={() => {
                  if (!idempotency.current)
                    idempotency.current = crypto.randomUUID();
                  void act("shipments", {
                    version: data.version,
                    dispatchQuoteId: review.id,
                    idempotencyKey: idempotency.current,
                  }).then((result) => {
                    if (result) idempotency.current = "";
                  });
                }}
              >
                درخواست پیک اسنپ
              </button>
            </div>
          )}
        </div>
      )}
      {choice === "own_courier" && (
        <div className="shipping-dispatch-body stack">
          <label>
            همکار پیک
            <select
              value={courierId}
              disabled={busy || loading || !!error || couriers.length === 0}
              aria-describedby="courier-roster-hint"
              onChange={(e) => {
                setCourierId(e.target.value);
                setConfirmed(false);
              }}
            >
              <option value="">
                {loading ? "در حال دریافت پیک‌ها…" : "یک همکار پیک انتخاب کنید"}
              </option>
              {couriers.map((c) => (
                <option value={c.id} key={c.id}>
                  {c.fullName} · {c.phone}
                </option>
              ))}
            </select>
          </label>
          <small id="courier-roster-hint">
            فقط همکاران فعال با نقش «پیک» نمایش داده می‌شوند.
          </small>
          {loading && <p role="status">در حال دریافت فهرست پیک‌ها…</p>}
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          {!loading && !error && couriers.length === 0 && (
            <p className="notice" role="status">
              هنوز پیک فعالی ثبت نشده است. از مسئول همکاران بخواهید در بخش
              «همکاران»، یک حساب فعال با نقش «پیک» ایجاد یا ویرایش کند.
            </p>
          )}
          <button
            type="button"
            className="button secondary"
            disabled={busy || loading}
            onClick={() => {
              setConfirmed(false);
              setRevision((v) => v + 1);
            }}
          >
            تازه‌سازی فهرست پیک‌ها
          </button>
          {selected && !loading && !error && (
            <label className="check-label">
              <input
                type="checkbox"
                checked={confirmed}
                disabled={busy}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              همه کارتن‌ها را به {selected.fullName} تحویل داده‌ام.
            </label>
          )}
          <p>
            با ثبت تحویل، سفارش «ارسال‌شده» می‌شود و نام پیک در سابقه سفارش
            می‌ماند. تحویل به مشتری در مرحله بعد تأیید می‌شود.
          </p>
          <button
            type="button"
            className="button"
            disabled={busy || loading || !!error || !selected || !confirmed}
            onClick={() =>
              void act("own-courier", { version: data.version, courierId })
            }
          >
            {busy ? "در حال ثبت…" : "ثبت تحویل به پیک بومیش"}
          </button>
        </div>
      )}
    </section>
  );
}
