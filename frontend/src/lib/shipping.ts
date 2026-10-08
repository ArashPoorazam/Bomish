import type { Package } from "./types";
export const deliveryStatuses: Record<string, string> = {
  not_requested: "در انتظار آماده‌سازی",
  submitting: "در حال ثبت درخواست",
  unknown: "نتیجه درخواست در حال بررسی است",
  awaiting_courier: "در انتظار پیک",
  accepted: "پیک پذیرفته است",
  picked_up: "تحویل به حامل",
  delivered: "تحویل گیرنده شد",
  cancelled: "درخواست لغو شد",
  failed: "⚠ ارسال نیازمند بررسی",
  returning: "⚠ مرسوله در حال بازگشت",
};
export const providerName = (method?: string) =>
  method === "snapp" ? "پیک اسنپ" : "پست";
export function measurementIssues(p: Package) {
  const result: string[] = [];
  for (const [key, label] of [
    ["lengthMm", "طول"],
    ["widthMm", "عرض"],
    ["heightMm", "ارتفاع"],
  ] as const) {
    const n = p[key] ?? 0;
    if (!Number.isInteger(n) || n < 1 || n > 3000) result.push(label);
  }
  const net = p.unit === "g" ? p.amount : p.unit === "kg" ? p.amount * 1000 : 0;
  if (
    !Number.isInteger(p.shippingGrams) ||
    p.shippingGrams < Math.max(1, net) ||
    p.shippingGrams > 1000000
  )
    result.push("وزن بسته آماده ارسال");
  if (!p.shippingVerified) result.push("تأیید اندازه‌گیری");
  return result;
}
