"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import { Workspace, Panel } from "../omnisire/shared";

export function StaffPassword() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  return (
    <Workspace title="تغییر گذرواژه">
      <Panel title="گذرواژه حساب">
        <form
          className="stack"
          onSubmit={async (e) => {
            e.preventDefault();
            const form = e.currentTarget;
            const data = new FormData(form);
            setError("");
            setMessage("");
            if (data.get("newPassword") !== data.get("confirmPassword")) {
              setError("تکرار گذرواژه با گذرواژه جدید یکسان نیست");
              return;
            }
            setBusy(true);
            try {
              await api("/staff/password", "POST", {
                currentPassword: data.get("currentPassword"),
                newPassword: data.get("newPassword"),
              });
              form.reset();
              setMessage("گذرواژه تغییر کرد و نشست‌های دیگر حساب بسته شدند.");
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            گذرواژه فعلی
            <input
              type="password"
              name="currentPassword"
              autoComplete="current-password"
              required
              maxLength={256}
              disabled={busy}
            />
          </label>
          <label>
            گذرواژه جدید
            <input
              type="password"
              name="newPassword"
              autoComplete="new-password"
              required
              minLength={12}
              maxLength={256}
              disabled={busy}
            />
          </label>
          <small>گذرواژه جدید باید بین ۱۲ تا ۲۵۶ نویسه باشد.</small>
          <label>
            تکرار گذرواژه جدید
            <input
              type="password"
              name="confirmPassword"
              autoComplete="new-password"
              required
              minLength={12}
              maxLength={256}
              disabled={busy}
            />
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {message && <p role="status">{message}</p>}
          <button className="button" disabled={busy}>
            {busy ? "در حال ذخیره…" : "تغییر گذرواژه"}
          </button>
        </form>
      </Panel>
    </Workspace>
  );
}
