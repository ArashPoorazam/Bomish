"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { ArrowRight } from "lucide-react";
import { api } from "@/lib/api";
import { AccountShell } from "../account-shell";
export function CustomOrderForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const key = useRef("");
  const lock = useRef(false);
  return (
    <AccountShell section="custom" title="سفارش اختصاصی جدید">
      <Link className="text-link account-back" href="/account?section=custom">
        <ArrowRight size={16} /> بازگشت به درخواست‌ها
      </Link>
      <form
        className="account-panel custom-order-form"
        onChange={() => {
          key.current = "";
        }}
        onSubmit={async (e) => {
          e.preventDefault();
          if (lock.current) return;
          const values = new FormData(e.currentTarget);
          lock.current = true;
          setBusy(true);
          setFailure("");
          key.current ||= crypto.randomUUID();
          try {
            await api("/requests", "POST", {
              kind: "custom",
              description: values.get("description"),
              quantity: values.get("quantity"),
              budgetRials: Number(values.get("budget")) * 10,
              idempotencyKey: key.current,
            });
            router.replace("/account?section=custom&created=1");
          } catch (e) {
            setFailure((e as Error).message);
            lock.current = false;
            setBusy(false);
          }
        }}
      >
        <div className="custom-form-intro">
          <h3>چه محصولی نیاز دارید؟</h3>
          <p>محصول دلخواه، مقدار مورد نیاز و بودجه کل پیشنهادی را بنویسید.</p>
        </div>
        <fieldset disabled={busy}>
          <label>
            شرح محصول
            <textarea
              name="description"
              required
              maxLength={4000}
              rows={5}
              placeholder="مثلاً ترکیب ادویه بدون نمک، با عطر ملایم…"
            />
          </label>
          <div className="custom-form-fields">
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
                inputMode="numeric"
              />
            </label>
          </div>
          <p className="custom-form-note">
            پذیرش درخواست به معنی پرداخت یا ثبت سفارش نهایی نیست؛ جزئیات با شما
            هماهنگ می‌شود.
          </p>
          <div className="custom-form-actions">
            <button className="button">
              {busy ? "در حال ثبت…" : "ثبت درخواست"}
            </button>
            {!busy && (
              <Link className="button secondary" href="/account?section=custom">
                انصراف
              </Link>
            )}
          </div>
        </fieldset>
        {failure && (
          <p role="alert" className="error">
            {failure}
          </p>
        )}
      </form>
    </AccountShell>
  );
}
