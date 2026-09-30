"use client";
import { useState } from "react";
import { MapPin, Plus, Pencil, Trash2 } from "lucide-react";
import type { Address } from "@/lib/types";
import { api } from "@/lib/api";
import { AddressEditor } from "./address-book";
export function AccountAddresses({
  addresses,
  onChanged,
}: {
  addresses: Address[];
  onChanged: (addresses: Address[]) => void;
}) {
  const [editing, setEditing] = useState<Address | "new" | null>(null),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  return (
    <div className="account-addresses">
      <div className="between">
        <p>برای خریدهای بعدی، نشانی‌هایتان را آماده نگه دارید.</p>
        <button
          className="button"
          disabled={!!editing || !!busy}
          onClick={() => {
            setEditing("new");
            setNotice("");
          }}
        >
          <Plus size={18} />
          نشانی جدید
        </button>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="save-notice">
          {notice}
        </p>
      )}
      {editing && (
        <AddressEditor
          key={editing === "new" ? "new" : editing.id}
          initial={editing === "new" ? undefined : editing}
          onCancel={() => setEditing(null)}
          onSaved={(saved) => {
            onChanged(
              editing === "new"
                ? [...addresses, saved]
                : addresses.map((a) => (a.id === saved.id ? saved : a)),
            );
            setEditing(null);
            setNotice("نشانی با موفقیت ذخیره شد.");
          }}
        />
      )}
      {!addresses.length && !editing && (
        <div className="empty-state">
          <MapPin size={32} />
          <h3>هنوز نشانی ذخیره نکرده‌اید</h3>
          <p>با افزودن نشانی، خرید بعدی ساده‌تر می‌شود.</p>
        </div>
      )}
      <div className="address-grid">
        {addresses.map((a) => (
          <article className="address-card" key={a.id}>
            <MapPin size={22} />
            <h3>{a.recipient}</h3>
            <p>
              {a.province}، {a.city}، {a.street}
            </p>
            <p className="muted">
              شماره همراه: <bdi>{a.phone}</bdi>
              <br />
              کد پستی: <bdi>{a.postalCode}</bdi>
            </p>
            <div className="address-actions">
              <button
                disabled={!!editing || !!busy}
                onClick={() => {
                  setEditing(a);
                  setNotice("");
                }}
              >
                <Pencil size={16} />
                ویرایش
              </button>
              <button
                disabled={!!editing || !!busy}
                onClick={async () => {
                  if (
                    !window.confirm(
                      `نشانی ${a.recipient} حذف شود؟ این کار نشانی سفارش‌های قبلی را تغییر نمی‌دهد.`,
                    )
                  )
                    return;
                  setBusy(a.id);
                  setError("");
                  setNotice("");
                  try {
                    await api(
                      `/addresses/${encodeURIComponent(a.id)}`,
                      "DELETE",
                    );
                    onChanged(addresses.filter((x) => x.id !== a.id));
                    setNotice("نشانی حذف شد.");
                  } catch (e) {
                    setError((e as Error).message);
                  } finally {
                    setBusy("");
                  }
                }}
              >
                <Trash2 size={16} />
                {busy === a.id ? "در حال حذف…" : "حذف"}
              </button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
