"use client";
import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { useStore } from "./store-provider";
import { digits, fa } from "@/lib/format";
import { Smartphone, ArrowLeft } from "lucide-react";
export function LoginForm({ onSuccess }: { onSuccess: () => void }) {
  const { refresh } = useStore();
  const [phone, setPhone] = useState(""),
    [code, setCode] = useState(""),
    [sent, setSent] = useState(false),
    [error, setError] = useState(""),
    [devCode, setDevCode] = useState(""),
    [busy, setBusy] = useState(false),
    [remaining, setRemaining] = useState(0);
  useEffect(() => {
    if (remaining <= 0) return;
    const t = setTimeout(() => setRemaining((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [remaining]);
  async function request() {
    setBusy(true);
    setError("");
    try {
      const result = await api<{ devCode?: string; resendAfter: number }>(
        "/auth/request",
        "POST",
        { phone: digits(phone) },
      );
      setSent(true);
      setDevCode(result.devCode || "");
      setRemaining(result.resendAfter);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!sent) {
      await request();
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api("/auth/verify", "POST", {
        phone: digits(phone),
        code: digits(code),
      });
      await refresh();
      onSuccess();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="form-card">
      <Smartphone size={28} />
      <h1>{sent ? "کد تأیید را وارد کنید" : "به بومیش خوش آمدید"}</h1>
      <p>
        {sent
          ? `کد تأیید شماره ${phone} را وارد کنید.`
          : "با شماره همراهتان وارد شوید. اگر حسابی ندارید، برایتان ساخته می‌شود."}
      </p>
      <form className="stack" onSubmit={submit}>
        {!sent ? (
          <label>
            شماره همراه
            <input
              type="tel"
              autoComplete="tel"
              inputMode="tel"
              dir="ltr"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="۰۹۱۲۱۲۳۴۵۶۷"
              required
            />
          </label>
        ) : (
          <>
            <label>
              کد تأیید
              <input
                autoFocus
                autoComplete="one-time-code"
                inputMode="numeric"
                maxLength={6}
                dir="ltr"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
              />
            </label>
            {devCode ? (
              <div className="dev-note">
                پیامک آزمایشی · کد ورود: <strong dir="ltr">{devCode}</strong>
                <br />
                این نسخه پیامک واقعی ارسال نمی‌کند.
              </div>
            ) : null}
          </>
        )}
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
        <button className="button full" disabled={busy}>
          {busy ? "کمی صبر کنید…" : sent ? "تأیید و ادامه" : "دریافت کد تأیید"}
          <ArrowLeft size={18} />
        </button>
        {sent ? (
          <div className="between">
            <button
              className="text-link icon-button"
              type="button"
              disabled={busy}
              onClick={() => {
                setSent(false);
                setCode("");
                setDevCode("");
              }}
            >
              تغییر شماره
            </button>
            <button
              type="button"
              className="text-link icon-button"
              onClick={request}
              disabled={busy || remaining > 0}
            >
              {remaining > 0
                ? `ارسال دوباره (${fa(remaining)})`
                : "ارسال دوباره"}
            </button>
          </div>
        ) : null}
      </form>
    </div>
  );
}
