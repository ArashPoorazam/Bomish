export const fa = (n: number) => new Intl.NumberFormat("fa-IR").format(n);
export const money = (rials: number) => fa(rials / 10);
export const weight = (g: number) =>
  g >= 1000 ? `${fa(g / 1000)} کیلوگرم` : `${fa(g)} گرم`;
export const digits = (s: string) =>
  s
    .replace(/[۰-۹]/g, (c) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(c)))
    .replace(/[٠-٩]/g, (c) => String("٠١٢٣٤٥٦٧٨٩".indexOf(c)))
    .replace(/[٫,،]/g, ".");
export const date = (s: string) =>
  new Intl.DateTimeFormat("fa-IR", {
    dateStyle: "medium",
    timeZone: "Asia/Tehran",
  }).format(new Date(s));
export const total = (price: number, grams: number) =>
  Number(((BigInt(price) * BigInt(grams) + 5000n) / 10000n) * 10n);
export const statuses: Record<string, string> = {
  draft: "پیش‌نویس",
  published: "منتشرشده",
  archived: "بایگانی",
  pending: "در انتظار پرداخت",
  paid: "پرداخت‌شده",
  packing: "در حال آماده‌سازی",
  shipped: "ارسال‌شده",
  cancelled: "لغوشده",
  expired: "مهلت پرداخت تمام شده",
  review: "نیازمند بررسی فروشگاه",
};
export function parseGrams(input: string, unit: "g" | "kg"): number {
  const v = digits(input).trim();
  if (!/^\d+(\.\d+)?$/.test(v)) return NaN;
  const [whole, fraction = ""] = v.split(".");
  const precision = unit === "kg" ? 3 : 0;
  if (fraction.length > precision && !/^0*$/.test(fraction.slice(precision)))
    return NaN;
  return (
    Number(whole) * (unit === "kg" ? 1000 : 1) +
    Number(fraction.slice(0, precision).padEnd(precision, "0") || 0)
  );
}
