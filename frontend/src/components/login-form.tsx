"use client";
import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { useStore } from "./store-provider";
import { digits, fa } from "@/lib/format";
import { Smartphone, ArrowLeft } from "lucide-react";
export function LoginForm({
  onSuccess,
  compact = false,
}: {
  onSuccess: () => void;
  compact?: boolean;
}) {
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
  const normalizedPhone = digits(phone)
    .replace(/\s/g, "")
    .replace(/^(\+98|0098)/, "0");
  async function request() {
    if (busy) return;
    if (!/^09[0-9]{9}$/.test(normalizedPhone)) {
      setError("شماره همراه را با ۰۹ و در ۱۱ رقم وارد کنید.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await api<{ devCode?: string; resendAfter: number }>(
        "/auth/request",
        "POST",
        { phone: normalizedPhone },
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
    if (busy) return;
    if (!sent) {
      await request();
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api("/auth/verify", "POST", {
        phone: normalizedPhone,
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
  const Heading = compact ? "h2" : "h1";
  return (
    <div className={`login-form ${compact ? "login-compact" : ""}`}>
      <span className="login-symbol">
        <Smartphone size={24} />
      </span>
      <span className="login-eyebrow">
        {sent ? "تأیید شماره همراه" : "ورود / ثبت‌نام"}
      </span>
      <Heading>{sent ? "کد تأیید را وارد کنید" : "به بومیش خوش آمدید"}</Heading>
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
              disabled={busy}
              type="tel"
              autoComplete="tel"
              inputMode="tel"
              dir="ltr"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="09121234567"
              maxLength={20}
              required
            />
          </label>
        ) : (
          <>
            <label>
              کد تأیید
              <input
                disabled={busy}
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
      {!sent && (
        <p className="login-footnote">
          ورود امن با کد یک‌بارمصرف؛ بدون نیاز به گذرواژه
        </p>
      )}
    </div>
  );
}
