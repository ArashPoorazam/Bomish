"use client";
import { Permission } from "@/components/staff/permissions";
import Link from "next/link";
import { useEffect, useState, useRef } from "react";
import { Plus, RotateCcw, ArrowRight, PackageX } from "lucide-react";
import type { Product, Category } from "@/lib/types";
import { fa, priceRange, statuses, inStock } from "@/lib/format";
import { ProductEditor, newProduct } from "./product-editor";
import { RichText } from "@/components/rich-text";
import { api } from "@/lib/api";
export function CatalogManager({
  loading = false,
  initialQuery = "",
  products,
  categories,
  owner,
  canPrice = owner,
  onFilters,
  reload,
  onEditorStateChange,
}: {
  loading?: boolean;
  initialQuery?: string;
  products: Product[];
  categories: Category[];
  owner: boolean;
  canPrice?: boolean;
  onFilters?: (filters: Record<string, string>) => void;
  reload: () => Promise<void>;
  onEditorStateChange: (state: { dirty: boolean; busy: boolean }) => void;
}) {
  const openedShipping = useRef(false);
  useEffect(() => {
    if (
      !openedShipping.current &&
      new URLSearchParams(window.location.search).get("step") === "shipping"
    ) {
      const p = products.find((p) => p.id === initialQuery);
      if (p) {
        openedShipping.current = true;
        setSelected(p);
      }
    }
  }, [products, initialQuery]);
  const [shippingIncomplete, setShippingIncomplete] = useState(() =>
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("shipping") === "missing"
      ? "true"
      : "",
  );
  const [q, setQ] = useState(initialQuery),
    [category, setCategory] = useState(""),
    [status, setStatus] = useState(""),
    [stock, setStock] = useState(""),
    [selected, setSelected] = useState<Product | null>(null);
  useEffect(() => {
    const timer = setTimeout(
      () =>
        onFilters?.({
          q,
          category,
          status,
          available: stock,
          shippingIncomplete,
        }),
      250,
    );
    return () => clearTimeout(timer);
  }, [q, category, status, stock, shippingIncomplete, onFilters]);
  useEffect(() => {
    setSelected((current) =>
      current ? products.find((p) => p.id === current.id) || current : null,
    );
  }, [products]);
  const [editorState, setEditorState] = useState({ dirty: false, busy: false });
  useEffect(() => {
    onEditorStateChange(editorState);
  }, [editorState, onEditorStateChange]);
  function selectProduct(next: Product | null) {
    if (editorState.busy) return;
    if (
      editorState.dirty &&
      !window.confirm(
        "تغییرات ذخیره نشده‌اند. بدون ذخیره از این محصول خارج می‌شوید؟",
      )
    )
      return;
    setEditorState({ dirty: false, busy: false });
    setSelected(next);
  }
  const visible = onFilters
    ? products
    : products.filter(
        (p) =>
          (p.name + " " + p.slug + " " + p.aliases?.join(" ")).includes(q) &&
          (!category || p.categoryId === category) &&
          (!status || p.status === status) &&
          (!stock || (stock === "in" ? inStock(p) : !inStock(p))),
      );
  return (
    <div
      className={`staff-workspace catalog-workspace ${selected ? "catalog-editing" : ""}`}
    >
      {!selected && (
        <div className="catalog-toolbar-area">
          <Permission name="products.create">
            <button
              className="button catalog-add-product"
              disabled={editorState.busy}
              onClick={() => selectProduct(newProduct())}
            >
              <Plus size={18} aria-hidden="true" /> افزودن محصول
            </button>
          </Permission>
          <section
            className="catalog-toolbar"
            aria-label="جستجو و فیلتر محصولات"
          >
            <div className="catalog-toolbar-heading">
              <strong>جستجو و فیلتر</strong>
              <button
                className="button secondary filter-reset"
                disabled={
                  !q && !category && !status && !stock && !shippingIncomplete
                }
                onClick={() => {
                  setQ("");
                  setCategory("");
                  setStatus("");
                  setStock("");
                  setShippingIncomplete("");
                }}
              >
                <RotateCcw size={16} aria-hidden="true" /> پاک کردن فیلترها
              </button>
            </div>
            <div className="catalog-filters catalog-product-filters">
              <label className="catalog-product-search">
                جستجوی محصول
                <input
                  type="search"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="نام یا نشانی محصول"
                />
              </label>
              <label>
                اطلاعات ارسال
                <select
                  value={shippingIncomplete}
                  onChange={(e) => setShippingIncomplete(e.target.value)}
                >
                  <option value="">همه محصولات</option>
                  <option value="true">اطلاعات ارسال ناقص</option>
                </select>
              </label>
              <label>
                دسته‌بندی
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  <option value="">همه دسته‌ها</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                وضعیت
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  <option value="">همه وضعیت‌ها</option>
                  {["published", "draft", "archived"].map((x) => (
                    <option key={x} value={x}>
                      {statuses[x]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                وضعیت فروش
                <select
                  value={stock}
                  onChange={(e) => setStock(e.target.value)}
                >
                  <option value="">همه محصولات</option>
                  <option value="in">موجود</option>
                  <option value="out">ناموجود</option>
                </select>
              </label>
            </div>
          </section>
        </div>
      )}
      <main className="staff-main">
        {selected ? (
          <>
            <button
              className="button secondary"
              disabled={editorState.busy}
              onClick={() => selectProduct(null)}
            >
              <ArrowRight size={16} aria-hidden="true" /> بازگشت به محصولات
            </button>
            <ProductEditor
              key={selected.id}
              product={selected}
              products={products}
              categories={categories}
              owner={owner}
              canPrice={canPrice}
              onStateChange={setEditorState}
              onSaved={async () => {
                await reload();
              }}
            />
          </>
        ) : (
          <div className="form-card">
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>محصول</th>
                    <th>بسته‌ها</th>
                    {owner && <th>قیمت (تومان)</th>}
                    <th>وضعیت</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <div className="catalog-product-name">
                          <strong>{p.name}</strong>
                          {!p.publishedShippingReady && (
                            <Link
                              className="catalog-shipping-badge"
                              href={`/staff?section=products&q=${encodeURIComponent(p.id)}&step=shipping`}
                              aria-label={`اطلاعات ارسال ناقص برای ${p.name}؛ تکمیل اطلاعات ارسال`}
                              title="اطلاعات ارسال ناقص؛ برای تکمیل کلیک کنید"
                            >
                              <PackageX size={17} aria-hidden="true" />
                            </Link>
                          )}
                        </div>
                        <small className="muted">
                          {categories.find((c) => c.id === p.categoryId)?.name}
                        </small>
                      </td>
                      <td>{fa(p.packages?.length || 0)} اندازه</td>
                      {owner && <td>{priceRange(p)}</td>}
                      <td>
                        <div className="catalog-statuses">
                          <span className="badge">{statuses[p.status]}</span>{" "}
                          {p.outOfStock && (
                            <span className="badge">ناموجود</span>
                          )}
                        </div>
                      </td>
                      <td>
                        <button
                          className="button secondary"
                          onClick={() => selectProduct(p)}
                        >
                          ویرایش
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {loading && !visible.length && (
              <div className="workspace-list-loading" role="status">
                در حال دریافت اطلاعات…
              </div>
            )}
            {!visible.length && !loading && (
              <div className="empty-state">محصولی با این فیلترها پیدا نشد.</div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
export function CategoryManager({
  categories,
  reload,
}: {
  categories: Category[];
  reload: () => Promise<void>;
}) {
  const [counts, setCounts] = useState<Record<string, number>>({});
  useEffect(() => {
    let live = true;
    api<Record<string, number>>("/staff/category-counts")
      .then((v) => {
        if (live) setCounts(v);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [categories]);
  const [q, setQ] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <div className="staff-workspace">
      <div className="catalog-toolbar-area">
        <Permission name="categories.create">
          <Link
            className="button catalog-add-product"
            href="/staff/categories/new"
          >
            <Plus size={18} aria-hidden="true" /> دسته‌بندی جدید
          </Link>
        </Permission>
        <section className="catalog-toolbar" aria-label="جستجوی دسته‌بندی‌ها">
          <div className="catalog-toolbar-heading">
            <strong>جستجو</strong>
            <button
              type="button"
              className="button secondary filter-reset"
              disabled={!q}
              onClick={() => setQ("")}
            >
              <RotateCcw size={16} aria-hidden="true" /> پاک کردن جستجو
            </button>
          </div>
          <div className="catalog-filters category-filters">
            <label>
              <input
                type="search"
                aria-label="جستجوی دسته‌بندی"
                placeholder="نام دسته‌بندی را بنویسید"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </label>
          </div>
        </section>
      </div>
      <main className="staff-main">
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="category-cards">
          {categories
            .filter((c) => c.name.includes(q))
            .map((c) => {
              const count = counts[c.id] ?? 0;
              return (
                <article className="form-card stack" key={c.id}>
                  <div className="between">
                    <h3>{c.name}</h3>
                    <span className="badge">{fa(count)} محصول</span>
                  </div>
                  <RichText text={c.description || "بدون توضیح"} />
                  <div className="inline-actions">
                    <Link
                      className="button secondary"
                      href={`/staff/categories/${c.id}`}
                    >
                      ویرایش
                    </Link>
                    {count === 0 && (
                      <Permission name="categories.delete">
                        <button
                          className="text-link"
                          disabled={busy}
                          onClick={async () => {
                            setBusy(true);
                            setError("");
                            try {
                              await api("/staff/categories/" + c.id, "DELETE");
                              await reload();
                            } catch (e) {
                              setError((e as Error).message);
                            } finally {
                              setBusy(false);
                            }
                          }}
                        >
                          حذف دسته خالی
                        </button>
                      </Permission>
                    )}
                  </div>
                </article>
              );
            })}
        </div>
      </main>
    </div>
  );
}
