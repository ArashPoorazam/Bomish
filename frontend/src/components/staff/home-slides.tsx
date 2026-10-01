"use client";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ImagePlus,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { api } from "@/lib/api";
import { fa } from "@/lib/format";
import type { HomeSlide } from "@/lib/types";
import { useLiveQuery } from "@/hooks/use-live-query";
import type { HomeEditorState } from "./home-management";

type FailedUpload = { file: File; message: string };
export function HomeSlidesEditor({
  onState,
}: {
  onState: (state: HomeEditorState) => void;
}) {
  const saved = useLiveQuery<HomeSlide[]>("/staff/home/slides", true, 0);
  const [slides, setSlides] = useState<HomeSlide[]>([]);
  const [baseline, setBaseline] = useState<HomeSlide[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [failures, setFailures] = useState<FailedUpload[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const lock = useRef(false);
  const initialized = useRef(false);
  const dirty =
    baseline !== null && JSON.stringify(slides) !== JSON.stringify(baseline);
  useEffect(() => {
    if (saved.data && !initialized.current) {
      initialized.current = true;
      setSlides(saved.data);
      setBaseline(saved.data);
    }
  }, [saved.data]);
  useEffect(() => {
    onState({ dirty, busy: busy || uploading });
  }, [dirty, busy, uploading, onState]);
  const update = (next: HomeSlide[]) => {
    setSlides(next);
    setNotice("");
  };
  async function upload(files: File[]) {
    if (lock.current || !files.length || baseline === null) return;
    lock.current = true;
    setUploading(true);
    setFailures([]);
    setNotice("");
    const failed: FailedUpload[] = [];
    for (const file of files) {
      try {
        if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
          throw new Error("فقط JPG، PNG یا WebP انتخاب کنید.");
        if (file.size >= 8 * 1024 * 1024)
          throw new Error("حجم تصویر باید کمتر از ۸ مگابایت باشد.");
        const body = new FormData();
        body.set("image", file);
        const result = await api<{ url: string }>(
          "/staff/uploads",
          "POST",
          body,
        );
        setSlides((old) => [...old, { image: result.url, alt: "" }]);
      } catch (e) {
        failed.push({ file, message: (e as Error).message });
      }
    }
    setFailures(failed);
    lock.current = false;
    setUploading(false);
  }
  function move(i: number, offset: number) {
    const next = [...slides];
    [next[i], next[i + offset]] = [next[i + offset], next[i]];
    update(next);
  }
  return (
    <section
      className="home-editor omni-panel"
      aria-labelledby="home-images-title"
    >
      <div className="home-editor-heading">
        <div>
          <span className="eyebrow">نمای اول فروشگاه</span>
          <h2 id="home-images-title">تصاویر صفحه اصلی</h2>
          <p>تصاویر به ترتیب این فهرست، هر ۵ ثانیه نمایش داده می‌شوند.</p>
        </div>
        <span className="badge">{fa(slides.length)} تصویر</span>
      </div>
      {!baseline && !saved.error && <p role="status">در حال دریافت تصاویر…</p>}
      {saved.error && (
        <div role="alert">
          <p className="error">{saved.error}</p>
          <button onClick={saved.refresh} disabled={saved.loading}>
            تلاش دوباره برای تصاویر
          </button>
        </div>
      )}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (lock.current || !dirty) return;
          lock.current = true;
          setBusy(true);
          setError("");
          setNotice("");
          try {
            const next = slides.map((slide) => ({
              ...slide,
              alt: slide.alt.trim(),
            }));
            await api("/staff/home/slides", "PUT", next);
            setSlides(next);
            setBaseline(next);
            setNotice("تصاویر صفحه اصلی ذخیره شدند.");
          } catch (e) {
            setError((e as Error).message);
          } finally {
            lock.current = false;
            setBusy(false);
          }
        }}
      >
        <fieldset disabled={busy || uploading || baseline === null}>
          <label
            className="home-upload"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (!busy && !uploading)
                void upload(Array.from(e.dataTransfer.files));
            }}
          >
            <UploadCloud size={27} />
            <strong>
              {uploading
                ? "در حال بارگذاری تصاویر…"
                : "تصاویر را اینجا رها کنید"}
            </strong>
            <span>
              <ImagePlus size={16} /> انتخاب تصاویر
            </span>
            <small>JPG، PNG یا WebP · هر تصویر کمتر از ۸ مگابایت</small>
            <input
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp"
              aria-label="بارگذاری تصاویر صفحه اصلی"
              onChange={(e) => {
                const files = Array.from(e.target.files || []);
                e.target.value = "";
                void upload(files);
              }}
            />
          </label>
          <ol className="home-slide-list">
            {slides.map((slide, i) => (
              <li key={slide.image + i}>
                <div className="home-slide-preview">
                  <Image src={slide.image} alt={slide.alt} fill sizes="240px" />
                  <span>{fa(i + 1)}</span>
                </div>
                <label>
                  توضیح تصویر {fa(i + 1)}
                  <input
                    value={slide.alt}
                    required
                    maxLength={300}
                    placeholder="توضیح کوتاه از محتوای تصویر"
                    onChange={(e) =>
                      update(
                        slides.map((s, index) =>
                          index === i ? { ...s, alt: e.target.value } : s,
                        ),
                      )
                    }
                  />
                </label>
                <div className="home-item-actions">
                  <button
                    type="button"
                    aria-label={`تصویر ${fa(i + 1)} بالاتر`}
                    disabled={i === 0}
                    onClick={() => move(i, -1)}
                  >
                    <ArrowUp size={17} />
                  </button>
                  <button
                    type="button"
                    aria-label={`تصویر ${fa(i + 1)} پایین‌تر`}
                    disabled={i === slides.length - 1}
                    onClick={() => move(i, 1)}
                  >
                    <ArrowDown size={17} />
                  </button>
                  <button
                    type="button"
                    aria-label={`حذف تصویر ${fa(i + 1)}`}
                    onClick={() =>
                      update(slides.filter((_, index) => index !== i))
                    }
                  >
                    <Trash2 size={17} />
                  </button>
                </div>
              </li>
            ))}
          </ol>
          {baseline !== null && !slides.length && (
            <p className="home-editor-empty">
              تصویری انتخاب نشده است؛ تصویر پیش‌فرض بومیش نمایش داده می‌شود.
            </p>
          )}
          <div className="home-editor-footer">
            <button className="button" disabled={!dirty}>
              {busy ? "در حال ذخیره…" : "ذخیره تصاویر"}
            </button>
            <span>
              {dirty
                ? "تغییرات ذخیره نشده"
                : "پس از ذخیره، تغییرات در فروشگاه نمایش داده می‌شوند."}
            </span>
          </div>
        </fieldset>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="request-success" role="status">
            {notice}
          </p>
        )}
      </form>
      {failures.length > 0 && (
        <div className="home-upload-failures" role="alert">
          <strong>تصاویر موفق حفظ شدند؛ این تصاویر بارگذاری نشدند:</strong>
          <ul>
            {failures.map(({ file, message }, i) => (
              <li key={i}>
                {file.name}: {message}
              </li>
            ))}
          </ul>
          <button
            disabled={busy || uploading}
            onClick={() => void upload(failures.map((f) => f.file))}
          >
            تلاش دوباره برای تصاویر ناموفق
          </button>
        </div>
      )}
    </section>
  );
}
