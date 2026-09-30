"use client";
import { useRef, useState } from "react";
import { MessageCircle, X } from "lucide-react";
import { useStore } from "../store-provider";
import { LoginForm } from "../login-form";
import { api } from "@/lib/api";
import { useLiveQuery } from "@/hooks/use-live-query";
import type { CustomerRequest } from "./types";
import { Chat } from "./chat";

export function SupportButton() {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={trigger}
        className="support-fab"
        aria-label="گفتگو با پشتیبانی"
        onClick={() => {
          setOpen(true);
          dialog.current?.showModal();
        }}
      >
        <MessageCircle size={23} />
        <span>پشتیبانی</span>
      </button>
      <dialog
        ref={dialog}
        className="support-dialog"
        aria-labelledby="support-title"
        onClose={() => {
          setOpen(false);
          trigger.current?.focus();
        }}
      >
        <div className="between">
          <h2 id="support-title">پشتیبانی بومیش</h2>
          <button
            className="icon-button"
            aria-label="بستن گفتگو"
            onClick={() => dialog.current?.close()}
          >
            <X />
          </button>
        </div>
        {open && <SupportConversation />}
      </dialog>
    </>
  );
}
function SupportConversation() {
  const { user } = useStore();
  const { data, error, loading, refresh } = useLiveQuery<CustomerRequest[]>(
    "/requests?kind=support",
    !!user?.authenticated,
    0,
  );
  const [created, setCreated] = useState("");
  const [body, setBody] = useState("");
  const [failure, setFailure] = useState("");
  const [busy, setBusy] = useState(false);
  const key = useRef("");
  if (!user) return <p role="status">در حال دریافت اطلاعات…</p>;
  if (!user.authenticated)
    return (
      <>
        <p>برای حفظ گفتگو و دریافت پاسخ، وارد حساب شوید.</p>
        <LoginForm onSuccess={() => {}} />
      </>
    );
  const id = created || data?.[0]?.id;
  if (id) return <Chat key={id} id={id} />;
  if (error)
    return (
      <div role="alert">
        <p>{error}</p>
        <button onClick={refresh}>تلاش دوباره</button>
      </div>
    );
  if (loading || !data) return <p role="status">در حال دریافت گفتگو…</p>;
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        setBusy(true);
        setFailure("");
        key.current ||= crypto.randomUUID();
        try {
          const result = await api<{ id: string }>("/requests", "POST", {
            kind: "support",
            description: body,
            idempotencyKey: key.current,
          });
          setCreated(result.id);
        } catch (e) {
          setFailure((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <p>سؤالتان را بنویسید؛ تیم بومیش در همین گفتگو پاسخ می‌دهد.</p>
      <label>
        پیام شما
        <textarea
          required
          maxLength={4000}
          disabled={busy}
          value={body}
          onChange={(e) => {
            setBody(e.target.value);
            key.current = "";
          }}
        />
      </label>
      {failure && (
        <p className="error" role="alert">
          {failure}
        </p>
      )}
      <button className="button" disabled={busy || !body.trim()}>
        شروع گفتگو
      </button>
    </form>
  );
}
