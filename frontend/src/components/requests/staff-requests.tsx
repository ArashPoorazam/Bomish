"use client";
import { useCallback, useEffect, useState } from "react";
import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Inbox,
  MessageCircle,
  RefreshCw,
  Search,
} from "lucide-react";
import { api } from "@/lib/api";
import { useLiveQuery } from "@/hooks/use-live-query";
import { date, digits, fa } from "@/lib/format";
import { Chat } from "./chat";
import { ChatAvatar, emptyDraft, type ChatDraft } from "./chat-parts";
import { CustomDecision, type RequestEditorState } from "./custom-decision";
import {
  requestStatuses,
  type CustomerRequest,
  type RequestPage,
} from "./types";

export function StaffRequests({
  kind,
  onStateChange,
}: {
  kind: "support" | "custom";
  onStateChange?: (state: RequestEditorState) => void;
}) {
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<CustomerRequest | null>(null);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("");
  const [drafts, setDrafts] = useState<Record<string, ChatDraft>>({});
  const [editor, setEditor] = useState<RequestEditorState>({
    dirty: false,
    busy: false,
  });
  const [detailError, setDetailError] = useState("");
  const updateEditor = useCallback(
    (state: RequestEditorState) => {
      setEditor(state);
      onStateChange?.(state);
    },
    [onStateChange],
  );
  const params = new URLSearchParams({
    kind,
    page: String(page),
    pageSize: "20",
  });
  if (query) params.set("q", query);
  if (filter) params.set(kind === "support" ? "unread" : "status", filter);
  const { data, error, loading, refresh } = useLiveQuery<RequestPage>(
    `/staff/requests?${params}`,
  );
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(digits(search.trim()));
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    if (data && page > 1 && !data.items.length)
      setPage(Math.max(1, Math.ceil(data.total / 20)));
  }, [data, page]);
  const choose = (request: CustomerRequest | null) => {
    if (editor.busy || request?.id === selected?.id) return;
    if (
      editor.dirty &&
      !confirm("تغییرات ذخیره نشده‌اند. بدون ذخیره خارج می‌شوید؟")
    )
      return;
    updateEditor({ dirty: false, busy: false });
    setSelected(request);
    setDetailError("");
    if (request && kind === "custom")
      void api(`/staff/requests/${request.id}/read`, "POST", {
        lastMessageId: 0,
      })
        .then(() => {
          window.dispatchEvent(new Event("bomish:notifications"));
          void refresh();
        })
        .catch((e) => setDetailError((e as Error).message));
  };
  const reloadSelected = async () => {
    if (!selected) return;
    const next = await api<CustomerRequest>(
      `/staff/requests/${encodeURIComponent(selected.id)}`,
    );
    setSelected((current) => (current?.id === next.id ? next : current));
  };
  return (
    <div className={`requests-workbench ${selected ? "has-selection" : ""}`}>
      <aside
        className="requests-inbox"
        aria-label={
          kind === "support" ? "فهرست گفتگوها" : "فهرست سفارش‌های اختصاصی"
        }
      >
        <div className="requests-inbox-toolbar">
          <div>
            <strong>
              {kind === "support" ? "گفتگوهای مشتریان" : "درخواست‌های مشتریان"}
            </strong>
            <span>{data ? `${fa(data.total)} مورد` : "در حال دریافت…"}</span>
          </div>
          <button
            className="icon-button"
            aria-label="به‌روزرسانی درخواست‌ها"
            title="به‌روزرسانی درخواست‌ها"
            disabled={loading || editor.busy}
            onClick={async () => {
              await refresh();
              if (selected && !editor.dirty) {
                try {
                  await reloadSelected();
                } catch (e) {
                  setDetailError((e as Error).message);
                }
              }
            }}
          >
            <RefreshCw size={18} />
          </button>
        </div>
        <label className="requests-search">
          <Search size={18} />
          <span className="sr-only">جستجوی درخواست‌ها</span>
          <input
            maxLength={200}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="شماره همراه یا شرح درخواست…"
          />
        </label>
        {kind === "support" ? (
          <div className="requests-filters" aria-label="فیلتر گفتگوها">
            <button
              aria-pressed={!filter}
              onClick={() => {
                setFilter("");
                setPage(1);
              }}
            >
              همه گفتگوها
            </button>
            <button
              aria-pressed={filter === "true"}
              onClick={() => {
                setFilter("true");
                setPage(1);
              }}
            >
              خوانده‌نشده
            </button>
          </div>
        ) : (
          <label className="requests-status-filter">
            <span className="sr-only">فیلتر وضعیت</span>
            <select
              aria-label="فیلتر وضعیت"
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value);
                setPage(1);
              }}
            >
              <option value="">همه وضعیت‌ها</option>
              {Object.entries(requestStatuses).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        )}
        {error && (
          <div className="chat-feedback" role="alert">
            <p className="error">{error}</p>
            <button className="text-link" onClick={refresh}>
              تلاش دوباره
            </button>
          </div>
        )}
        <div className="request-list" aria-busy={loading}>
          {!data && loading && (
            <p className="inbox-empty" role="status">
              در حال دریافت درخواست‌ها…
            </p>
          )}
          {data?.items.map((r) => (
            <button
              key={r.id}
              className={`request-list-item ${selected?.id === r.id ? "is-selected" : ""}`}
              aria-current={selected?.id === r.id ? "true" : undefined}
              disabled={editor.busy}
              onClick={() => choose(r)}
            >
              <ChatAvatar seed={r.id} />
              <span className="request-row-content">
                <span className="request-row-heading">
                  <strong>
                    <bdi>{r.phone}</bdi>
                  </strong>
                  {r.unread && <span className="request-unread">جدید</span>}
                </span>
                <span className="request-preview">
                  {kind === "support"
                    ? r.latestMessage || r.description
                    : r.description}
                </span>
                <span className="request-row-meta">
                  {kind === "custom" && (
                    <span className={`request-status status-${r.status}`}>
                      {requestStatuses[r.status]}
                    </span>
                  )}
                  <time dateTime={r.updatedAt}>{date(r.updatedAt)}</time>
                </span>
              </span>
            </button>
          ))}
          {data?.total === 0 && (
            <div className="inbox-empty">
              <Inbox size={30} />
              <strong>
                {query || filter
                  ? "درخواستی با این مشخصات پیدا نشد"
                  : "هنوز درخواستی ندارید"}
              </strong>
              <p>
                {query || filter
                  ? "جستجو یا فیلتر را تغییر دهید."
                  : "درخواست‌های جدید اینجا نمایش داده می‌شوند."}
              </p>
            </div>
          )}
        </div>
        <div className="requests-pagination">
          <button
            className="icon-button"
            aria-label="قبلی"
            disabled={page <= 1 || loading}
            onClick={() => setPage(page - 1)}
          >
            <ChevronRight size={18} />
          </button>
          <span>
            صفحه {fa(page)} از{" "}
            {fa(Math.max(1, Math.ceil((data?.total || 0) / 20)))}
          </span>
          <button
            className="icon-button"
            aria-label="بعدی"
            disabled={!data || page * 20 >= data.total || loading}
            onClick={() => setPage(page + 1)}
          >
            <ChevronLeft size={18} />
          </button>
        </div>
      </aside>
      <section
        className="request-detail"
        aria-label={
          kind === "support" ? "گفتگو با مشتری" : "بررسی سفارش اختصاصی"
        }
      >
        {selected ? (
          <>
            <header className="request-detail-header">
              <button
                className="icon-button inbox-back"
                aria-label="بازگشت به درخواست‌ها"
                disabled={editor.busy}
                onClick={() => choose(null)}
              >
                <ArrowRight size={20} />
              </button>
              <ChatAvatar seed={selected.id} />
              <div>
                <h2>
                  مشتری <bdi>{selected.phone}</bdi>
                </h2>
                <p>
                  {kind === "support"
                    ? "پیام‌ها و پاسخ‌های مشتری"
                    : "سفارش اختصاصی · بررسی و پیگیری درخواست"}
                </p>
              </div>
            </header>
            {detailError && (
              <p className="error chat-feedback" role="alert">
                {detailError}
              </p>
            )}
            {kind === "support" ? (
              <Chat
                key={selected.id}
                id={selected.id}
                staff
                draft={drafts[selected.id] || emptyDraft}
                onDraftChange={(draft) =>
                  setDrafts((old) => ({ ...old, [selected.id]: draft }))
                }
                onBusyChange={(busy) => updateEditor({ dirty: false, busy })}
              />
            ) : (
              <CustomDecision
                key={selected.id}
                request={selected}
                onStateChange={updateEditor}
                onReload={reloadSelected}
                onSaved={async () => {
                  await reloadSelected();
                  await refresh();
                }}
              />
            )}
          </>
        ) : (
          <div className="request-detail-empty">
            <span>
              {kind === "support" ? (
                <MessageCircle size={32} />
              ) : (
                <Inbox size={32} />
              )}
            </span>
            <h2>
              {kind === "support"
                ? "هر گفتگو، فرصتی برای همراهی"
                : "از یک ایده تا یک سفارش اختصاصی"}
            </h2>
            <p>
              {kind === "support"
                ? "یک گفتگو را انتخاب کنید تا پیام‌های مشتری را ببینید و پاسخ دهید."
                : "درخواستی را انتخاب کنید؛ جزئیات را بررسی و نتیجه را برای مشتری ثبت کنید."}
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
