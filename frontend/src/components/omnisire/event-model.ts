import type { components } from "@/lib/api-types";
export type AuditEvent = components["schemas"]["AuditEvent"];
export type AuditPage = components["schemas"]["AuditEventPage"];
export const categories = [
  { id: "", label: "All events" },
  { id: "access", label: "Access & security" },
  { id: "catalog", label: "Catalog" },
  { id: "orders", label: "Orders & shipping" },
  { id: "finance", label: "Finance" },
  { id: "other", label: "Other" },
] as const;
export const eventLabels: Record<string, string> = {
  "auth.customer_login": "Customer signed in",
  "auth.login": "Team member signed in",
  "auth.failed": "Staff sign-in failed",
  "auth.logout": "Signed out",
  "auth.omnisire_failed": "Omnisire verification failed",
  "auth.omnisire_unlock": "Omnisire unlocked",
  "owner.bootstrap": "Owner account initialized",
  "owner.recovery": "Owner access recovered",
  "staff.create": "Team member created",
  "staff.update": "Team member updated",
  "staff.archive": "Team member archived",
  "staff.credentials": "Sign-in credentials reset",
  "staff.password_changed": "Password changed",
  "product.draft": "Product draft saved",
  "product.publish": "Product published",
  "product.archive": "Product archived",
  "product.availability": "Product availability changed",
  "product.packaging": "Product packaging updated",
  "product_packaging.save": "Packaging assignment saved",
  "packaging.create": "Packaging created",
  "packaging.edit": "Packaging updated",
  "article.save": "Article saved",
  "articles.delete": "Article deleted",
  "category.save": "Category saved",
  "category.delete": "Category deleted",
  "store.home_slides": "Homepage slides updated",
  "store.suggestions": "Suggestions updated",
  "pricing.adjust": "Prices adjusted",
  "pricing.discount": "Discounts adjusted",
  "discount.create": "Discount code created",
  "discount.update": "Discount code updated",
  "discount.delete": "Discount code deleted",
  "product-discount.create": "Product discount created",
  "product-discount.update": "Product discount updated",
  "product-discount.delete": "Product discount deleted",
  "shipping.update": "Shipping settings updated",
  "shipping.resolve": "Shipment issue resolved",
  "shipping.method-change": "Shipping method changed",
  "shipping.parcels": "Shipment parcels updated",
  "shipping.reconciled": "Shipment status reconciled",
  "order.paid": "Order paid",
  "order.cancelled": "Order cancelled / payment failed",
  "order.expired": "Payment window expired",
  "order.review": "Order needs review",
  "order.packing": "Order packing started",
  "order.pack-item": "Order item packed",
  "order.shipped": "Order shipped",
  "order.received": "Order delivered",
  "referral.signup": "Referral signup recorded",
  "commission.earned": "Commission earned",
  "commission.refund": "Refund commission adjusted",
  "payment.recorded": "Team payment recorded",
  "payment.reversed": "Team payment reversed",
  "export.requested": "Export requested",
  "export.ready": "Export ready",
  "request.decision": "Customer request reviewed",
};
export const eventTitle = (action: string) => eventLabels[action] ?? action;
export const actorName = (event: AuditEvent) =>
  event.staffId ? event.actorName : "System / external";
export const eventDate = (at: string) =>
  new Date(at).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Tehran",
  });
export const eventTime = (at: string) =>
  new Date(at).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "Asia/Tehran",
  });
export const count = (value: number) =>
  new Intl.NumberFormat("en-US").format(value);
export type EventFilters = {
  q: string;
  action: string;
  actor: string;
  entity: string;
  from: string;
  to: string;
  category: string;
  review: boolean;
};
export const emptyFilters: EventFilters = {
  q: "",
  action: "",
  actor: "",
  entity: "",
  from: "",
  to: "",
  category: "",
  review: false,
};
export function dateWindow(days: number): Pick<EventFilters, "from" | "to"> {
  if (!days) return { from: "", to: "" };
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tehran",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const start = new Date(`${today}T12:00:00Z`);
  start.setUTCDate(start.getUTCDate() - days + 1);
  return { from: start.toISOString().slice(0, 10), to: today };
}
