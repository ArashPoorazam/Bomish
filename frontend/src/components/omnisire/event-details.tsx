import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  X,
} from "lucide-react";
import {
  actorName,
  categories,
  eventDate,
  eventTime,
  eventTitle,
  type AuditEvent,
} from "./event-model";

export function EventDetails({
  event,
  onClose,
  previous,
  next,
}: {
  event: AuditEvent | null;
  onClose: () => void;
  previous: (() => void) | null;
  next: (() => void) | null;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (event && !dialog.current?.open) dialog.current?.showModal();
    if (event && dialog.current) dialog.current.scrollTop = 0;
    if (!event && dialog.current?.open) dialog.current?.close();
  }, [event]);
  return (
    <dialog
      ref={dialog}
      className="audit-drawer"
      aria-labelledby="audit-detail-title"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          const rect = e.currentTarget.getBoundingClientRect();
          if (
            e.clientX < rect.left ||
            e.clientX > rect.right ||
            e.clientY < rect.top ||
            e.clientY > rect.bottom
          )
            onClose();
        }
      }}
    >
      <div className="audit-drawer-top">
        <span>EVENT DETAILS</span>
        <button
          type="button"
          aria-label="Close event details"
          onClick={onClose}
          autoFocus
        >
          <X size={19} />
        </button>
      </div>
      {event && <DetailContent key={event.id} event={event} />}
      <div className="audit-drawer-bottom">
        <span>Browse this page</span>
        <div>
          <button
            type="button"
            disabled={!previous}
            onClick={() => previous?.()}
          >
            <ChevronLeft size={15} />
            Previous
          </button>
          <button type="button" disabled={!next} onClick={() => next?.()}>
            Next
            <ChevronRight size={15} />
          </button>
        </div>
      </div>
    </dialog>
  );
}
function DetailContent({ event }: { event: AuditEvent }) {
  const [copy, setCopy] = useState("");
  const category =
    categories.find((c) => c.id === event.category)?.label || "Other";
  const fields = Object.entries(event.detail ?? {}).filter(
    ([key]) => key !== "requestId",
  );
  const related =
    event.action.startsWith("staff.") && event.entityId
      ? {
          href: `/omnisire/members/${encodeURIComponent(event.entityId)}`,
          label: "Open team member",
        }
      : /^(order|shipping)\./.test(event.action) &&
          event.entityId &&
          event.entityId !== "settings"
        ? {
            href: `/staff/customer-orders/${encodeURIComponent(event.entityId)}`,
            label: "Open order",
          }
        : /^(product|inventory|article)\./.test(event.action) && event.entityId
          ? {
              href: `/staff?${new URLSearchParams({ section: event.action.startsWith("article.") ? "articles" : "products", q: event.entityId })}`,
              label: "Find related record",
            }
          : null;
  return (
    <div className="audit-drawer-content">
      <div className="audit-detail-badges">
        <span className={`audit-category tone-${event.category}`}>
          {category}
        </span>
        {event.reviewSignal && (
          <span className="audit-review-badge">Review signal</span>
        )}
      </div>
      <h2 id="audit-detail-title">{eventTitle(event.action)}</h2>
      <code className="audit-action-code">{event.action}</code>
      <p className="audit-detail-time">
        {eventDate(event.createdAt)} at {eventTime(event.createdAt)} · Tehran
      </p>
      {event.reviewSignal && (
        <p className="audit-detail-notice">
          This is a failed authentication attempt or an order marked for review.
          The event alone does not establish its cause or whether it has been
          resolved.
        </p>
      )}
      <dl className="audit-metadata">
        <div>
          <dt>Event ID</dt>
          <dd>#{event.id}</dd>
        </div>
        <div>
          <dt>Actor</dt>
          <dd>
            <bdi>{actorName(event)}</bdi>
            {event.staffId && <code>{event.staffId}</code>}
          </dd>
        </div>
        <div>
          <dt>Related entity</dt>
          <dd>
            <code>{event.entityId || "Not recorded"}</code>
          </dd>
        </div>
        <div>
          <dt>Request ID</dt>
          <dd>
            <code>
              {typeof event.detail?.requestId === "string"
                ? event.detail.requestId
                : "Not recorded"}
            </code>
          </dd>
        </div>
      </dl>
      {!event.staffId && (
        <p className="audit-subtle">
          No team member is attributed to this event. It may originate from a
          customer, an automated process, or an unauthenticated request.
        </p>
      )}
      <h3>Recorded changes & context</h3>
      {fields.length ? (
        <dl className="audit-payload">
          {fields.map(([key, value]) => (
            <div key={key}>
              <dt>
                {key.replace(/([a-z])([A-Z])/g, "$1 $2").replaceAll("_", " ")}
              </dt>
              <dd>
                {typeof value === "object" && value !== null ? (
                  <pre>{JSON.stringify(value, null, 2)}</pre>
                ) : (
                  <bdi>{value === null ? "null" : String(value)}</bdi>
                )}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="audit-subtle">
          No additional changes or context were recorded.
        </p>
      )}
      <div className="audit-related">
        {related && (
          <Link href={related.href}>
            {related.label}
            <ArrowUpRight size={14} />
          </Link>
        )}
        {event.staffId && (
          <Link href={`/omnisire/members/${encodeURIComponent(event.staffId)}`}>
            View actor profile
            <ArrowUpRight size={14} />
          </Link>
        )}
      </div>
      <details className="audit-raw">
        <summary>Raw event JSON</summary>
        <pre>{JSON.stringify(event, null, 2)}</pre>
      </details>
      <button
        type="button"
        className="audit-copy"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(JSON.stringify(event, null, 2));
            setCopy("Event JSON copied");
          } catch {
            setCopy(
              "Copy unavailable. Select the text in Raw event JSON instead.",
            );
          }
        }}
      >
        {copy === "Event JSON copied" ? (
          <Check size={15} />
        ) : (
          <Copy size={15} />
        )}
        Copy event JSON
      </button>
      <p className="audit-copy-status" role="status">
        {copy}
      </p>
    </div>
  );
}
