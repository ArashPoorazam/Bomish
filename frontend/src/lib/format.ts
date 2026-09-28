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
  published: "منتشر شده",
  archived: "بایگانی",
  pending: "در انتظار پرداخت",
  paid: "خرید ثبت شد",
  packing: "بسته‌بندی شد",
  shipped: "ارسال شد",
  received: "تحویل شد",
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

export const packageLabel = (p: { amount: number; unit: string }) =>
  `${fa(p.amount)} ${{ g: "گرم", kg: "کیلوگرم", ml: "میلی‌لیتر", l: "لیتر" }[p.unit] || p.unit}`;
export const packageWeight = (p: import("./types").Package) =>
  p.unit === "g"
    ? Math.round(p.amount)
    : p.unit === "kg"
      ? Math.round(p.amount * 1000)
      : p.shippingGrams;
export const packagePrice = (
  p: import("./types").Product,
  pack: import("./types").Package,
) =>
  Math.floor(
    (pack.priceRials * (100 - (p.discountPercent || 0)) + 500) / 1000,
  ) * 10;
export function priceBounds(p: import("./types").Product) {
  const prices = (p.packages || []).map((x) => packagePrice(p, x));
  return prices.length ? [Math.min(...prices), Math.max(...prices)] : [0, 0];
}
export function priceRange(p: import("./types").Product) {
  const [min, max] = priceBounds(p);
  return min === max ? money(min) : `${money(min)} – ${money(max)}`;
}
export const inStock = (p: import("./types").Product) =>
  !p.outOfStock && p.status !== "archived" && !!p.packages?.length;
