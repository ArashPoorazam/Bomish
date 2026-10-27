"use client";
import "@/app/packaging.css";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Box,
  CheckCircle2,
  Layers3,
  PackagePlus,
  Pencil,
  RefreshCw,
  Search,
  Weight,
} from "lucide-react";
import { api } from "@/lib/api";
import { fa } from "@/lib/format";
import type { ProductPackaging } from "@/lib/types";
import { useStaffPermission } from "./permissions";
import { PackagingEditor } from "./packaging-editor";

export function PackagingManager({
  onStateChange,
}: {
  onStateChange: (state: { dirty: boolean; busy: boolean }) => void;
}) {
  const can = useStaffPermission();
  const [items, setItems] = useState<ProductPackaging[]>([]);
  const [selected, setSelected] = useState<ProductPackaging | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const addButton = useRef<HTMLButtonElement>(null);
  const reload = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setItems(await api<ProductPackaging[]>("/staff/product-packaging"));
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  const used = items.filter((item) => (item.usedByProducts ?? 0) > 0).length;
  const visible = items.filter(
    (item) =>
      item.name.includes(query.trim()) &&
      (filter === "all" ||
        (filter === "used"
          ? (item.usedByProducts ?? 0) > 0
          : !item.usedByProducts)),
  );
  function create() {
    setMessage("");
    setSelected({
      id: crypto.randomUUID(),
      name: "",
      emptyGrams: 0,
      lengthMm: 0,
      widthMm: 0,
      heightMm: 0,
      volumeCm3: 0,
    });
  }
  function close() {
    setSelected(null);
    onStateChange({ dirty: false, busy: false });
  }
  function saved(item: ProductPackaging) {
    setItems((current) =>
      [...current.filter((previous) => previous.id !== item.id), item].sort(
        (first, second) => first.name.localeCompare(second.name, "fa"),
      ),
    );
    setMessage(
      item.usedByProducts
        ? `بسته‌بندی ذخیره شد. ${fa(item.usedByProducts)} محصول و پیش‌نویس‌های مرتبط به‌روز شدند.`
        : "بسته‌بندی ذخیره شد. حالا می‌توانید آن را برای محصولات انتخاب کنید.",
    );
    close();
    requestAnimationFrame(() => addButton.current?.focus());
  }
  return (
    <section className="packaging-workspace" aria-label="مدیریت بسته‌بندی‌ها">
      <div className="packaging-intro">
        <div className="packaging-intro-icon">
          <Box size={27} strokeWidth={1.5} aria-hidden="true" />
        </div>
        <div>
          <span className="packaging-eyebrow">
            یک‌بار تعریف کنید، همه‌جا استفاده کنید
          </span>
          <h2>بسته‌بندی دقیق، ارسال دقیق</h2>
          <p>
            ظرف‌ها و بسته‌های محصولات را اینجا مدیریت کنید؛ وزن و ابعاد، خودکار
            در محصولات مرتبط به‌روز می‌شوند.
          </p>
        </div>
        <div className="packaging-totals">
          <strong>{fa(items.length)}</strong>
          <span>نوع بسته‌بندی</span>
        </div>
      </div>
      <div className="packaging-toolbar">
        <label className="packaging-search">
          <Search size={18} aria-hidden="true" />
          <input
            aria-label="جستجوی بسته‌بندی"
            placeholder="جستجو در نام بسته‌بندی‌ها…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div className="packaging-toolbar-actions">
          <button
            className="packaging-icon-button"
            type="button"
            aria-label="بازخوانی فهرست"
            title="بازخوانی فهرست"
            disabled={loading}
            onClick={() => void reload()}
          >
            <RefreshCw size={18} aria-hidden="true" />
          </button>
          {can("packaging.create") && (
            <button
              ref={addButton}
              type="button"
              className="button packaging-create"
              onClick={create}
            >
              <PackagePlus size={18} aria-hidden="true" />
              افزودن بسته‌بندی
            </button>
          )}
        </div>
      </div>
      <div className="packaging-list-heading">
        <div
          className="packaging-filters"
          role="group"
          aria-label="فیلتر بسته‌بندی‌ها"
        >
          {[
            ["all", "همه", items.length],
            ["used", "در حال استفاده", used],
            ["unused", "بدون محصول", items.length - used],
          ].map(([key, label, count]) => (
            <button
              key={key}
              type="button"
              aria-pressed={filter === key}
              onClick={() => setFilter(String(key))}
            >
              {label}
              <span>{fa(Number(count))}</span>
            </button>
          ))}
        </div>
        <span className="packaging-result-count">
          {fa(visible.length)} بسته‌بندی
        </span>
      </div>
      {message && (
        <div className="packaging-success" role="status">
          <CheckCircle2 size={20} aria-hidden="true" />
          <p>{message}</p>
        </div>
      )}
      {error && (
        <div role="alert" className="packaging-error">
          <p>{error}</p>
          <button type="button" onClick={() => void reload()}>
            تلاش دوباره
          </button>
        </div>
      )}
      {loading ? (
        <div className="packaging-loading" role="status">
          <RefreshCw size={22} aria-hidden="true" />
          در حال دریافت بسته‌بندی‌ها…
        </div>
      ) : visible.length ? (
        <div className="packaging-grid">
          {visible.map((item) => (
            <article key={item.id} className="packaging-card">
              <div className="packaging-card-heading">
                <div className="packaging-card-icon">
                  <Box size={25} strokeWidth={1.5} aria-hidden="true" />
                </div>
                <div>
                  <h3>{item.name}</h3>
                  <span
                    className={`packaging-usage ${item.usedByProducts ? "is-used" : ""}`}
                  >
                    <span aria-hidden="true" />
                    {item.usedByProducts
                      ? `در ${fa(item.usedByProducts)} محصول`
                      : "آماده استفاده"}
                  </span>
                </div>
              </div>
              <dl className="packaging-card-metrics">
                <div>
                  <dt>
                    <Weight size={14} aria-hidden="true" />
                    وزن خالی
                  </dt>
                  <dd>
                    {fa(item.emptyGrams)}
                    <small>گرم</small>
                  </dd>
                </div>
                <div>
                  <dt>
                    <Layers3 size={14} aria-hidden="true" />
                    حجم
                  </dt>
                  <dd>
                    {fa(item.volumeCm3)}
                    <small>cm³</small>
                  </dd>
                </div>
              </dl>
              <div className="packaging-card-dimensions">
                <span>طول × عرض × ارتفاع</span>
                <bdi>
                  {fa(item.lengthMm / 10)} × {fa(item.widthMm / 10)} ×{" "}
                  {fa(item.heightMm / 10)} <small>cm</small>
                </bdi>
              </div>
              <div className="packaging-card-footer">
                <span>وزن خالی + وزن محصول</span>
                {can("packaging.edit") && (
                  <button
                    type="button"
                    aria-label={`ویرایش ${item.name}`}
                    onClick={() => {
                      setMessage("");
                      setSelected(item);
                    }}
                  >
                    <Pencil size={15} aria-hidden="true" />
                    ویرایش
                    <ArrowLeft size={15} aria-hidden="true" />
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      ) : (
        !error && (
          <div className="packaging-empty">
            <div>
              <Box size={36} strokeWidth={1.3} aria-hidden="true" />
            </div>
            <h3>
              {items.length
                ? "بسته‌بندی‌ای پیدا نشد"
                : "اولین بسته‌بندی را تعریف کنید"}
            </h3>
            <p>
              {items.length
                ? "نام دیگری جستجو کنید یا فیلتر را تغییر دهید."
                : "از یک شیشه، پاکت یا جعبه شروع کنید. پس از ثبت، برای هر محصول فقط بسته‌بندی مناسب را انتخاب می‌کنید."}
            </p>
            {items.length ? (
              <button
                type="button"
                className="button secondary"
                onClick={() => {
                  setQuery("");
                  setFilter("all");
                }}
              >
                نمایش همه بسته‌بندی‌ها
              </button>
            ) : (
              can("packaging.create") && (
                <button
                  type="button"
                  className="button secondary"
                  onClick={create}
                >
                  تعریف اولین بسته‌بندی
                </button>
              )
            )}
          </div>
        )
      )}
      <p className="packaging-footnote">
        <Layers3 size={16} aria-hidden="true" />
        بسته‌بندی دور محصول را تعریف کنید؛ کارتن پستی در محاسبه ارسال جداگانه در
        نظر گرفته می‌شود.
      </p>
      {selected && (
        <PackagingEditor
          key={selected.id}
          item={selected}
          existing={items.some((item) => item.id === selected.id)}
          onClose={close}
          onSaved={saved}
          onStateChange={onStateChange}
        />
      )}
    </section>
  );
}
