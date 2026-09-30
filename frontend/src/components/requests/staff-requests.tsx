"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useLiveQuery } from "@/hooks/use-live-query";
import { date, money } from "@/lib/format";
import { Chat } from "./chat";
import {
  requestStatuses,
  type CustomerRequest,
  type RequestPage,
} from "./types";

export function StaffRequests({ kind }: { kind: "support" | "custom" }) {
  const [page, setPage] = useState(1),
    [selected, setSelected] = useState<CustomerRequest | null>(null);
  const { data, error, loading, refresh } = useLiveQuery<RequestPage>(
    `/staff/requests?kind=${kind}&page=${page}&pageSize=20`,
  );
  useEffect(() => {
    setSelected(null);
    setPage(1);
  }, [kind]);
  return (
    <>
      <button className="button secondary" disabled={loading} onClick={refresh}>
        به‌روزرسانی درخواست‌ها
      </button>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {selected ? (
        <section className="omni-panel">
          <button
            className="text-link"
            onClick={() => {
              setSelected(null);
              void refresh();
            }}
          >
            بازگشت به درخواست‌ها
          </button>
          <h2>
            مشتری <bdi>{selected.phone}</bdi>
          </h2>
          {kind === "support" ? (
            <Chat key={selected.id} id={selected.id} staff />
          ) : (
            <CustomDecision
              key={selected.id}
              request={selected}
              onSaved={async () => {
                setSelected(null);
                await refresh();
              }}
            />
          )}
        </section>
      ) : (
        <>
          <div className="request-list">
            {data?.items.map((r) => (
              <button
                className="request-list-item"
                key={r.id}
                onClick={() => {
                  setSelected(r);
                  if (kind === "custom")
                    void api(`/staff/requests/${r.id}/read`, "POST", {
                      lastMessageId: 0,
                    })
                      .then(() =>
                        window.dispatchEvent(new Event("bomish:notifications")),
                      )
                      .catch(() => {});
                }}
              >
                <span>
                  <strong>
                    <bdi>{r.phone}</bdi>
                  </strong>
                  {r.unread && (
                    <span className="badge notification-badge">جدید</span>
                  )}
                </span>
                <span>{r.description.slice(0, 140)}</span>
                <small>
                  {kind === "custom"
                    ? requestStatuses[r.status]
                    : "گفتگو با مشتری"}{" "}
                  · {date(r.updatedAt)}
                </small>
              </button>
            ))}
          </div>
          {data?.total === 0 && (
            <p className="omni-empty">درخواستی وجود ندارد.</p>
          )}
          <div className="inline-actions">
            <button disabled={page <= 1} onClick={() => setPage(page - 1)}>
              قبلی
            </button>
            <button
              disabled={!data || page * 20 >= data.total}
              onClick={() => setPage(page + 1)}
            >
              بعدی
            </button>
          </div>
        </>
      )}
    </>
  );
}
function CustomDecision({
  request: r,
  onSaved,
}: {
  request: CustomerRequest;
  onSaved: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <div className="request-card">
      <p>{r.description}</p>
      <p>مقدار: {r.quantity}</p>
      <p>بودجه کل: {money(r.budgetRials)} تومان</p>
      <p>وضعیت: {requestStatuses[r.status]}</p>
      <form
        className="request-form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          const values = new FormData(e.currentTarget);
          setBusy(true);
          setError("");
          try {
            await api(`/staff/requests/${r.id}`, "PATCH", {
              status: values.get("status"),
              response: values.get("response"),
              version: r.version,
            });
            await onSaved();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <fieldset disabled={busy}>
          <label>
            نتیجه بررسی
            <select
              aria-label="نتیجه بررسی"
              name="status"
              defaultValue={r.status === "new" ? "follow_up" : r.status}
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
              defaultValue={r.response}
            />
          </label>
          <button className="button">ثبت نتیجه</button>
        </fieldset>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </form>
    </div>
  );
}
