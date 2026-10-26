import { useState } from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";
import {
  dateWindow,
  emptyFilters,
  eventLabels,
  type EventFilters,
} from "./event-model";

export function EventFilterForm({
  filters,
  onApply,
}: {
  filters: EventFilters;
  onApply: (filters: EventFilters) => void;
}) {
  const [draft, setDraft] = useState(filters);
  const [advanced, setAdvanced] = useState(!!(filters.actor || filters.entity));
  const invalid = !!draft.from && !!draft.to && draft.from > draft.to;
  const change = (key: keyof EventFilters, value: string) =>
    setDraft((previous) => ({ ...previous, [key]: value }));
  const active = Object.entries(filters).filter(
    ([key, value]) => !["category", "review"].includes(key) && !!value,
  ).length;
  const advancedCount = Number(!!filters.actor) + Number(!!filters.entity);
  return (
    <form
      className="audit-filter-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!invalid) onApply(draft);
      }}
    >
      <div className="audit-filter-main">
        <label className="audit-search">
          <span>Search activity</span>
          <div>
            <Search size={17} />
            <input
              type="search"
              placeholder="Actor, action, entity or request ID…"
              value={draft.q}
              onChange={(e) => change("q", e.target.value)}
            />
          </div>
        </label>
        <label>
          <span>Event type</span>
          <select
            value={draft.action}
            onChange={(e) => change("action", e.target.value)}
          >
            <option value="">All event types</option>
            {Object.entries(eventLabels)
              .sort((a, b) => a[1].localeCompare(b[1]))
              .map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
          </select>
        </label>
        <button
          type="button"
          className={`audit-filter-toggle ${advanced ? "is-active" : ""}`}
          aria-expanded={advanced}
          aria-controls="audit-advanced-filters"
          onClick={() => setAdvanced(!advanced)}
        >
          <SlidersHorizontal size={15} />
          More filters{advancedCount > 0 && <span>{advancedCount}</span>}
        </button>
        <button type="submit" className="audit-primary" disabled={invalid}>
          Apply filters
        </button>
      </div>
      <div className="audit-date-row">
        <span>Date window</span>
        <div className="audit-date-presets">
          {[
            { days: 1, label: "Today" },
            { days: 7, label: "7 days" },
            { days: 30, label: "30 days" },
            { days: 0, label: "All time" },
          ].map((p) => {
            const dates = dateWindow(p.days);
            return (
              <button
                key={p.days}
                type="button"
                aria-pressed={
                  draft.from === dates.from && draft.to === dates.to
                }
                onClick={() => {
                  const next = { ...draft, ...dates };
                  setDraft(next);
                  onApply(next);
                }}
              >
                {p.label}
              </button>
            );
          })}
        </div>
        <label>
          <span className="sr-only">From date</span>
          <input
            type="date"
            aria-label="From date"
            value={draft.from}
            max={draft.to || undefined}
            onChange={(e) => change("from", e.target.value)}
          />
        </label>
        <span>to</span>
        <label>
          <span className="sr-only">To date</span>
          <input
            type="date"
            aria-label="To date"
            value={draft.to}
            min={draft.from || undefined}
            onChange={(e) => change("to", e.target.value)}
          />
        </label>
        <small>Tehran · inclusive dates</small>
        {active > 0 && (
          <button
            type="button"
            className="audit-clear"
            onClick={() =>
              onApply({
                ...emptyFilters,
                category: filters.category,
                review: filters.review,
              })
            }
          >
            <X size={13} />
            Clear filters
          </button>
        )}
      </div>
      {invalid && (
        <p className="audit-form-error" role="alert">
          Start date must be on or before the end date.
        </p>
      )}
      {advanced && (
        <div className="audit-advanced" id="audit-advanced-filters">
          <label>
            <span>Exact entity ID</span>
            <input
              value={draft.entity}
              onChange={(e) => change("entity", e.target.value)}
              placeholder="Order, product, or other record ID"
            />
          </label>
          <label>
            <span>Exact team member ID</span>
            <input
              value={draft.actor}
              onChange={(e) => change("actor", e.target.value)}
              placeholder="Filter by a specific actor"
            />
          </label>
          <p>
            Search matches action codes, actor names and entity IDs. Event IDs
            and request IDs match exactly.
          </p>
        </div>
      )}
    </form>
  );
}
