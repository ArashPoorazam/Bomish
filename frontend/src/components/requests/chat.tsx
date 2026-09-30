"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { date } from "@/lib/format";
import type { ChatMessage } from "./types";

export function Chat({ id, staff = false }: { id: string; staff?: boolean }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const [sendError, setSendError] = useState("");
  const log = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [hasOlder, setHasOlder] = useState(false);
  const older = useRef<() => Promise<void>>(async () => {});
  const scrollAnchor = useRef<{ height: number; top: number } | null>(null);
  const mounted = useRef(true);
  const sending = useRef(false);
  const key = useRef("");
  const refresh = useRef<() => Promise<void>>(async () => {});
  const prefix = `${staff ? "/staff" : ""}/requests/${encodeURIComponent(id)}`;
  useEffect(() => {
    let live = true,
      pending = false,
      initialized = false,
      after = 0,
      before = 0;
    const controller = new AbortController();
    mounted.current = true;
    const load = async (backward = false) => {
      if (!live || pending || document.visibilityState !== "visible") return;
      pending = true;
      setLoading(true);
      try {
        const cursor = backward
          ? `before=${before}`
          : initialized
            ? `after=${after}`
            : "latest=true";
        const batch = await api<ChatMessage[]>(
          `${prefix}/messages?${cursor}`,
          "GET",
          undefined,
          controller.signal,
        );
        if (!live) return;
        if (backward && log.current)
          scrollAnchor.current = {
            height: log.current.scrollHeight,
            top: log.current.scrollTop,
          };
        if (backward || !initialized) {
          setHasOlder(batch.length === 100);
          if (batch.length) before = batch[0].id;
        }
        if (!backward && batch.length) after = batch[batch.length - 1].id;
        initialized = true;
        setMessages((old) => {
          const unique = new Map([...old, ...batch].map((m) => [m.id, m]));
          return [...unique.values()].sort((a, b) => a.id - b.id);
        });
        if (staff && document.visibilityState === "visible") {
          await api(
            `${prefix}/read`,
            "POST",
            { lastMessageId: after },
            controller.signal,
          );
          if (live) window.dispatchEvent(new Event("bomish:notifications"));
        }
        if (live) setError("");
      } catch (e) {
        if (live) setError((e as Error).message);
      } finally {
        pending = false;
        if (live) setLoading(false);
      }
    };
    refresh.current = () => load();
    older.current = () => load(true);
    void load();
    const visible = () => {
      if (document.visibilityState === "visible") void load();
    };
    const timer = window.setInterval(visible, 5000);
    document.addEventListener("visibilitychange", visible);
    return () => {
      live = false;
      mounted.current = false;
      controller.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [prefix, staff]);
  useLayoutEffect(() => {
    if (!log.current) return;
    if (scrollAnchor.current) {
      log.current.scrollTop =
        scrollAnchor.current.top +
        log.current.scrollHeight -
        scrollAnchor.current.height;
      scrollAnchor.current = null;
    } else if (atBottom.current)
      log.current.scrollTop = log.current.scrollHeight;
  }, [messages]);
  return (
    <div className="support-chat">
      {hasOlder && (
        <button disabled={loading} onClick={() => older.current()}>
          پیام‌های قدیمی‌تر
        </button>
      )}
      {loading && <p role="status">در حال دریافت پیام‌ها…</p>}
      <div
        ref={log}
        onScroll={(e) => {
          const el = e.currentTarget;
          atBottom.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < 60;
        }}
        className="chat-messages"
        role="log"
        aria-label="پیام‌های گفتگو"
        aria-live="polite"
      >
        {!messages.length && (
          <p className="muted">پیام‌های گفتگو اینجا نمایش داده می‌شوند.</p>
        )}
        {messages.map((m) => (
          <article
            key={m.id}
            className={`chat-message ${m.fromStaff ? "from-staff" : "from-customer"}`}
          >
            <strong>{m.fromStaff ? "پشتیبانی بومیش" : "مشتری"}</strong>
            <p>{m.body}</p>
            <small>{date(m.createdAt)}</small>
          </article>
        ))}
      </div>
      {error && (
        <div role="alert">
          <p className="error">{error}</p>
          <button
            className="text-link"
            disabled={loading}
            onClick={() => refresh.current()}
          >
            تلاش دوباره
          </button>
        </div>
      )}
      {sendError && (
        <p className="error" role="alert">
          {sendError}
        </p>
      )}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (sending.current || !body.trim()) return;
          sending.current = true;
          setBusy(true);
          setSendError("");
          key.current ||= crypto.randomUUID();
          try {
            await api(`${prefix}/messages`, "POST", {
              body,
              idempotencyKey: key.current,
            });
            if (!mounted.current) return;
            setBody("");
            key.current = "";
            await refresh.current();
          } catch (e) {
            if (mounted.current) setSendError((e as Error).message);
          } finally {
            sending.current = false;
            if (mounted.current) setBusy(false);
          }
        }}
      >
        <label>
          پیام شما
          <textarea
            value={body}
            disabled={busy}
            maxLength={4000}
            required
            onChange={(e) => {
              setBody(e.target.value);
              key.current = "";
            }}
          />
        </label>
        <button className="button" disabled={busy || !body.trim()}>
          {busy ? "در حال ارسال…" : "ارسال پیام"}
        </button>
      </form>
    </div>
  );
}
