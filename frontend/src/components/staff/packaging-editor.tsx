"use client";

import { useEffect, useRef, useState } from "react";
import { Box, Calculator, Check, Info, Layers3, X } from "lucide-react";
import { api } from "@/lib/api";
import { fa } from "@/lib/format";
import type { ProductPackaging } from "@/lib/types";
import { MeasurementNumber } from "./measurement-number";
import { PackagingPreview } from "./packaging-preview";

export function PackagingEditor({
  item,
  existing,
  onClose,
  onSaved,
  onStateChange,
}: {
  item: ProductPackaging;
  existing: boolean;
  onClose: () => void;
  onSaved: (item: ProductPackaging) => void;
  onStateChange: (state: { dirty: boolean; busy: boolean }) => void;
}) {
  const [draft, setDraft] = useState(item);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(item);
  const used = item.usedByProducts ?? 0;
  const validDimensions = [draft.lengthMm, draft.widthMm, draft.heightMm].every(
    (value) => Number.isInteger(value) && value >= 1 && value <= 3000,
  );
  useEffect(() => {
    dialog.current?.showModal();
    nameInput.current?.focus();
  }, []);
  useEffect(() => {
    onStateChange({ dirty, busy });
  }, [dirty, busy, onStateChange]);
  useEffect(() => {
    if (!dirty && !busy) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, busy]);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);
  function close() {
    if (
      busy ||
      (dirty && !confirm("تغییرات ذخیره نشده‌اند. بدون ذخیره خارج می‌شوید؟"))
    )
      return;
    dialog.current?.close();
    onClose();
  }
  function change<K extends keyof ProductPackaging>(
    key: K,
    value: ProductPackaging[K],
  ) {
    setDraft((current) => ({ ...current, [key]: value }));
    setError("");
  }
  async function save() {
    if (busy) return;
    if (
      !draft.name.trim() ||
      !validDimensions ||
      !Number.isInteger(draft.emptyGrams) ||
      draft.emptyGrams < 1 ||
      draft.emptyGrams > 1000000 ||
      !Number.isInteger(draft.volumeCm3) ||
      draft.volumeCm3 < 1 ||
      draft.volumeCm3 > 27000000
    ) {
      setError(
        "نام، وزن خالی، هر سه بُعد و حجم را با مقدار مثبت و در محدوده مجاز وارد کنید.",
      );
      return;
    }
    setBusy(true);
    setError("");
    try {
      const { usedByProducts: _usage, ...definition } = draft;
      const result = await api<ProductPackaging>(
        `/staff/product-packaging/${encodeURIComponent(draft.id)}`,
        "PUT",
        definition,
      );
      dialog.current?.close();
      onSaved(result);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="packaging-dialog"
      aria-labelledby="packaging-editor-title"
      aria-describedby="packaging-editor-description"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <header className="packaging-editor-header">
          <div className="packaging-card-icon">
            <Box size={23} aria-hidden="true" />
          </div>
          <div>
            <h2 id="packaging-editor-title">
              {existing ? "ویرایش بسته‌بندی" : "بسته‌بندی جدید"}
            </h2>
            <p id="packaging-editor-description">
              {existing
                ? `تغییرات برای ${fa(used)} محصول مرتبط اعمال می‌شود.`
                : "مشخصات ظرف یا بسته دور محصول را وارد کنید."}
            </p>
          </div>
          <button
            type="button"
            className="packaging-icon-button"
            disabled={busy}
            aria-label="بستن ویرایشگر بسته‌بندی"
            onClick={close}
          >
            <X size={20} aria-hidden="true" />
          </button>
        </header>
        <div className="packaging-editor-body">
          <fieldset disabled={busy} className="packaging-editor-fields">
            {error && (
              <div
                ref={errorRef}
                tabIndex={-1}
                role="alert"
                className="packaging-error"
              >
                {error}
              </div>
            )}
            <div className="packaging-field-section">
              <h3>
                <span>۱</span>نام و وزن
              </h3>
              <label>
                نام بسته‌بندی
                <input
                  ref={nameInput}
                  required
                  maxLength={100}
                  placeholder="مثلاً شیشه عسل ۵۰۰ گرمی"
                  value={draft.name}
                  onChange={(event) => change("name", event.target.value)}
                />
              </label>
              <MeasurementNumber
                label="وزن بسته‌بندی خالی (گرم)"
                value={draft.emptyGrams}
                min={1}
                onChange={(value) => change("emptyGrams", value)}
              />
              <p className="packaging-field-help">
                ظرف، درپوش و محافظ را با هم و بدون محتویات وزن کنید.
              </p>
            </div>
            <div className="packaging-field-section">
              <h3>
                <span>۲</span>ابعاد بیرونی
              </h3>
              <p className="packaging-field-help">
                پهن‌ترین قسمت بسته، همراه با محافظ دور آن را اندازه بگیرید.
              </p>
              <div className="packaging-dimension-inputs">
                {(
                  [
                    ["lengthMm", "طول"],
                    ["widthMm", "عرض"],
                    ["heightMm", "ارتفاع"],
                  ] as const
                ).map(([key, label]) => (
                  <MeasurementNumber
                    key={key}
                    label={`${label} بیرونی (سانتی‌متر)`}
                    value={draft[key]}
                    scale={10}
                    min={1}
                    max={3000}
                    onChange={(value) => change(key, value)}
                  />
                ))}
              </div>
            </div>
            <div className="packaging-field-section">
              <h3>
                <span>۳</span>حجم بسته‌بندی
              </h3>
              <MeasurementNumber
                label="حجم (سانتی‌متر مکعب)"
                value={draft.volumeCm3}
                min={1}
                max={27000000}
                onChange={(value) => change("volumeCm3", value)}
              />
              <button
                type="button"
                className="packaging-calculate"
                disabled={!validDimensions}
                onClick={() =>
                  change(
                    "volumeCm3",
                    Math.ceil(
                      (draft.lengthMm * draft.widthMm * draft.heightMm) / 1000,
                    ),
                  )
                }
              >
                <Calculator size={16} aria-hidden="true" />
                محاسبه حجم از ابعاد
              </button>
              <p className="packaging-field-help">
                هر سانتی‌متر مکعب برابر یک میلی‌لیتر است.
              </p>
            </div>
          </fieldset>
          <aside className="packaging-editor-aside">
            <PackagingPreview packaging={draft} />
            <div className="packaging-weight-note">
              <Info size={18} aria-hidden="true" />
              <div>
                <strong>وزن ارسال چطور محاسبه می‌شود؟</strong>
                <p>وزن محصول + وزن بسته‌بندی</p>
                <span>
                  مثلاً برای ۵۰۰ گرم محصول:{" "}
                  <b>{fa(500 + Math.max(0, draft.emptyGrams))} گرم</b>
                </span>
              </div>
            </div>
            <div className="packaging-impact">
              <Layers3 size={20} aria-hidden="true" />
              <strong>
                {used
                  ? `${fa(used)} محصول به‌روز می‌شود`
                  : "آماده اتصال به محصولات"}
              </strong>
              <p>
                {used
                  ? "با ذخیره، وزن و ابعاد این بسته‌بندی در تمام محصولات مرتبط، از جمله محصولات منتشرشده و پیش‌نویس‌ها، به‌روز می‌شود."
                  : "پس از ذخیره، این بسته‌بندی در فرم محصولات قابل انتخاب است."}
              </p>
              {used > 0 && (
                <small>
                  سفارش‌های ثبت‌شده مشخصات زمان خرید را حفظ می‌کنند.
                </small>
              )}
            </div>
          </aside>
        </div>
        <footer className="packaging-editor-footer">
          <span>
            {dirty ? "تغییرات ذخیره نشده" : "همه اندازه‌ها را بررسی کنید"}
          </span>
          <div>
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={close}
            >
              انصراف
            </button>
            <button
              type="submit"
              className="button"
              disabled={busy || (existing && !dirty)}
            >
              <Check size={18} aria-hidden="true" />
              {busy ? "در حال ذخیره…" : "ذخیره بسته‌بندی"}
            </button>
          </div>
        </footer>
      </form>
    </dialog>
  );
}
