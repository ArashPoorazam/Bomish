"use client";
import { useEffect, useRef, useState } from "react";
import { MessageCircle, Minus, ChevronDown } from "lucide-react";
import { useStore } from "../store-provider";
import dynamic from "next/dynamic";
import { ChatAvatar } from "./chat-avatar";

const SupportConversation = dynamic(
  () =>
    import("./support-conversation").then(
      (module) => module.SupportConversation,
    ),
  {
    loading: () => (
      <p className="chat-feedback" role="status">
        در حال دریافت گفتگو…
      </p>
    ),
  },
);

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
