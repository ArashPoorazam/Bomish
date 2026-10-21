"use client";
import { useRef, useState } from "react";
import {
  Check,
  Eye,
  EyeOff,
  KeyRound,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { api } from "@/lib/api";
import { useStore } from "../store-provider";
import { Workspace, roleLabels } from "../omnisire/shared";

const passwordFields = [
  {
    name: "currentPassword",
    label: "گذرواژه فعلی",
    autoComplete: "current-password",
  },
  { name: "newPassword", label: "گذرواژه جدید", autoComplete: "new-password" },
  {
    name: "confirmPassword",
    label: "تکرار گذرواژه جدید",
    autoComplete: "new-password",
  },
];

export function StaffAccount({ owner = false }: { owner?: boolean }) {
  const { user } = useStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [visible, setVisible] = useState<Record<string, boolean>>({});
  const confirmation = useRef<HTMLInputElement>(null);
  return (
    <Workspace
      owner={owner}
      title="اطلاعات حساب"
      description="مشخصات حساب و اطلاعات ورود خود را ببینید و گذرواژه‌تان را مدیریت کنید."
    >
      <div className="staff-account-layout">
        <section
          className="omni-panel staff-account-profile"
          aria-labelledby="account-profile-title"
        >
          <div className="staff-account-avatar" aria-hidden="true">
            <UserRound size={30} />
          </div>
          <div className="staff-account-identity">
            <span className="staff-account-eyebrow">حساب کاربری شما</span>
            <h2 id="account-profile-title">
              {user?.fullName || user?.username || "همکار بومیش"}
            </h2>
            <span className="badge">
              {roleLabels[user?.role || ""] || "همکار"}
            </span>
          </div>
          <dl className="staff-account-details">
            <div>
              <dt>نام و نام خانوادگی</dt>
              <dd>{user?.fullName || "ثبت نشده"}</dd>
            </div>
            <div>
              <dt>نام کاربری</dt>
              <dd>
                <bdi>{user?.username || "—"}</bdi>
              </dd>
            </div>
            <div>
              <dt>نقش حساب</dt>
              <dd>{roleLabels[user?.role || ""] || "—"}</dd>
            </div>
            <div>
              <dt>گذرواژه</dt>
              <dd>
                <span
                  aria-label="گذرواژه محافظت‌شده"
                  className="staff-account-masked"
                >
                  ••••••••••••
                </span>
              </dd>
            </div>
          </dl>
          <p className="staff-account-note">
            <ShieldCheck size={20} aria-hidden="true" />
            گذرواژه فعلی نمایش داده نمی‌شود. برای تغییر آن از فرم تغییر گذرواژه
            استفاده کنید.
          </p>
        </section>
        <section
          className="omni-panel staff-account-security"
          aria-labelledby="account-security-title"
        >
          <div className="staff-account-section-heading">
            <span className="staff-account-security-icon">
              <KeyRound size={22} aria-hidden="true" />
            </span>
            <div>
              <h2 id="account-security-title">امنیت و گذرواژه</h2>
              <p>یک گذرواژه اختصاصی برای حساب کاری خود انتخاب کنید.</p>
            </div>
          </div>
          <form
            className="stack"
            onSubmit={async (event) => {
              event.preventDefault();
              if (busy) return;
              const form = event.currentTarget;
              const data = new FormData(form);
              setError("");
              setMessage("");
              if (data.get("newPassword") !== data.get("confirmPassword")) {
                setError("تکرار گذرواژه با گذرواژه جدید یکسان نیست");
                confirmation.current?.focus({ preventScroll: true });
                return;
              }
              setBusy(true);
              try {
                await api("/staff/password", "POST", {
                  currentPassword: data.get("currentPassword"),
                  newPassword: data.get("newPassword"),
                });
                form.reset();
                setVisible({});
                setMessage("گذرواژه تغییر کرد و نشست‌های دیگر حساب بسته شدند.");
              } catch (error) {
                setError((error as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <input
              type="text"
              name="username"
              autoComplete="username"
              value={user?.username || ""}
              readOnly
              hidden
            />
            {passwordFields.map(({ name, label, autoComplete }) => (
              <div className="staff-password-field" key={name}>
                <label htmlFor={name}>{label}</label>
                <div className="staff-password-input">
                  <input
                    id={name}
                    name={name}
                    dir="ltr"
                    ref={name === "confirmPassword" ? confirmation : undefined}
                    type={visible[name] ? "text" : "password"}
                    autoComplete={autoComplete}
                    required
                    minLength={name === "currentPassword" ? undefined : 12}
                    maxLength={256}
                    disabled={busy}
                    aria-describedby={
                      name === "newPassword"
                        ? "password-requirements"
                        : undefined
                    }
                    onChange={() => {
                      setError("");
                      setMessage("");
                    }}
                  />
                  <button
                    type="button"
                    disabled={busy}
                    aria-label={`${visible[name] ? "پنهان کردن" : "نمایش"} ${label}`}
                    aria-pressed={!!visible[name]}
                    aria-controls={name}
                    onClick={() =>
                      setVisible((current) => ({
                        ...current,
                        [name]: !current[name],
                      }))
                    }
                  >
                    {visible[name] ? <EyeOff size={19} /> : <Eye size={19} />}
                  </button>
                </div>
                {name === "newPassword" && (
                  <small id="password-requirements">
                    بین ۱۲ تا ۲۵۶ نویسه؛ متفاوت از گذرواژه فعلی.
                  </small>
                )}
              </div>
            ))}
            <p className="staff-account-session-note">
              پس از تغییر گذرواژه، نشست‌های دیگر این حساب بسته می‌شوند؛ ورود شما
              در این دستگاه حفظ می‌شود.
            </p>
            <div className="staff-account-feedback">
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
              {message && (
                <p className="staff-account-success" role="status">
                  <Check size={18} aria-hidden="true" />
                  {message}
                </p>
              )}
            </div>
            <button className="button staff-account-save" disabled={busy}>
              <KeyRound size={18} aria-hidden="true" />
              {busy ? "در حال ذخیره…" : "تغییر گذرواژه"}
            </button>
          </form>
        </section>
      </div>
    </Workspace>
  );
}
