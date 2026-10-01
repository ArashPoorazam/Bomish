"use client";
import { useLayoutEffect, useRef } from "react";
import { ArrowUp, Leaf, UserRound } from "lucide-react";

export type ChatDraft = { body: string; key: string };
export const emptyDraft: ChatDraft = { body: "", key: "" };

export function ChatAvatar({
  support = false,
  seed = "",
}: {
  support?: boolean;
  seed?: string;
}) {
  const tone =
    Array.from(seed).reduce((sum, char) => sum + char.charCodeAt(0), 0) % 3;
  return (
    <span
      aria-hidden="true"
      className={`chat-avatar ${support ? "is-support" : `customer-tone-${tone}`}`}
    >
      {support ? <Leaf size={19} /> : <UserRound size={18} />}
    </span>
  );
}

export function WelcomeMessage() {
  return (
    <div className="chat-welcome">
      <ChatAvatar support />
      <div>
        <strong>پشتیبانی بومیش</strong>
        <p>سلام، به بومیش خوش آمدید 🌿 چطور می‌توانیم کمکتان کنیم؟</p>
        <small>پیام خوشامدگویی خودکار</small>
      </div>
    </div>
  );
}

export function MessageComposer({
  body,
  onChange,
  onSend,
  busy,
  first = false,
}: {
  body: string;
  onChange: (body: string) => void;
  onSend: () => void;
  busy: boolean;
  first?: boolean;
}) {
  const input = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    if (!input.current) return;
    input.current.style.height = "auto";
    input.current.style.height = `${Math.min(input.current.scrollHeight, 128)}px`;
  }, [body]);
  return (
    <form
      className="chat-composer"
      onSubmit={(e) => {
        e.preventDefault();
        onSend();
      }}
    >
      <label className="chat-composer-field">
        <span className="sr-only">پیام شما</span>
        <textarea
          ref={input}
          rows={1}
          value={body}
          disabled={busy}
          maxLength={4000}
          required
          placeholder="پیامتان را بنویسید…"
          onChange={(e) => onChange(e.target.value)}
        />
      </label>
      <button
        className="chat-send"
        type="submit"
        disabled={busy || !body.trim()}
        aria-label={
          busy ? "در حال ارسال…" : first ? "شروع گفتگو" : "ارسال پیام"
        }
        title={first ? "شروع گفتگو" : "ارسال پیام"}
      >
        {busy ? (
          <span className="chat-sending">•••</span>
        ) : (
          <ArrowUp size={20} />
        )}
      </button>
    </form>
  );
}
