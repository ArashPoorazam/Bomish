import { measurementIssues } from "@/lib/shipping";
import type { Product } from "@/lib/types";
import { packageWeight } from "@/lib/format";

export function normalizeProduct(product: Product): Product {
  return {
    ...product,
    images: product.images ?? [],
    tags: product.tags ?? [],
    aliases: product.aliases ?? [],
    relatedIds: product.relatedIds ?? [],
    nutrients: product.nutrients ?? [],
    packages: product.packages ?? [],
    sections: product.sections ?? [],
  };
}

export type ProductFields = {
  p: Product;
  field: <K extends keyof Product>(key: K, value: Product[K]) => void;
};
export const productSteps = [
  {
    title: "اطلاعات اصلی",
    description: "نام، دسته‌بندی و معرفی محصول را وارد کنید.",
  },
  {
    title: "تصاویر",
    description: "چند تصویر انتخاب کنید و تصویر اصلی را مشخص کنید.",
  },
  {
    title: "بسته‌ها و قیمت",
    description: "اندازه، قیمت و سقف خرید هر بسته را تعیین کنید.",
  },
  {
    title: "بسته‌بندی و ارسال",
    description: "اندازه‌ها و وزن واقعی هر بسته آماده ارسال را وارد کنید.",
  },
  {
    title: "اطلاعات تکمیلی",
    description:
      "توضیحات، برچسب‌ها و اطلاعات تغذیه‌ای را کامل کنید؛ این مرحله اختیاری است.",
  },
  {
    title: "بررسی و انتشار",
    description: "اطلاعات محصول را مرور و سپس ذخیره یا منتشر کنید.",
  },
];
export function productIssues(
  p: Product,
  publish: boolean,
  calculated = false,
) {
  const issues: { step: number; text: string }[] = [];
  if (!p.name.trim() || !p.slug.trim() || !p.categoryId)
    issues.push({ step: 0, text: "نام، نشانی صفحه و دسته‌بندی را کامل کنید." });
  if (/[ /?#\\]/.test(p.slug))
    issues.push({
      step: 0,
      text: "نشانی صفحه نباید فاصله یا /، ?، # داشته باشد.",
    });
  if (publish && !p.summary.trim())
    issues.push({ step: 0, text: "برای انتشار، خلاصه محصول را بنویسید." });
  if (publish && !p.images.length)
    issues.push({ step: 1, text: "برای انتشار، دست‌کم یک تصویر اضافه کنید." });
  if (publish && !p.packages.length)
    issues.push({ step: 2, text: "برای انتشار، دست‌کم یک بسته اضافه کنید." });
  p.packages.forEach((pack, i) => {
    if (
      pack.amount <= 0 ||
      pack.amount > 1000000 ||
      (packageWeight(pack) < 1 &&
        (publish || pack.unit === "g" || pack.unit === "kg")) ||
      packageWeight(pack) > 1000000 ||
      !Number.isInteger(pack.maxQuantity) ||
      pack.maxQuantity < 1 ||
      pack.maxQuantity > 1000 ||
      pack.priceRials < 0 ||
      pack.priceRials > 100000000000 ||
      pack.priceRials % 10 !== 0 ||
      (publish && pack.priceRials === 0)
    )
      issues.push({
        step: 2,
        text: `مقدار، قیمت، وزن ارسال و سقف خرید بسته ${(i + 1).toLocaleString("fa-IR")} را بررسی کنید.`,
      });
  });
  p.packages.forEach((pack, i) => {
    const incomplete = measurementIssues(pack);
    const enteredInvalid =
      [pack.lengthMm ?? 0, pack.widthMm ?? 0, pack.heightMm ?? 0].some(
        (n) => !Number.isInteger(n) || n < 0 || n > 3000,
      ) ||
      pack.shippingGrams < 0 ||
      pack.shippingGrams > 1000000 ||
      ((pack.unit === "g" || pack.unit === "kg") &&
        pack.shippingGrams > 0 &&
        pack.shippingGrams < pack.amount * (pack.unit === "kg" ? 1000 : 1));
    if (enteredInvalid || (publish && calculated && incomplete.length))
      issues.push({ step: 3, text: `بسته ${i + 1}: ${incomplete.join("، ")}` });
  });
  if (p.sections.some((s) => !s.title.trim()))
    issues.push({
      step: 4,
      text: "برای هر بخش توضیحات یک عنوان بنویسید یا بخش خالی را حذف کنید.",
    });
  if (p.nutrients.length && !p.nutrientSource.trim())
    issues.push({ step: 4, text: "منبع اطلاعات تغذیه‌ای را وارد کنید." });
  return issues;
}
