"use client";
import { AuthLayout } from "../auth-layout";
import { Eye, EyeOff, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, session } from "@/lib/api";
import { digits } from "@/lib/format";
import { useStore } from "@/components/store-provider";
export function StaffLogin() {
  const { refresh } = useStore();
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [username, setUsername] = useState(""),
    [password, setPassword] = useState(""),
    [code, setCode] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <AuthLayout staff>
      <div className="login-form">
        <span className="login-symbol">
          <ShieldCheck size={24} />
        </span>
        <span className="login-eyebrow">فضای کار بومیش</span>
        <h1>ورود همکاران</h1>
        <p>نام کاربری، گذرواژه و کد برنامه رمزساز را وارد کنید.</p>
        <form
          className="stack"
          onSubmit={async (e) => {
            e.preventDefault();
            if (busy) return;
            setBusy(true);
            setError("");
            try {
              await api("/staff/login", "POST", {
                username,
                password,
                code: digits(code),
              });
              await refresh();
              const next = await session();
              router.replace(
                next.role === "owner"
                  ? "/omnisire"
                  : next.permissions?.[0] === "sales"
                    ? "/staff/sales"
                    : "/staff",
              );
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            نام کاربری
            <input
              disabled={busy}
              autoComplete="username"
              required
              dir="ltr"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </label>
          <label>
            گذرواژه
            <span className="password-field">
              <input
                disabled={busy}
                dir="ltr"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                aria-label={
                  showPassword ? "پنهان کردن گذرواژه" : "نمایش گذرواژه"
                }
                aria-pressed={showPassword}
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? <EyeOff size={19} /> : <Eye size={19} />}
              </button>
            </span>
          </label>
          <label>
            کد برنامه رمزساز
            <input
              disabled={busy}
              autoComplete="one-time-code"
              inputMode="numeric"
              maxLength={6}
              required
              dir="ltr"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </label>
          <button className="button" disabled={busy}>
            {busy ? "در حال ورود…" : "ورود به فضای کار"}
          </button>
          {error ? (
            <p role="alert" className="error">
              {error}
            </p>
          ) : null}
        </form>
        <p className="login-footnote">
          <ShieldCheck size={15} /> ورود محافظت‌شده با تأیید دومرحله‌ای
        </p>
      </div>
    </AuthLayout>
  );
}
