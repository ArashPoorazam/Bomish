"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { DeliveryRecord, Parcel } from "@/lib/types";
import { fa, money, digits } from "@/lib/format";
import { deliveryStatuses, providerName } from "@/lib/shipping";
import { ParcelView } from "./shipping-parcel";
import { MeasurementNumber } from "./product-measurements";
export function ShippingFulfillment({
  orderId,
  customerCharge,
  refreshOrder,
  onStateChange,
}: {
  orderId: string;
  customerCharge: number;
  refreshOrder: () => Promise<void>;
  onStateChange: (s: { dirty: boolean; busy: boolean }) => void;
}) {
  const [data, setData] = useState<DeliveryRecord | null>(null),
    [parcels, setParcels] = useState<Parcel[]>([]),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [reason, setReason] = useState(""),
    [dialog, setDialog] = useState<"cancel" | "method" | "resolve" | null>(
      null,
    ),
    [consent, setConsent] = useState(false),
    [target, setTarget] = useState("post"),
    [now, setNow] = useState(Date.now());
  const sequence = useRef(0);
  const refreshRef = useRef(refreshOrder),
    lastVersion = useRef(0);
  useEffect(() => {
    refreshRef.current = refreshOrder;
  }, [refreshOrder]);
  useEffect(() => {
    if (!data?.review) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [data?.review]);
  const lock = useRef(false),
    draft = useRef(false),
    modal = useRef<HTMLDialogElement>(null),
    trigger = useRef<HTMLElement | null>(null),
    idempotency = useRef("");
  const dirty =
    !!data && JSON.stringify(parcels) !== JSON.stringify(data.parcels);
  draft.current = dirty;
  useEffect(() => onStateChange({ dirty, busy }), [dirty, busy, onStateChange]);
  const load = useCallback(async () => {
    const seq = ++sequence.current;
    try {
      const v = await api<DeliveryRecord | null>(
        `/staff/orders/${orderId}/delivery`,
      );
      if (seq === sequence.current && !draft.current && !lock.current) {
        setData(v);
        if (v) {
          setParcels(v.parcels);
          if (lastVersion.current !== v.version) {
            lastVersion.current = v.version;
            await refreshRef.current();
          }
        }
      }
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [orderId]);
  useEffect(() => {
    void load();
    const timer = setInterval(() => {
      setNow(Date.now());
      if (
        document.visibilityState === "visible" &&
        !draft.current &&
        !lock.current
      )
        void load();
    }, 15000);
    return () => clearInterval(timer);
  }, [load]);
  useEffect(() => {
    if (dialog) {
      trigger.current = document.activeElement as HTMLElement;
      modal.current?.showModal();
    }
  }, [dialog]);
  function close() {
    modal.current?.close();
    setDialog(null);
    setConsent(false);
    requestAnimationFrame(() => trigger.current?.focus());
  }
  async function act(path: string, body: unknown, method = "POST") {
    if (lock.current || !data) return;
    lock.current = true;
    sequence.current++;
    setBusy(true);
    setError("");
    setMessage("");
    let saved = false;
    try {
      const result = await api<DeliveryRecord>(
        `/staff/orders/${orderId}/${path}`,
        method,
        body,
      );
      saved = true;
      setData(result);
      const singleParcel =
        method === "PATCH" && path.startsWith("parcels/") ? path.slice(8) : "";
      setParcels(
        singleParcel
          ? result.parcels.map((p) =>
              p.id === singleParcel
                ? p
                : (parcels.find((draft) => draft.id === p.id) ?? p),
            )
          : result.parcels,
      );
      draft.current = false;
      setMessage("تغییر ثبت شد.");
      if (!(dialog === "method" && path === "dispatch-quote")) close();
      await refreshOrder();
      return result;
    } catch (e) {
      setError(
        (saved ? "تغییر ذخیره شد؛ تازه‌سازی سفارش انجام نشد. " : "") +
          (e as Error).message,
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  if (loading && !data)
    return <p role="status">در حال دریافت اطلاعات ارسال…</p>;
  if (!data)
    return error ? (
      <p role="alert" className="error">
        {error}
        <button onClick={() => void load()}>تلاش دوباره</button>
      </p>
    ) : null;
  const can = (action: string) => data.allowedActions.includes(action);
  const review = data.review;
  const reviewFresh =
    !!review &&
    Date.parse(review.expiresAt) > now &&
    review.version === data.version &&
    !dirty;
  const changeParcel = (i: number, value: Partial<Parcel>) =>
    setParcels((ps) => ps.map((p, j) => (i === j ? { ...p, ...value } : p)));
  return (
    <section className="staff-order-panel shipping-fulfillment stack">
      <div className="between">
        <h3>{providerName(data.method)} · ارسال سفارش</h3>
        <span className="badge">
          {deliveryStatuses[data.status] ?? data.status}
        </span>
      </div>
      {data.snapshot.carrierQuote.simulated && (
        <p className="notice">محیط شبیه‌سازی؛ هیچ پیک واقعی درخواست نمی‌شود.</p>
      )}
      <p>
        آخرین وضعیت: {new Date(data.updatedAt).toLocaleString("fa-IR")} ·{" "}
        {dirty ? "تغییرات ذخیره نشده" : "اطلاعات ذخیره شده"}
      </p>
      <div className="form-grid">
        {[
          { title: "مبدأ", a: data.snapshot.config.origin },
          { title: "گیرنده", a: data.snapshot.destination },
        ].map(({ title, a }) => (
          <div key={title}>
            <strong>
              {title}: {a.recipient}
            </strong>
            <p>
              {a.city}، {a.street}
            </p>
            {a.latitude !== undefined && a.longitude !== undefined && (
              <a
                href={`https://www.openstreetmap.org/?mlat=${a.latitude}&mlon=${a.longitude}#map=16/${a.latitude}/${a.longitude}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                مشاهده موقعیت روی نقشه
              </a>
            )}
          </div>
        ))}
      </div>
      <div className="form-grid">
        <p>
          دریافت‌شده از مشتری: <strong>{money(customerCharge)} تومان</strong>
        </p>
        <p>
          برآورد اولیه حامل: {money(data.snapshot.carrierQuote.costRials)} تومان
        </p>
        <p>
          هزینه واقعی:{" "}
          {data.actualCostRials === null
            ? "هنوز مشخص نیست"
            : `${money(data.actualCostRials)} تومان`}
        </p>
        {data.actualCostRials !== null && (
          <p>
            اختلاف هزینه برای بومیش:{" "}
            {money(data.actualCostRials - customerCharge)} تومان
          </p>
        )}
      </div>
      <button
        className="button secondary no-print"
        type="button"
        onClick={() => window.print()}
      >
        چاپ اطلاعات بسته‌بندی
      </button>
      {(data.driverName || data.driverPhone) && (
        <p>
          پیک: {data.driverName || "نام اعلام نشده"}
          {data.driverPhone && (
            <>
              {" "}
              · <bdi>{data.driverPhone}</bdi>
            </>
          )}
        </p>
      )}
      <fieldset className="product-step-fields stack" disabled={busy}>
        {parcels.map((p, i) => (
          <div key={p.id} className="stack">
            <ParcelView parcel={p} />
            {can("edit_parcels") && (
              <div className="product-package stack">
                <label>
                  کارتن انتخابی
                  <select
                    value={p.box.id}
                    onChange={(e) => {
                      const box = data.snapshot.config.boxes.find(
                        (b) => b.id === e.target.value,
                      );
                      if (box)
                        changeParcel(i, {
                          box,
                          manual: true,
                          confirmed: false,
                          grossGrams:
                            box.emptyGrams +
                            box.fillerGrams +
                            p.placements.reduce((s, v) => s + v.item.grams, 0),
                        });
                    }}
                  >
                    {data.snapshot.config.boxes
                      .filter((b) => b.active && b.verified)
                      .map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                  </select>
                </label>
                <MeasurementNumber
                  label="وزن اندازه‌گیری‌شده کارتن (گرم)"
                  value={p.measuredGrams}
                  onChange={(n) => changeParcel(i, { measuredGrams: n })}
                />
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={p.confirmed}
                    onChange={(e) =>
                      changeParcel(i, { confirmed: e.target.checked })
                    }
                  />
                  محتویات، وزن و بسته‌بندی واقعی این کارتن را تأیید می‌کنم
                </label>
                <details>
                  <summary>اصلاح تخصیص بسته‌ها</summary>
                  {p.placements.map((v, j) => (
                    <label
                      key={v.item.productId + v.item.packageId + v.item.unit}
                    >
                      {v.item.label} · واحد {fa(v.item.unit + 1)}
                      <select
                        value={p.id}
                        onChange={(e) => {
                          const to = e.target.value;
                          setParcels((ps) =>
                            ps
                              .map((x, k) => {
                                const placements =
                                  k === i
                                    ? x.placements.filter((_, n) => n !== j)
                                    : x.id === to
                                      ? [
                                          ...x.placements,
                                          { ...v, x: 0, y: 0, z: 0 },
                                        ]
                                      : x.placements;
                                return {
                                  ...x,
                                  placements,
                                  manual: true,
                                  confirmed: false,
                                  measuredGrams: 0,
                                  grossGrams:
                                    x.box.emptyGrams +
                                    x.box.fillerGrams +
                                    placements.reduce(
                                      (s, p) => s + p.item.grams,
                                      0,
                                    ),
                                };
                              })
                              .filter((x) => x.placements.length > 0),
                          );
                        }}
                      >
                        {parcels.map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.box.name} · {x.id}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                </details>
              </div>
            )}
            {can("postal_details") && (
              <div className="form-grid">
                <label>
                  بارکد پستی این کارتن
                  <input
                    dir="ltr"
                    inputMode="numeric"
                    value={p.tracking}
                    onChange={(e) =>
                      changeParcel(i, { tracking: digits(e.target.value) })
                    }
                  />
                </label>
                <label>
                  هزینه واقعی (تومان؛ خالی یعنی نامشخص)
                  <input
                    dir="ltr"
                    inputMode="numeric"
                    value={
                      p.actualCostRials === null ? "" : p.actualCostRials / 10
                    }
                    onChange={(e) =>
                      changeParcel(i, {
                        actualCostRials:
                          e.target.value === ""
                            ? null
                            : Number(digits(e.target.value)) * 10,
                      })
                    }
                  />
                </label>
                <button
                  type="button"
                  className="button secondary"
                  onClick={() =>
                    void act(
                      `parcels/${p.id}`,
                      {
                        version: data.version,
                        tracking: p.tracking,
                        actualCostRials: p.actualCostRials,
                      },
                      "PATCH",
                    )
                  }
                >
                  ذخیره رهگیری و هزینه کارتن
                </button>
              </div>
            )}
          </div>
        ))}
      </fieldset>
      {can("edit_parcels") && (
        <div className="stack">
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={() => {
              const box = data.snapshot.config.boxes.find(
                (b) => b.active && b.verified,
              );
              if (box)
                setParcels([
                  ...parcels,
                  {
                    id: crypto.randomUUID(),
                    box,
                    placements: [],
                    grossGrams: box.emptyGrams + box.fillerGrams,
                    measuredGrams: 0,
                    confirmed: false,
                    manual: true,
                    tracking: "",
                    actualCostRials: null,
                  },
                ]);
            }}
          >
            افزودن کارتن برای اصلاح دستی
          </button>
          <label>
            دلیل اصلاح / نتیجه بررسی واقعی
            <input value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          <button
            type="button"
            className="button"
            disabled={busy || !dirty || !reason.trim()}
            onClick={() =>
              void act(
                "parcels",
                { version: data.version, parcels, reason },
                "PUT",
              )
            }
          >
            ذخیره بسته‌بندی واقعی
          </button>
        </div>
      )}
      {dirty && (
        <button
          type="button"
          className="button secondary"
          disabled={busy}
          onClick={() => {
            draft.current = false;
            setParcels(data.parcels);
            void load();
          }}
        >
          کنار گذاشتن ویرایش و دریافت آخرین وضعیت
        </button>
      )}
      <div className="inline-actions">
        {can("ready") && (
          <button
            type="button"
            className="button"
            disabled={busy || dirty}
            onClick={() => void act("ready", { version: data.version })}
          >
            تأیید آمادگی ارسال
          </button>
        )}
        {can("dispatch_quote") && (
          <button
            type="button"
            className="button secondary"
            disabled={busy || dirty}
            onClick={() =>
              void act("dispatch-quote", {
                version: data.version,
                method: data.method,
              })
            }
          >
            بررسی هزینه {data.method === "snapp" ? "پیک" : "پست"}
          </button>
        )}
        <button
          type="button"
          className="button secondary"
          disabled={busy || dirty}
          onClick={() =>
            can("refresh") ? void act("shipments/refresh", {}) : void load()
          }
        >
          به‌روزرسانی وضعیت ارسال
        </button>
      </div>
      {review && (
        <div className="notice stack">
          <h4>بررسی هزینه {providerName(review.method)}</h4>
          <p>هزینه فعلی حامل: {money(review.quote.costRials)} تومان</p>
          <p>
            اختلاف هزینه برای بومیش:{" "}
            {money(review.quote.costRials - customerCharge)} تومان
          </p>
          <p>
            مشتری دوباره پرداخت نمی‌کند. اعتبار این بررسی، تضمین ثابت‌ماندن
            کرایه پیک نیست.
          </p>
          <p>
            {reviewFresh
              ? `معتبر تا ${new Date(review.expiresAt).toLocaleTimeString("fa-IR")}`
              : "بررسی منقضی یا تغییر کرده؛ دوباره بررسی کنید."}
          </p>
          {can("book") && review.method === data.method && (
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
                }).then((v) => {
                  if (v) idempotency.current = "";
                });
              }}
            >
              درخواست پیک
            </button>
          )}
        </div>
      )}
      {data.status === "unknown" && (
        <p role="status" className="notice">
          نتیجه درخواست در حال بررسی است. تا تعیین نتیجه، درخواست تازه ثبت
          نمی‌شود.
        </p>
      )}
      <div className="inline-actions">
        {can("cancel") && (
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={() => setDialog("cancel")}
          >
            لغو درخواست پیک
          </button>
        )}
        {can("change_method") && (
          <button
            type="button"
            className="button secondary"
            disabled={busy || dirty || !data.ready}
            onClick={() => {
              setTarget(data.method === "snapp" ? "post" : "snapp");
              setDialog("method");
            }}
          >
            تغییر روش با رضایت مشتری
          </button>
        )}
        {can("resolve") && (
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={() => setDialog("resolve")}
          >
            ثبت نتیجه بررسی مدیر
          </button>
        )}
        {can("postal_dispatch") && (
          <button
            type="button"
            className="button"
            disabled={busy || dirty || parcels.some((p) => !p.tracking)}
            onClick={async () => {
              setBusy(true);
              try {
                await api(`/staff/orders/${orderId}`, "PATCH", {
                  status: "shipped",
                  tracking: "",
                });
                await refreshOrder();
                await load();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            همه کارتن‌ها به پست تحویل شدند
          </button>
        )}
        {can("delivered") && (
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await api(`/staff/orders/${orderId}`, "PATCH", {
                  status: "received",
                  tracking: "",
                });
                await refreshOrder();
                await load();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            تحویل همه کارتن‌ها به مشتری را تأیید می‌کنم
          </button>
        )}
      </div>
      <ol>
        {data.events.map((e, i) => (
          <li key={e.createdAt + i}>
            {deliveryStatuses[e.status] ?? e.status} ·{" "}
            {new Date(e.createdAt).toLocaleString("fa-IR")}
          </li>
        ))}
      </ol>
      {message && (
        <p role="status" className="success">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {dialog && (
        <dialog ref={modal} onCancel={close} className="shipping-dialog">
          <div className="stack">
            <h3>
              {dialog === "cancel"
                ? "لغو درخواست پیک"
                : dialog === "method"
                  ? "تغییر روش ارسال"
                  : "رفع ابهام درخواست"}
            </h3>
            <p>
              {dialog === "cancel"
                ? "ممکن است هزینه لغو دریافت شود. مبلغ نهایی پس از پاسخ ارائه‌دهنده مشخص می‌شود؛ درخواست جایگزین خودکار نیست."
                : dialog === "method"
                  ? "رضایت مشتری باید خارج از برنامه دریافت شود. اختلاف هزینه بر عهده بومیش است."
                  : "ابتدا با ارائه‌دهنده بررسی کنید که هیچ درخواست فعالی وجود ندارد. ثبت اشتباه می‌تواند باعث ارسال تکراری شود."}
            </p>
            {dialog !== "cancel" && (
              <label>
                دلیل و مرجع پیگیری
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
            )}
            {dialog === "method" && (
              <>
                <p>روش جایگزین: {providerName(target)}</p>
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() =>
                    void act("dispatch-quote", {
                      version: data.version,
                      method: target,
                    }).then(() => setDialog("method"))
                  }
                >
                  بررسی هزینه جایگزین
                </button>
                {review?.method === target && (
                  <p>
                    هزینه جایگزین: {money(review.quote.costRials)} تومان ·
                    اختلاف: {money(review.quote.costRials - customerCharge)}{" "}
                    تومان
                  </p>
                )}
              </>
            )}
            <label className="check-label">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
              />
              {dialog === "cancel"
                ? "لغو با این شرایط را تأیید می‌کنم"
                : dialog === "method"
                  ? "مشتری با روش جایگزین موافقت کرده است"
                  : "نبود درخواست فعال با ارائه‌دهنده تأیید شده است"}
            </label>
            <div className="inline-actions">
              <button
                className="button"
                disabled={
                  busy ||
                  !consent ||
                  (dialog === "method" &&
                    (!reviewFresh || review?.method !== target))
                }
                onClick={() =>
                  void act(
                    dialog === "cancel"
                      ? `shipments/${data.attemptId}/cancel`
                      : dialog === "method"
                        ? "delivery-method"
                        : "shipments/resolve",
                    dialog === "cancel"
                      ? { version: data.version, confirmed: true }
                      : dialog === "method"
                        ? {
                            version: data.version,
                            method: target,
                            reason,
                            customerConsent: true,
                            dispatchQuoteId: review?.id,
                          }
                        : {
                            version: data.version,
                            reason,
                            confirmedNoBooking: true,
                          },
                  )
                }
              >
                تأیید
              </button>
              <button
                className="button secondary"
                disabled={busy}
                onClick={close}
              >
                انصراف
              </button>
            </div>
          </div>
        </dialog>
      )}
    </section>
  );
}
