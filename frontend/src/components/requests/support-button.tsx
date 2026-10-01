"use client";
import { useEffect, useRef, useState } from "react";
import { MessageCircle, Minus, ChevronDown } from "lucide-react";
import { useStore } from "../store-provider";
import { LoginForm } from "../login-form";
import { api } from "@/lib/api";
import { useLiveQuery } from "@/hooks/use-live-query";
import type { CustomerRequest } from "./types";
import { Chat } from "./chat";
import { ChatAvatar, MessageComposer, WelcomeMessage } from "./chat-parts";

export function SupportButton() {
  const { user } = useStore();
  const [open, setOpen] = useState(false);
  const [visited, setVisited] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  useEffect(() => {
    if (open) closeButton.current?.focus();
  }, [open]);
  useEffect(() => {
    const viewport = window.visualViewport;
    const resize = () => {
      if (!viewport || !panel.current) return;
      const bottom = Math.max(
        0,
        window.innerHeight - viewport.height - viewport.offsetTop,
      );
      panel.current.style.setProperty("--keyboard-inset", `${bottom}px`);
      panel.current.style.setProperty(
        "--available-height",
        `${viewport.height}px`,
      );
    };
    resize();
    viewport?.addEventListener("resize", resize);
    viewport?.addEventListener("scroll", resize);
    return () => {
      viewport?.removeEventListener("resize", resize);
      viewport?.removeEventListener("scroll", resize);
    };
  }, []);
  return (
    <>
      <button
        ref={trigger}
        className="support-fab"
        aria-label="گفتگو با پشتیبانی"
        aria-expanded={open}
        aria-controls="support-panel"
        onClick={() => {
          if (open) close();
          else {
            setVisited(true);
            setOpen(true);
          }
        }}
      >
        {open ? <ChevronDown size={22} /> : <MessageCircle size={22} />}
        <span>پشتیبانی</span>
      </button>
      <section
        ref={panel}
        id="support-panel"
        className="support-panel"
        role="dialog"
        aria-modal="false"
        aria-labelledby="support-title"
        hidden={!open}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            close();
          }
        }}
      >
        <header className="support-panel-header">
          <ChatAvatar support />
          <div>
            <h2 id="support-title">پشتیبانی بومیش</h2>
            <p>در کنار شما، از انتخاب تا سفارش</p>
          </div>
          <button
            ref={closeButton}
            className="icon-button"
            aria-label="بستن گفتگو"
            title="کوچک کردن گفتگو"
            onClick={close}
          >
            <Minus size={21} />
          </button>
        </header>
        {visited && (
          <SupportConversation
            key={user?.authenticated ? "customer" : "guest"}
            active={open}
          />
        )}
      </section>
    </>
  );
}
function SupportConversation({ active }: { active: boolean }) {
  const { user, sessionError, refresh: refreshSession } = useStore();
  const { data, error, loading, refresh } = useLiveQuery<CustomerRequest[]>(
    "/requests?kind=support",
    !!user?.authenticated,
    0,
  );
  const [created, setCreated] = useState("");
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
    if (sending.current || !body.trim()) return;
    sending.current = true;
    setBusy(true);
    setFailure("");
    key.current ||= crypto.randomUUID();
    try {
      const result = await api<{ id: string }>("/requests", "POST", {
        kind: "support",
        description: body,
        idempotencyKey: key.current,
      });
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
