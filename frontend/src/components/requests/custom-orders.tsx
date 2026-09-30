"use client";
import { useRef, useState } from "react";
import { AccountShell } from "../account-shell";
import { useStore } from "../store-provider";
import { api } from "@/lib/api";
import { date, money } from "@/lib/format";
import { useLiveQuery } from "@/hooks/use-live-query";
import { requestStatuses, type RequestPage } from "./types";

export function CustomOrders() {
  const { user } = useStore();
  const [page, setPage] = useState(1);
  const { data, error, loading, refresh } = useLiveQuery<RequestPage>(
    `/requests?kind=custom&page=${page}&pageSize=10`,
    !!user?.authenticated,
  );
  const [busy, setBusy] = useState(false),
    [failure, setFailure] = useState(""),
    [notice, setNotice] = useState("");
  const key = useRef("");
  return (
    <AccountShell section="custom" title="سفارش اختصاصی">
      <form
        className="account-panel request-form"
        onChange={() => {
          key.current = "";
          setNotice("");
        }}
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          const form = e.currentTarget;
          const values = new FormData(form);
          setBusy(true);
          setFailure("");
          setNotice("");
          key.current ||= crypto.randomUUID();
          try {
            await api("/requests", "POST", {
              kind: "custom",
              description: values.get("description"),
              quantity: values.get("quantity"),
              budgetRials: Number(values.get("budget")) * 10,
              idempotencyKey: key.current,
            });
            form.reset();
            key.current = "";
            setNotice(
              "درخواست ثبت شد؛ نتیجه بررسی در همین صفحه نمایش داده می‌شود.",
            );
            setPage(1);
            await refresh();
          } catch (e) {
            setFailure((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <p>
          محصول دلخواه، مقدار مورد نیاز و بودجه کل پیشنهادی را بنویسید. پذیرش
          درخواست به معنی پرداخت یا ثبت سفارش نهایی نیست؛ جزئیات با شما هماهنگ
          می‌شود.
        </p>
        <fieldset disabled={busy}>
          <label>
            شرح محصول
            <textarea name="description" required maxLength={4000} />
          </label>
          <label>
            مقدار و واحد
            <input
              name="quantity"
              required
              maxLength={200}
              placeholder="مثلاً ۵ کیلوگرم"
            />
          </label>
          <label>
            بودجه کل پیشنهادی (تومان)
            <input
              name="budget"
              type="number"
              min={1}
              max={10000000000}
              step={1}
              required
            />
          </label>
          <button className="button" disabled={busy}>
            {busy ? "در حال ثبت…" : "ثبت درخواست"}
          </button>
        </fieldset>
        {failure && (
          <p role="alert" className="error">
            {failure}
          </p>
        )}
        {notice && <p role="status">{notice}</p>}
      </form>
      <div className="between">
        <h3>درخواست‌های شما</h3>
        <button
          className="button secondary"
          disabled={loading}
          onClick={refresh}
        >
          به‌روزرسانی درخواست‌ها
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {data?.items.map((r) => (
        <article key={r.id} className="account-panel request-card">
          <div className="between">
            <strong>{requestStatuses[r.status]}</strong>
            <small>{date(r.createdAt)}</small>
          </div>
          <p>{r.description}</p>
          <p>
            مقدار: {r.quantity} · بودجه: {money(r.budgetRials)} تومان
          </p>
          {r.response && (
            <blockquote>
              <strong>پاسخ بومیش</strong>
              <p>{r.response}</p>
            </blockquote>
          )}
        </article>
      ))}
      {data?.total === 0 && <p>هنوز درخواستی ثبت نکرده‌اید.</p>}
      <div className="inline-actions">
        <button disabled={page <= 1} onClick={() => setPage(page - 1)}>
          قبلی
        </button>
        <button
          disabled={!data || page * 10 >= data.total}
          onClick={() => setPage(page + 1)}
        >
          بعدی
        </button>
      </div>
    </AccountShell>
  );
}
