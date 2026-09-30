import type { components } from "@/lib/api-types";
export type CustomerRequest = components["schemas"]["CustomerRequest"];
export type RequestPage = components["schemas"]["RequestPage"];
export type ChatMessage = components["schemas"]["ChatMessage"];
export const requestStatuses = {
  new: "در انتظار بررسی",
  follow_up: "در حال پیگیری",
  accepted: "پذیرفته شد",
  rejected: "پذیرفته نشد",
};
