"use client";
import { useEffect, useState } from "react";
import type { Product, Category } from "@/lib/types";
import { fa, priceRange, statuses, inStock } from "@/lib/format";
import { ProductEditor, newProduct } from "./product-editor";
import { RichText } from "@/components/rich-text";
import { api } from "@/lib/api";
export function CatalogManager({
  products,
  categories,
  owner,
  reload,
}: {
  products: Product[];
  categories: Category[];
  owner: boolean;
  reload: () => Promise<void>;
}) {
  const [q, setQ] = useState(""),
    [category, setCategory] = useState(""),
    [status, setStatus] = useState(""),
    [stock, setStock] = useState(""),
    [selected, setSelected] = useState<Product | null>(null);
  useEffect(() => {
    setSelected((current) =>
      current ? products.find((p) => p.id === current.id) || current : null,
    );
  }, [products]);
  const visible = products.filter(
    (p) =>
      (p.name + " " + p.slug + " " + p.aliases?.join(" ")).includes(q) &&
      (!category || p.categoryId === category) &&
      (!status || p.status === status) &&
      (!stock || (stock === "in" ? inStock(p) : !inStock(p))),
  );
  return (
    <div className="staff-workspace">
      <aside className="staff-tools stack">
        <button className="button" onClick={() => setSelected(newProduct())}>
          + افزودن محصول
        </button>
        <label>
          جستجوی محصول
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="نام یا نشانی محصول"
          />
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
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">همه وضعیت‌ها</option>
            {["published", "draft", "archived"].map((x) => (
              <option key={x} value={x}>
                {statuses[x]}
              </option>
            ))}
          </select>
        </label>
        <label>
          موجودی
          <select value={stock} onChange={(e) => setStock(e.target.value)}>
            <option value="">همه محصولات</option>
            <option value="in">موجود</option>
            <option value="out">ناموجود</option>
          </select>
        </label>
        <button
          className="text-link"
          onClick={() => {
            setQ("");
            setCategory("");
            setStatus("");
            setStock("");
          }}
        >
          پاک کردن فیلترها
        </button>
      </aside>
      <main className="staff-main">
        {selected ? (
          <>
            <button
              className="button secondary"
              onClick={() => setSelected(null)}
            >
              ← بازگشت به محصولات
            </button>
            <ProductEditor
              key={selected.id}
              product={selected}
              products={products}
              categories={categories}
              owner={owner}
              onSaved={async () => {
                await reload();
              }}
            />
          </>
        ) : (
          <div className="form-card">
            <div className="between">
              <h2>محصولات</h2>
              <span>{fa(visible.length)} محصول</span>
            </div>
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
                        <strong>{p.name}</strong>
                        <small className="muted">
                          {categories.find((c) => c.id === p.categoryId)?.name}
                        </small>
                      </td>
                      <td>{fa(p.packages?.length || 0)} اندازه</td>
                      {owner && <td>{priceRange(p)}</td>}
                      <td>
                        <span className="badge">{statuses[p.status]}</span>
                      </td>
                      <td>
                        <button
                          className="button secondary"
                          onClick={() => setSelected(p)}
                        >
                          ویرایش
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!visible.length && (
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
  products,
  reload,
}: {
  categories: Category[];
  products: Product[];
  reload: () => Promise<void>;
}) {
  const [q, setQ] = useState(""),
    [selected, setSelected] = useState<Category | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <div className="staff-workspace">
      <aside className="staff-tools stack">
        <button
          className="button"
          onClick={() => {
            setSelected({ id: crypto.randomUUID(), name: "", description: "" });
            setError("");
          }}
        >
          + دسته‌بندی جدید
        </button>
        <label>
          جستجوی دسته
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </label>
      </aside>
      <main className="staff-main">
        <h2>دسته‌بندی‌ها</h2>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {selected && (
          <form
            className="form-card stack"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              try {
                await api("/staff/categories/" + selected.id, "PUT", {
                  name: selected.name,
                  description: selected.description,
                });
                await reload();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              نام دسته
              <input
                required
                value={selected.name}
                onChange={(e) =>
                  setSelected({ ...selected, name: e.target.value })
                }
              />
            </label>
            <label>
              توضیح دسته
              <textarea
                value={selected.description}
                onChange={(e) =>
                  setSelected({ ...selected, description: e.target.value })
                }
              />
            </label>
            <div className="inline-actions">
              <button className="button" disabled={busy}>
                ذخیره دسته
              </button>
              <button
                type="button"
                className="button secondary"
                onClick={() => setSelected(null)}
              >
                انصراف
              </button>
            </div>
          </form>
        )}
        <div className="category-cards">
          {categories
            .filter((c) => c.name.includes(q))
            .map((c) => {
              const count = products.filter(
                (p) => p.categoryId === c.id,
              ).length;
              return (
                <article className="form-card stack" key={c.id}>
                  <div className="between">
                    <h3>{c.name}</h3>
                    <span className="badge">{fa(count)} محصول</span>
                  </div>
                  <RichText text={c.description || "بدون توضیح"} />
                  <div className="inline-actions">
                    <button
                      className="button secondary"
                      onClick={() => {
                        setSelected(c);
                        setError("");
                      }}
                    >
                      ویرایش
                    </button>
                    {count === 0 && (
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
export function PriceManager({
  products,
  reload,
}: {
  products: Product[];
  reload: () => Promise<void>;
}) {
  const [id, setID] = useState(""),
    [mode, setMode] = useState("discount"),
    [value, setValue] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  return (
    <form
      className="form-card stack pricing-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        setMessage("");
        try {
          const r = await api<{ count: number }>("/staff/pricing", "POST", {
            productId: id,
            mode,
            amount: mode === "adjust" ? value * 10 : value,
          });
          await reload();
          setMessage(`قیمت ${fa(r.count)} محصول به‌روز شد.`);
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2>قیمت و تخفیف</h2>
      <label>
        اعمال روی
        <select value={id} onChange={(e) => setID(e.target.value)}>
          <option value="">همه محصولات</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <fieldset>
        <legend>نوع تغییر</legend>
        <label className="check-label">
          <input
            type="radio"
            name="mode"
            checked={mode === "discount"}
            onChange={() => {
              setMode("discount");
              setValue(0);
            }}
          />
          تخفیف قابل نمایش به مشتری
        </label>
        <label className="check-label">
          <input
            type="radio"
            name="mode"
            checked={mode === "adjust"}
            onChange={() => {
              setMode("adjust");
              setValue(0);
            }}
          />
          اصلاح قیمت پایه بسته‌ها
        </label>
      </fieldset>
      <label>
        {mode === "discount"
          ? "درصد تخفیف (صفر برای حذف تخفیف)"
          : "تغییر قیمت هر بسته (تومان؛ عدد منفی برای کاهش)"}
        <input
          type="number"
          required
          min={mode === "discount" ? 0 : undefined}
          max={mode === "discount" ? 90 : undefined}
          value={value}
          onChange={(e) => setValue(Number(e.target.value))}
        />
      </label>
      <p className="notice">
        {mode === "discount"
          ? `تخفیف ${fa(value)}٪ جایگزین تخفیف فعلی ${id ? "این محصول" : "همه محصولات"} می‌شود.`
          : `قیمت پایه هر بسته ${id ? "این محصول" : "همه محصولات"} به اندازه ${fa(value)} تومان تغییر می‌کند. این تغییر به‌عنوان تخفیف نمایش داده نمی‌شود.`}
      </p>
      <button className="button" disabled={busy}>
        {busy ? "در حال ذخیره…" : "اعمال تغییر قیمت"}
      </button>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="success" role="status">
          {message}
        </p>
      )}
    </form>
  );
}
