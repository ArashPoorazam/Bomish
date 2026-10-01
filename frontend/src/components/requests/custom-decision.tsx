"use client";
import { useEffect, useRef, useState } from "react";
import { Check, Package, Banknote, CalendarDays } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { date, money } from "@/lib/format";
import { requestStatuses, type CustomerRequest } from "./types";
export type RequestEditorState = { dirty: boolean; busy: boolean };

export function CustomDecision({
  request: r,
  onSaved,
  onReload,
  onStateChange,
}: {
  request: CustomerRequest;
  onSaved: () => Promise<void>;
  onReload: () => Promise<void>;
  onStateChange: (state: RequestEditorState) => void;
}) {
  const [status, setStatus] = useState(
    r.status === "new" ? "follow_up" : r.status,
  );
  const [response, setResponse] = useState(r.response);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [saved, setSaved] = useState(false);
  const previousRequest = useRef(r);
  useEffect(() => {
    const previous = previousRequest.current;
    if (previous === r) return;
    previousRequest.current = r;
    const wasDirty =
      response !== previous.response ||
      status !== (previous.status === "new" ? "follow_up" : previous.status);
    if (!wasDirty) {
      setResponse(r.response);
      setStatus(r.status === "new" ? "follow_up" : r.status);
    }
  }, [r, response, status]);
  const dirty =
    response !== r.response ||
    status !== (r.status === "new" ? "follow_up" : r.status);
  useEffect(() => {
    onStateChange({ dirty, busy });
  }, [dirty, busy, onStateChange]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  return (
    <div className="custom-review">
      <div className="custom-summary">
        <div className="between">
          <span className="request-eyebrow">جزئیات سفارش اختصاصی</span>
          <span className={`request-status status-${r.status}`}>
            {requestStatuses[r.status]}
          </span>
        </div>
        <h3>درخواست مشتری</h3>
        <p className="custom-description">{r.description}</p>
        <dl className="request-facts">
          <div>
            <dt>
              <Package size={16} /> مقدار درخواستی
            </dt>
            <dd>{r.quantity}</dd>
          </div>
          <div>
            <dt>
              <Banknote size={16} /> بودجه کل
            </dt>
            <dd>
              {money(r.budgetRials)} <small>تومان</small>
            </dd>
          </div>
          <div>
            <dt>
              <CalendarDays size={16} /> تاریخ درخواست
            </dt>
            <dd>{date(r.createdAt)}</dd>
          </div>
        </dl>
        {r.response && (
          <div className="previous-response">
            <strong>آخرین پاسخ ثبت‌شده</strong>
            <p>{r.response}</p>
          </div>
        )}
      </div>
      <form
        className="request-form decision-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy || conflict || !response.trim()) return;
          setBusy(true);
          setError("");
          setSaved(false);
          try {
            await api(`/staff/requests/${r.id}`, "PATCH", {
              status,
              response,
              version: r.version,
            });
            await onSaved();
            setResponse(response.trim());
            setSaved(true);
          } catch (e) {
            setError((e as Error).message);
            setConflict(e instanceof ApiError && e.status === 409);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div>
          <span className="request-eyebrow">بررسی و پاسخ</span>
          <h3>نتیجه را با مشتری در میان بگذارید</h3>
          <p>متن پاسخ و نتیجه بررسی در حساب مشتری نمایش داده می‌شود.</p>
        </div>
        <fieldset disabled={busy}>
          <label>
            نتیجه بررسی
            <select
              aria-label="نتیجه بررسی"
              name="status"
              value={status}
              onChange={(e) => {
                setStatus(
                  e.target.value as Exclude<CustomerRequest["status"], "new">,
                );
                setSaved(false);
              }}
            >
              <option value="follow_up">پیگیری</option>
              <option value="accepted">پذیرش</option>
              <option value="rejected">عدم پذیرش</option>
            </select>
          </label>
          <label>
            پاسخ قابل مشاهده برای مشتری
            <textarea
              name="response"
              required
              maxLength={4000}
              rows={5}
              value={response}
              placeholder="جزئیات بررسی یا مرحله بعد را برای مشتری بنویسید…"
              onChange={(e) => {
                setResponse(e.target.value);
                setSaved(false);
              }}
            />
          </label>
          <div className="decision-actions">
            <button className="button" disabled={!response.trim() || conflict}>
              {busy ? "در حال ثبت…" : "ثبت نتیجه"}
            </button>
            <span>{dirty ? "تغییرات هنوز ثبت نشده‌اند" : ""}</span>
          </div>
        </fieldset>
        {saved && (
          <p className="request-success" role="status">
            <Check size={17} /> نتیجه ثبت شد و برای مشتری قابل مشاهده است.
          </p>
        )}
        {error && (
          <div role="alert">
            <p className="error">{error}</p>
            {conflict && (
              <>
                <p>
                  نسخه جدید را دریافت کنید؛ متن پاسخ شما حفظ می‌شود. سپس دوباره
                  نتیجه را بررسی و ثبت کنید.
                </p>
                <button
                  type="button"
                  className="text-link"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await onReload();
                      setConflict(false);
                      setError("");
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  دریافت آخرین نسخه
                </button>
              </>
            )}
          </div>
        )}
      </form>
    </div>
  );
}
