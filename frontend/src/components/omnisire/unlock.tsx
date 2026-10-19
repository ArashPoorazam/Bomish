"use client";
import { useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { digits } from "@/lib/format";
import { useStore } from "../store-provider";
import { AuthLayout } from "../auth-layout";

export function OmnisireUnlock() {
  const { refresh } = useStore();
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <AuthLayout staff>
      <div className="login-form">
        <h1>ورود به امنی‌سایر</h1>
        <p>برای ورود به فضای مالک، کد برنامه رمزساز خود را وارد کنید.</p>
        <form
          className="stack"
          onSubmit={async (event) => {
            event.preventDefault();
            if (busy) return;
            setBusy(true);
            setError("");
            try {
              await api("/omnisire/unlock", "POST", { code: digits(code) });
              await refresh();
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            کد برنامه رمزساز
            <input
              required
              autoComplete="one-time-code"
              inputMode="numeric"
              maxLength={6}
              minLength={6}
              dir="ltr"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              disabled={busy}
            />
          </label>
          <button className="button" disabled={busy}>
            {busy ? "در حال بررسی…" : "ورود به امنی‌سایر"}
          </button>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
        </form>
        <Link href="/staff">بازگشت به فضای همکاران</Link>
      </div>
    </AuthLayout>
  );
}
