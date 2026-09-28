"use client";
import { useEffect, useState } from "react";
import Image from "next/image";
import { ArrowRight, BookOpen, Pencil, Plus, RotateCcw } from "lucide-react";
import type { Article } from "@/lib/types";
import { date, statuses } from "@/lib/format";
import { ArticleEditor, newArticle } from "./article-editor";

type EditorState = { dirty: boolean; busy: boolean };
export function ArticleManager({
  initialQuery = "",
  articles,
  owner,
  onFilters,
  reload,
  onEditorStateChange,
  onEditingChange,
}: {
  initialQuery?: string;
  articles: Article[];
  owner: boolean;
  onFilters?: (filters: Record<string, string>) => void;
  reload: () => Promise<void>;
  onEditorStateChange: (state: EditorState) => void;
  onEditingChange: (editing: boolean) => void;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState("newest");
  useEffect(() => {
    const timer = setTimeout(
      () => onFilters?.({ q: query, status, sort }),
      250,
    );
    return () => clearTimeout(timer);
  }, [query, status, sort, onFilters]);
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
    onEditingChange(article !== null);
  }
  const visible = onFilters
    ? articles
    : articles
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
      {!selected && (
        <div className="catalog-toolbar-area">
          <button
            className="button catalog-add-product"
            onClick={() => select(newArticle())}
          >
            <Plus size={18} aria-hidden="true" /> مقاله جدید
          </button>
          <section
            className="catalog-toolbar"
            aria-label="جستجو و فیلتر مقاله‌ها"
          >
            <div className="catalog-toolbar-heading">
              <strong>جستجو و فیلتر</strong>
              <button
                className="button secondary filter-reset"
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
            </div>
            <div className="catalog-filters journal-filters">
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
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  <option value="">همه مقاله‌ها</option>
                  <option value="published">منتشر شده</option>
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
            </div>
          </section>
        </div>
      )}
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
              owner={owner}
              onSaved={reload}
              onStateChange={setEditorState}
            />
          </>
        ) : (
          <>
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
