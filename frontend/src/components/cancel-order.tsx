"use client";
import { useRef, useState } from "react";
import type { Order } from "@/lib/types";
import { api } from "@/lib/api";

export function CancelOrder({
  order,
  onCancelled,
}: {
  order: Order;
  onCancelled: () => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  if (done)
    return (
      <p role="status">
        سفارش لغو شد. در صورت پرداخت، مبلغ طی ۲۴ تا ۴۸ ساعت بازپرداخت می‌شود.
      </p>
    );
  if (!["pending", "paid", "packing", "review"].includes(order.status))
    return null;
  return (
    <>
      <button
        className="button secondary"
        onClick={() => {
          setError("");
          dialog.current?.showModal();
        }}
      >
        لغو سفارش
      </button>
      <dialog
        ref={dialog}
        className="shipping-dialog"
        aria-labelledby={`cancel-title-${order.id}`}
        onCancel={(e) => {
          if (busy) e.preventDefault();
        }}
      >
        <h2 id={`cancel-title-${order.id}`}>
          لغو سفارش {order.id.slice(0, 8)}
        </h2>
        <p>
          آیا از لغو این سفارش مطمئن هستید؟ پس از لغو، آماده‌سازی و ارسال سفارش
          متوقف می‌شود.
        </p>
        <p>
          در صورت پرداخت، مبلغ سفارش طی ۲۴ تا ۴۸ ساعت به شما بازپرداخت می‌شود.
        </p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button
            autoFocus
            className="button secondary"
            disabled={busy}
            onClick={() => dialog.current?.close()}
          >
            انصراف
          </button>
          <button
            className="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await api(`/orders/${order.id}/cancel`, "POST", {});
                dialog.current?.close();
                setDone(true);
                await onCancelled();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "در حال لغو…" : "تأیید لغو سفارش"}
          </button>
        </div>
      </dialog>
    </>
  );
}
