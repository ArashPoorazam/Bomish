"use client";
import { useEffect, useRef, useState } from "react";
import { useStore } from "../store-provider";
import { LoginForm } from "../login-form";
import { api } from "@/lib/api";
import { useLiveQuery } from "@/hooks/use-live-query";
import type { CustomerRequest } from "./types";
import { Chat } from "./chat";
import { MessageComposer, WelcomeMessage, chatPayload } from "./chat-parts";

export function SupportConversation({ active }: { active: boolean }) {
  const { user, sessionError, refresh: refreshSession } = useStore();
  const { data, error, loading, refresh } = useLiveQuery<CustomerRequest[]>(
    "/requests?kind=support",
    !!user?.authenticated,
    0,
  );
  const [created, setCreated] = useState("");
  const [image, setImage] = useState<File>();
  const [body, setBody] = useState("");
  const [failure, setFailure] = useState("");
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  const mounted = useRef(true);
  const key = useRef("");
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  if (!user)
    return (
      <div className="chat-feedback" role={sessionError ? "alert" : "status"}>
        {sessionError || "در حال دریافت اطلاعات…"}
        {sessionError && (
          <button onClick={() => void refreshSession().catch(() => {})}>
            تلاش دوباره
          </button>
        )}
      </div>
    );
  if (!user.authenticated)
    return (
      <div className="support-start">
        <WelcomeMessage />
        <div className="support-signin">
          <p className="support-signin-note">
            برای حفظ گفتگو و دریافت پاسخ، وارد حساب شوید.
          </p>
          <LoginForm compact onSuccess={() => {}} />
        </div>
      </div>
    );
  const id = created || data?.[0]?.id;
  if (id) return <Chat key={id} id={id} active={active} />;
  if (error)
    return (
      <div className="chat-feedback" role="alert">
        <p>{error}</p>
        <button className="text-link" onClick={refresh}>
          تلاش دوباره
        </button>
      </div>
    );
  if (loading || !data)
    return (
      <p className="chat-feedback" role="status">
        در حال دریافت گفتگو…
      </p>
    );
  async function send() {
    if (sending.current || (!body.trim() && !image)) return;
    sending.current = true;
    setBusy(true);
    setFailure("");
    key.current ||= crypto.randomUUID();
    try {
      const result = await api<{ id: string }>(
        "/requests",
        "POST",
        chatPayload(
          {
            kind: "support",
            description: body,
            idempotencyKey: key.current,
          },
          image,
        ),
      );
      if (mounted.current) setCreated(result.id);
    } catch (e) {
      if (mounted.current) setFailure((e as Error).message);
    } finally {
      sending.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <div className="support-chat support-new-chat">
      <div className="chat-messages" role="log" aria-label="پیام‌های گفتگو">
        <WelcomeMessage />
        <p className="chat-intro">
          درباره محصولات، سفارش یا ارسال سؤالی دارید؟
          <br />
          همین‌جا برایمان بنویسید.
        </p>
      </div>
      {failure && (
        <p className="error chat-feedback" role="alert">
          {failure}
        </p>
      )}
      <MessageComposer
        first
        image={image}
        onImageChange={(file) => {
          setImage(file);
          key.current = "";
        }}
        body={body}
        busy={busy}
        onSend={send}
        onChange={(value) => {
          setBody(value);
          key.current = "";
        }}
      />
    </div>
  );
}
