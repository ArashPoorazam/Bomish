"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { fa } from "@/lib/format";
import type { Product, ProductDiscount } from "@/lib/types";
export function ProductDiscountList({
  revision,
  busy,
  onBusyChange,
  onChanged,
}: {
  revision: number;
  busy: boolean;
  onBusyChange: (busy: boolean) => void;
  onChanged: () => Promise<void>;
}) {
  const [items, setItems] = useState<ProductDiscount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let live = true;
    setLoading(true);
    setError("");
    api<ProductDiscount[]>("/staff/product-discounts")
      .then((v) => {
        if (live) setItems(v);
      })
      .catch((e) => {
        if (live) setError(e.message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [revision, retry]);
  async function change(item: ProductDiscount, remove: boolean) {
    onBusyChange(true);
    setError("");
    setMessage("");
    try {
      await api(
        `/staff/product-discounts/${encodeURIComponent(item.id)}`,
        remove ? "DELETE" : "PATCH",
        remove ? undefined : { active: !item.active },
      );
      setItems((prev) =>
        remove
          ? prev.filter((v) => v.id !== item.id)
          : prev.map((v) =>
              v.id === item.id ? { ...v, active: !v.active } : v,
            ),
      );
      setMessage(
        remove
          ? "تخفیف حذف شد و قیمت محصولات به‌روز شد."
          : item.active
            ? "تخفیف غیرفعال شد."
            : "تخفیف فعال شد.",
      );
      await onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      onBusyChange(false);
    }
  }
  return (
    <section className="form-card stack">
      <div className="between">
        <h3>تخفیف‌های محصولات</h3>
        <span className="badge">{fa(items.length)} تخفیف</span>
      </div>
      <p className="muted">
        اگر محصولی در چند گروه فعال باشد، بالاترین درصد اعمال می‌شود. حذف یا
        غیرفعال کردن یک گروه، تخفیف گروه‌های دیگر را حذف نمی‌کند.
      </p>
      {message && (
        <p role="status" className="success">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}{" "}
          <button
            type="button"
            className="text-link"
            disabled={busy}
            onClick={() => setRetry(retry + 1)}
          >
            تلاش دوباره
          </button>
        </p>
      )}
      {loading ? (
        <p role="status">در حال دریافت تخفیف‌ها…</p>
      ) : !items.length && !error ? (
        <p className="empty-state">هنوز تخفیفی ساخته نشده است.</p>
      ) : (
        <div className="discount-code-list">
          {items.map((item) => (
            <article className="discount-code-card" key={item.id}>
              <div className="between">
                <h4>{item.name}</h4>
                <span className={`badge ${item.active ? "" : "draft-badge"}`}>
                  {item.active ? "فعال" : "غیرفعال"}
                </span>
              </div>
              <strong>
                {fa(item.percent)}٪ تخفیف · {fa(item.productIds.length)} محصول
              </strong>
              <DiscountTargets ids={item.productIds} />
              <div className="inline-actions">
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy}
                  onClick={() => void change(item, false)}
                >
                  {item.active ? "غیرفعال کردن" : "فعال کردن"}
                </button>
                <button
                  type="button"
                  className="button secondary"
                  disabled={busy}
                  onClick={() => void change(item, true)}
                >
                  حذف تخفیف
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
function DiscountTargets({ ids }: { ids: string[] }) {
  const [open, setOpen] = useState(false),
    [page, setPage] = useState(1);
  const [items, setItems] = useState<Product[]>([]),
    [loading, setLoading] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    if (!open) return;
    let live = true;
    setLoading(true);
    setError("");
    api<{ items: Product[] }>(
      "/staff/product-options?" +
        new URLSearchParams({
          ids: ids.slice((page - 1) * 8, page * 8).join(","),
          page: "1",
          pageSize: "8",
        }),
    )
      .then((v) => {
        if (live) setItems(v.items);
      })
      .catch((e) => {
        if (live) setError(e.message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [open, page, ids]);
  return (
    <div>
      <button
        type="button"
        className="text-link"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {open ? "بستن فهرست محصولات" : "مشاهده محصولات این تخفیف"}
      </button>
      {open && (
        <div className="stack">
          {loading ? (
            <p role="status">در حال دریافت…</p>
          ) : error ? (
            <p role="alert" className="error">
              {error}
            </p>
          ) : (
            <ul>
              {items.map((p) => (
                <li key={p.id}>
                  {p.name} · تخفیف فعلی {fa(p.discountPercent || 0)}٪
                </li>
              ))}
            </ul>
          )}
          {ids.length > 8 && (
            <div className="related-pagination">
              <button
                type="button"
                className="button secondary"
                disabled={page === 1 || loading}
                onClick={() => setPage(page - 1)}
              >
                قبلی
              </button>
              <span>
                {fa(page)} / {fa(Math.ceil(ids.length / 8))}
              </span>
              <button
                type="button"
                className="button secondary"
                disabled={page * 8 >= ids.length || loading}
                onClick={() => setPage(page + 1)}
              >
                بعدی
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
