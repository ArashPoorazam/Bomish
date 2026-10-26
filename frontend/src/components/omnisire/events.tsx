"use client";

import { useState } from "react";
import {
  Activity,
  ArrowDownUp,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Clock3,
  FileText,
  History,
  Package,
  RefreshCw,
  Search,
  ShieldCheck,
  TriangleAlert,
  Users,
  Wallet,
  Workflow,
} from "lucide-react";
import { Workspace, useLoad } from "./shared";
import {
  actorName,
  categories,
  count,
  dateWindow,
  emptyFilters,
  eventDate,
  eventTime,
  eventTitle,
  type AuditPage,
  type EventFilters,
} from "./event-model";
import { EventFilterForm } from "./event-filters";
import { EventDetails } from "./event-details";

const categoryIcons = {
  access: ShieldCheck,
  catalog: Package,
  orders: Workflow,
  finance: Wallet,
  other: FileText,
};
export function EventsPage() {
  return (
    <Workspace
      owner
      title="Activity log"
      contentLanguage="en"
      description="Follow every recorded action. Know what changed, when, and who was involved."
    >
      <AuditLog />
    </Workspace>
  );
}
function AuditLog() {
  const [filters, setFilters] = useState<EventFilters>(() => ({
    ...emptyFilters,
    ...dateWindow(7),
  }));
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sort, setSort] = useState("newest");
  const [revision, setRevision] = useState(0);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const params = new URLSearchParams({
    ...filters,
    review: String(filters.review),
    page: String(page),
    pageSize: String(pageSize),
    sort,
  });
  const { data, loading, error } = useLoad<AuditPage>(
    `/omnisire/events?${params}`,
    revision,
  );
  const selectedIndex =
    data?.items.findIndex((event) => event.id === selectedId) ?? -1;
  const selected = selectedIndex >= 0 ? data!.items[selectedIndex] : null;
  const apply = (next: EventFilters) => {
    setFilters(next);
    setPage(1);
    setSelectedId(null);
  };
  const changePage = (next: number) => {
    setPage(next);
    setSelectedId(null);
  };
  const lastPage = data
    ? Math.max(1, Math.ceil(data.total / data.pageSize))
    : 1;
  const currentPage = data?.page ?? page;
  return (
    <div className="audit-log">
      <div className="audit-intro">
        <div>
          <span className="audit-eyebrow">WORKSPACE AUDIT TRAIL</span>
          <p>
            <History size={15} />
            Recorded activity across your workspace
          </p>
        </div>
        <button
          type="button"
          className="audit-refresh"
          onClick={() => setRevision((n) => n + 1)}
          disabled={loading}
        >
          <RefreshCw size={15} />
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>
      <div
        className="audit-stats"
        aria-label="Summary of all matching events"
        aria-busy={loading}
      >
        {[
          {
            label: "Matching events",
            value: data?.total,
            Icon: Activity,
            hint: "Across the filtered period",
          },
          {
            label: "Team members",
            value: data?.summary.actors,
            Icon: Users,
            hint: "Distinct attributed actors",
          },
          {
            label: "Unattributed events",
            value: data?.summary.unattributed,
            Icon: Workflow,
            hint: "System, customer, or unknown actor",
          },
          {
            label: "Review signals",
            value: data?.summary.review,
            Icon: TriangleAlert,
            hint: "Failed authentication or order review",
          },
        ].map(({ label, value, Icon, hint }) => (
          <article
            key={label}
            className={`audit-stat ${label === "Review signals" && !!value ? "has-signals" : ""}`}
          >
            <div>
              <span>{label}</span>
              <Icon size={17} />
            </div>
            <strong>{value === undefined ? "—" : count(value)}</strong>
            <p>{hint}</p>
          </article>
        ))}
      </div>
      <section className="audit-explorer" aria-label="Event explorer">
        <div className="audit-categories" aria-label="Event categories">
          {categories.map((category) => (
            <button
              key={category.id}
              type="button"
              aria-pressed={filters.category === category.id}
              onClick={() =>
                apply({ ...filters, category: category.id, action: "" })
              }
            >
              {category.label}
            </button>
          ))}
        </div>
        <EventFilterForm
          key={JSON.stringify(filters)}
          filters={filters}
          onApply={apply}
        />
        <div className="audit-results-toolbar">
          <div>
            <h2>Event stream</h2>
            <span aria-live="polite">
              {loading
                ? "Updating results…"
                : data
                  ? `${count(data.total)} matching ${data.total === 1 ? "event" : "events"}`
                  : "Results unavailable"}
            </span>
          </div>
          <div className="audit-result-controls">
            <label className="audit-review-toggle">
              <input
                type="checkbox"
                checked={filters.review}
                onChange={(e) =>
                  apply({ ...filters, review: e.target.checked })
                }
              />
              Review signals only
            </label>
            <label className="audit-sort">
              <ArrowDownUp size={14} />
              <span className="sr-only">Sort events</span>
              <select
                aria-label="Sort events"
                value={sort}
                onChange={(e) => {
                  setSort(e.target.value);
                  setPage(1);
                  setSelectedId(null);
                }}
              >
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
              </select>
            </label>
          </div>
        </div>
        {error && (
          <div className="audit-error" role="alert">
            <TriangleAlert size={18} />
            <div>
              <strong>Could not load activity</strong>
              <p>
                {data
                  ? "Previously loaded results are shown. Refresh to try again."
                  : "Check your connection and try again."}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setRevision((n) => n + 1)}
              disabled={loading}
            >
              Retry
            </button>
          </div>
        )}
        {loading && !data && (
          <div className="audit-loading" role="status">
            <RefreshCw size={20} />
            Loading recorded activity…
          </div>
        )}
        {data && !data.items.length && (
          <div className="audit-empty">
            <Search size={28} />
            <h3>No matching events</h3>
            <p>
              Try a wider date window or remove a filter to see more activity.
            </p>
            <button type="button" onClick={() => apply(emptyFilters)}>
              Show all events
            </button>
          </div>
        )}
        {!!data?.items.length && (
          <>
            <div className="audit-list-columns" aria-hidden="true">
              <span>Event / related entity</span>
              <span>Actor</span>
              <span>Time · Tehran</span>
              <span />
            </div>
            <ol className="audit-event-list">
              {data.items.map((event, index) => {
                const Icon = categoryIcons[event.category] ?? FileText;
                const newDate =
                  index === 0 ||
                  eventDate(data.items[index - 1].createdAt) !==
                    eventDate(event.createdAt);
                return (
                  <li key={event.id}>
                    {newDate && (
                      <div className="audit-day">
                        <Clock3 size={12} />
                        <span>{eventDate(event.createdAt)}</span>
                      </div>
                    )}
                    <button
                      type="button"
                      className={`audit-event-row ${event.reviewSignal ? "has-signal" : ""}`}
                      onClick={() => setSelectedId(event.id)}
                      aria-label={`View event ${event.id}: ${eventTitle(event.action)}`}
                    >
                      <span className="audit-event-main">
                        <span
                          className={`audit-event-icon tone-${event.category}`}
                        >
                          <Icon size={18} />
                        </span>
                        <span className="audit-event-copy">
                          <strong>
                            {eventTitle(event.action)}
                            {event.reviewSignal && (
                              <span
                                className="audit-review-dot"
                                title="Review signal"
                              />
                            )}
                          </strong>
                          <span>
                            <code>{event.action}</code>
                            {event.entityId && (
                              <>
                                <i>·</i>
                                <bdi>{event.entityId}</bdi>
                              </>
                            )}
                          </span>
                        </span>
                      </span>
                      <span className="audit-event-actor">
                        <span className="audit-avatar" aria-hidden="true">
                          {event.staffId ? (
                            actorName(event).slice(0, 1).toLocaleUpperCase()
                          ) : (
                            <Workflow size={13} />
                          )}
                        </span>
                        <bdi>{actorName(event)}</bdi>
                      </span>
                      <span className="audit-event-time">
                        <time dateTime={event.createdAt}>
                          {eventTime(event.createdAt)}
                        </time>
                        <small>#{event.id}</small>
                      </span>
                      <ChevronRight size={15} className="audit-row-arrow" />
                    </button>
                  </li>
                );
              })}
            </ol>
          </>
        )}
        <div className="audit-pagination">
          <span>
            {data?.total
              ? `${count((currentPage - 1) * data.pageSize + 1)}–${count(Math.min(currentPage * data.pageSize, data.total))} of ${count(data.total)} events`
              : "0 events"}
          </span>
          <div>
            <label>
              Rows
              <select
                aria-label="Events per page"
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(1);
                  setSelectedId(null);
                }}
              >
                {[25, 50, 100].map((n) => (
                  <option key={n}>{n}</option>
                ))}
              </select>
            </label>
            <button
              type="button"
              aria-label="Previous page"
              disabled={loading || currentPage <= 1}
              onClick={() => changePage(currentPage - 1)}
            >
              <ChevronLeft size={16} />
            </button>
            <span>
              Page {currentPage} of {lastPage}
            </span>
            <button
              type="button"
              aria-label="Next page"
              disabled={loading || currentPage >= lastPage}
              onClick={() => changePage(currentPage + 1)}
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </section>
      <footer className="audit-footer">
        <ShieldCheck size={15} />
        <p>
          Read-only audit history. Summary counts cover all matching events.
          Review signals identify specific recorded actions, not unresolved
          incidents.
        </p>
        <span>
          Select an event for details <ArrowRight size={13} />
        </span>
      </footer>
      <EventDetails
        event={selected}
        onClose={() => setSelectedId(null)}
        previous={
          selectedIndex > 0
            ? () => setSelectedId(data!.items[selectedIndex - 1].id)
            : null
        }
        next={
          data && selectedIndex >= 0 && selectedIndex < data.items.length - 1
            ? () => setSelectedId(data.items[selectedIndex + 1].id)
            : null
        }
      />
    </div>
  );
}
