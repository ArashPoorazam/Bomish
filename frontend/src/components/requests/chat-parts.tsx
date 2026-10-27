"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowUp, ImagePlus, X } from "lucide-react";

import { ChatAvatar } from "./chat-avatar";
export { ChatAvatar } from "./chat-avatar";

export type ChatDraft = { body: string; key: string; image?: File };
export const emptyDraft: ChatDraft = { body: "", key: "" };

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
  image,
  onImageChange,
}: {
  body: string;
  onChange: (body: string) => void;
  onSend: () => void;
  busy: boolean;
  first?: boolean;
  image?: File;
  onImageChange?: (image?: File) => void;
}) {
  const [preview, setPreview] = useState("");
  const [imageError, setImageError] = useState("");
  useEffect(() => {
    if (!image) {
      setPreview("");
      return;
    }
    const url = URL.createObjectURL(image);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [image]);
  const input = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    if (!input.current) return;
    input.current.style.height = "auto";
    input.current.style.height = `${Math.min(input.current.scrollHeight, 128)}px`;
  }, [body]);
  return (
    <>
      {imageError && (
        <p className="error chat-feedback" role="alert">
          {imageError}
        </p>
      )}
      {image && (
        <div className="chat-attachment-preview">
          {preview && <img src={preview} alt="پیش‌نمایش تصویر" />}
          <span>{image.name}</span>
          <button
            type="button"
            className="icon-button"
            aria-label="حذف تصویر"
            disabled={busy}
            onClick={() => onImageChange?.(undefined)}
          >
            <X size={18} />
          </button>
        </div>
      )}
      <form
        className="chat-composer"
        onSubmit={(e) => {
          e.preventDefault();
          onSend();
        }}
      >
        {onImageChange && (
          <label className="chat-attach icon-button" title="افزودن تصویر">
            <ImagePlus size={22} />
            <span className="sr-only">افزودن تصویر</span>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                if (
                  !["image/jpeg", "image/png", "image/webp"].includes(
                    file.type,
                  ) ||
                  file.size > 5 * 1024 * 1024
                ) {
                  setImageError(
                    "تصویر JPEG، PNG یا WebP با حجم حداکثر ۵ مگابایت انتخاب کنید.",
                  );
                  return;
                }
                setImageError("");
                onImageChange(file);
              }}
            />
          </label>
        )}
        <label className="chat-composer-field">
          <span className="sr-only">پیام شما</span>
          <textarea
            aria-label="پیام شما"
            ref={input}
            rows={1}
            value={body}
            disabled={busy}
            maxLength={4000}
            required={!image}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing &&
                e.keyCode !== 229
              ) {
                e.preventDefault();
                if (!busy && (body.trim() || image)) onSend();
              }
            }}
            placeholder="پیامتان را بنویسید…"
            onChange={(e) => onChange(e.target.value)}
          />
        </label>
        <button
          className="chat-send"
          type="submit"
          disabled={busy || (!body.trim() && !image)}
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
    </>
  );
}

export function chatPayload(payload: Record<string, unknown>, image?: File) {
  if (!image) return payload;
  const form = new FormData();
  form.append("payload", JSON.stringify(payload));
  form.append("image", image);
  return form;
}
