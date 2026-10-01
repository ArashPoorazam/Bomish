"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import {
  ChatAvatar,
  MessageComposer,
  WelcomeMessage,
  emptyDraft,
  type ChatDraft,
} from "./chat-parts";
import type { ChatMessage } from "./types";

export function Chat({
  id,
  staff = false,
  active = true,
  draft,
  onDraftChange,
  onBusyChange,
}: {
  id: string;
  staff?: boolean;
  active?: boolean;
  draft?: ChatDraft;
  onDraftChange?: (draft: ChatDraft) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [localDraft, setLocalDraft] = useState<ChatDraft>(emptyDraft);
  const currentDraft = draft || localDraft;
  const { body } = currentDraft;
  const updateDraft = onDraftChange || setLocalDraft;
  const activeRef = useRef(active);
  activeRef.current = active;
  const savedScroll = useRef(0);
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
      if (
        !live ||
        pending ||
        !activeRef.current ||
        document.visibilityState !== "visible"
      )
        return;
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
        if (
          staff &&
          activeRef.current &&
          document.visibilityState === "visible"
        ) {
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
  useEffect(() => {
    if (active) void refresh.current();
  }, [active]);
  useLayoutEffect(() => {
    if (active && log.current) log.current.scrollTop = savedScroll.current;
  }, [active]);
  useLayoutEffect(() => {
    if (!log.current || !active) return;
    if (scrollAnchor.current) {
      log.current.scrollTop =
        scrollAnchor.current.top +
        log.current.scrollHeight -
        scrollAnchor.current.height;
      scrollAnchor.current = null;
    } else if (atBottom.current)
      log.current.scrollTop = log.current.scrollHeight;
  }, [messages, active]);
  async function send() {
    if (sending.current || !body.trim()) return;
    sending.current = true;
    onBusyChange?.(true);
    setBusy(true);
    setSendError("");
    const key = currentDraft.key || crypto.randomUUID();
    updateDraft({ body, key });
    try {
      await api(`${prefix}/messages`, "POST", { body, idempotencyKey: key });
      updateDraft(emptyDraft);
      if (!mounted.current) return;
      atBottom.current = true;
      await refresh.current();
    } catch (e) {
      if (mounted.current) setSendError((e as Error).message);
    } finally {
      sending.current = false;
      onBusyChange?.(false);
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <div className="support-chat" aria-busy={busy}>
      <div className="chat-history-tools">
        {hasOlder && (
          <button
            className="text-link"
            disabled={loading}
            onClick={() => older.current()}
          >
            پیام‌های قدیمی‌تر
          </button>
        )}
        <span role="status">{loading ? "در حال دریافت پیام‌ها…" : ""}</span>
      </div>
      <div
        ref={log}
        onScroll={(e) => {
          if (!active) return;
          const el = e.currentTarget;
          savedScroll.current = el.scrollTop;
          atBottom.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < 60;
        }}
        className="chat-messages"
        role="log"
        aria-label="پیام‌های گفتگو"
        aria-live="polite"
        aria-relevant="additions"
      >
        {!loading && !messages.length && <WelcomeMessage />}
        {messages.map((m, index) => {
          const day = new Intl.DateTimeFormat("fa-IR", {
            dateStyle: "medium",
          }).format(new Date(m.createdAt));
          const previous = messages[index - 1];
          const showDate =
            !previous ||
            new Date(previous.createdAt).toDateString() !==
              new Date(m.createdAt).toDateString();
          const outgoing = m.fromStaff === staff;
          return (
            <div key={m.id} className="chat-entry">
              {showDate && (
                <div className="chat-date">
                  <span>{day}</span>
                </div>
              )}
              <article
                className={`chat-message ${m.fromStaff ? "from-staff" : "from-customer"} ${outgoing ? "is-outgoing" : "is-incoming"}`}
              >
                <ChatAvatar support={m.fromStaff} seed={id} />
                <div className="chat-bubble">
                  <strong>
                    {m.fromStaff ? "پشتیبانی بومیش" : staff ? "مشتری" : "شما"}
                  </strong>
                  <p>{m.body}</p>
                  <time dateTime={m.createdAt}>
                    {new Intl.DateTimeFormat("fa-IR", {
                      hour: "2-digit",
                      minute: "2-digit",
                    }).format(new Date(m.createdAt))}
                  </time>
                </div>
              </article>
            </div>
          );
        })}
      </div>
      {error && (
        <div className="chat-feedback" role="alert">
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
        <p className="error chat-feedback" role="alert">
          {sendError}
        </p>
      )}
      <MessageComposer
        body={body}
        busy={busy}
        onSend={send}
        onChange={(body) => updateDraft({ body, key: "" })}
      />
    </div>
  );
}
