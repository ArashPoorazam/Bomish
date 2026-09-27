"use client";
import { useEffect, useState } from "react";
import Image from "next/image";
import { ArrowRight, BookOpen, Pencil, Plus, RotateCcw } from "lucide-react";
import type { Article, Product } from "@/lib/types";
import { date, fa, statuses } from "@/lib/format";
import { ArticleEditor, newArticle } from "./article-editor";

type EditorState = { dirty: boolean; busy: boolean };
export function ArticleManager({
  articles,
  products,
  owner,
  reload,
  onEditorStateChange,
}: {
  articles: Article[];
  products: Product[];
  owner: boolean;
  reload: () => Promise<void>;
  onEditorStateChange: (state: EditorState) => void;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState("newest");
  const [selected, setSelected] = useState<Article | null>(null);
  const [editorState, setEditorState] = useState<EditorState>({
    dirty: false,
    busy: false,
  });
  useEffect(
    () => onEditorStateChange(editorState),
    [editorState, onEditorStateChange],
  );
  function select(article: Article | null) {
    if (
      editorState.busy ||
      (editorState.dirty &&
        !window.confirm(
          "تغییرات مقاله ذخیره نشده‌اند. بدون ذخیره خارج می‌شوید؟",
        ))
    )
      return;
    setEditorState({ dirty: false, busy: false });
    setSelected(article);
  }
  const visible = articles
    .filter(
      (a) =>
        (!status || a.status === status) &&
        `${a.title} ${a.excerpt} ${a.slug}`
          .toLocaleLowerCase()
          .includes(query.trim().toLocaleLowerCase()),
    )
    .sort((a, b) =>
      sort === "title"
        ? a.title.localeCompare(b.title, "fa")
        : (sort === "oldest" ? 1 : -1) *
          ((Date.parse(a.updatedAt) || 0) - (Date.parse(b.updatedAt) || 0)),
    );
  return (
    <div className="staff-workspace journal-workspace">
      <aside className="staff-tools stack">
        <div>
          <span className="eyebrow">مدیریت محتوا</span>
          <h3>مجله بومیش</h3>
        </div>
        <button
          className="button"
          disabled={editorState.busy}
          onClick={() => select(newArticle())}
        >
          <Plus size={18} />
          مقاله جدید
        </button>
        <label>
          جستجوی مقاله
          <input
            type="search"
            placeholder="عنوان، خلاصه یا نشانی"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <label>
          وضعیت مقاله
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">همه مقاله‌ها</option>
            <option value="published">منتشرشده</option>
            <option value="draft">پیش‌نویس</option>
            <option value="archived">بایگانی</option>
          </select>
        </label>
        <label>
          مرتب‌سازی مقاله‌ها
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="newest">تازه‌ترین ویرایش</option>
            <option value="oldest">قدیمی‌ترین ویرایش</option>
            <option value="title">عنوان مقاله</option>
          </select>
        </label>
        <button
          className="button filter-reset"
          disabled={!query && !status && sort === "newest"}
          onClick={() => {
            setQuery("");
            setStatus("");
            setSort("newest");
          }}
        >
          <RotateCcw size={16} />
          پاک کردن فیلترها
        </button>
        <small className="muted">
          {fa(articles.filter((a) => a.status === "published").length)} منتشرشده
          · {fa(articles.filter((a) => a.status === "draft").length)} پیش‌نویس
        </small>
      </aside>
      <div className="staff-main">
        {selected ? (
          <>
            <button
              className="button secondary back-to-list"
              disabled={editorState.busy}
              onClick={() => select(null)}
            >
              <ArrowRight size={18} />
              بازگشت به مقاله‌ها
            </button>
            <ArticleEditor
              key={selected.id}
              article={selected}
              products={products}
              owner={owner}
              onSaved={reload}
              onStateChange={setEditorState}
            />
          </>
        ) : (
          <>
            <div className="between">
              <div>
                <h2>مقاله‌ها</h2>
                <p>نوشته‌های مجله و پیش‌نویس‌های در حال آماده‌سازی</p>
              </div>
              <span className="badge">{fa(visible.length)} مقاله</span>
            </div>
            <div className="journal-cards">
              {visible.map((a) => (
                <article key={a.id} className="journal-card">
                  {a.image ? (
                    <Image src={a.image} alt="" width={360} height={190} />
                  ) : (
                    <div className="journal-placeholder">
                      <BookOpen size={36} />
                    </div>
                  )}
                  <div className="journal-card-content">
                    <div className="between">
                      <span
                        className={`badge ${a.status === "draft" ? "draft-badge" : ""}`}
                      >
                        {statuses[a.status]}
                      </span>
                      {a.updatedAt && (
                        <time dateTime={a.updatedAt}>{date(a.updatedAt)}</time>
                      )}
                    </div>
                    <h3>{a.title}</h3>
                    <p>
                      {a.excerpt || "خلاصه‌ای برای این مقاله نوشته نشده است."}
                    </p>
                    <button
                      className="button secondary"
                      onClick={() => select(a)}
                    >
                      <Pencil size={16} />
                      ویرایش مقاله
                    </button>
                  </div>
                </article>
              ))}
            </div>
            {!visible.length && (
              <div className="form-card product-empty">
                <BookOpen size={36} />
                <h3>
                  {articles.length
                    ? "مقاله‌ای با این فیلترها پیدا نشد"
                    : "اولین مقاله مجله را بنویسید"}
                </h3>
                <p>
                  {articles.length
                    ? "عبارت جستجو یا وضعیت را تغییر دهید."
                    : "از دکمه «مقاله جدید» شروع کنید."}
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
