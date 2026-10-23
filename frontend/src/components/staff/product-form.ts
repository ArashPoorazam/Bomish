import { measurementIssues } from "@/lib/shipping";
import type { Product } from "@/lib/types";
import { packageWeight } from "@/lib/format";
import { withoutProductPackaging } from "@/lib/product-packaging";

export function normalizeProduct(product: Product): Product {
  return {
    ...product,
    images: product.images ?? [],
    tags: product.tags ?? [],
    aliases: product.aliases ?? [],
    relatedIds: product.relatedIds ?? [],
    nutrients: product.nutrients ?? [],
    packages: (product.packages ?? []).map((pack) =>
      pack.packagingId ? pack : withoutProductPackaging(pack),
    ),
    sections: product.sections ?? [],
  };
}

export type ProductFields = {
  p: Product;
  field: <K extends keyof Product>(key: K, value: Product[K]) => void;
};
export const productSteps = [
  {
    id: "basics",
    title: "اطلاعات اصلی",
    description: "نام، دسته‌بندی و معرفی محصول را وارد کنید.",
  },
  {
    id: "images",
    title: "تصاویر",
    description: "چند تصویر انتخاب کنید و تصویر اصلی را مشخص کنید.",
  },
  {
    id: "packages",
    title: "بسته‌ها",
    description:
      "محتویات و قیمت هر بسته را وارد و بسته‌بندی آن را انتخاب کنید.",
  },
  {
    id: "details",
    title: "اطلاعات تکمیلی",
    description:
      "توضیحات، برچسب‌ها و اطلاعات تغذیه‌ای را کامل کنید؛ این مرحله اختیاری است.",
  },
  {
    id: "review",
    title: "بررسی و انتشار",
    description: "اطلاعات محصول را مرور و سپس ذخیره یا منتشر کنید.",
  },
] as const;
export type ProductStep = (typeof productSteps)[number]["id"];
export function productIssues(p: Product, publish: boolean) {
  const issues: { step: ProductStep; text: string }[] = [];
  if (!p.name.trim() || !p.slug.trim() || !p.categoryId)
    issues.push({
      step: "basics",
      text: "نام، نشانی صفحه و دسته‌بندی را کامل کنید.",
    });
  if (/[ /?#\\]/.test(p.slug))
    issues.push({
      step: "basics",
      text: "نشانی صفحه نباید فاصله یا /، ?، # داشته باشد.",
    });
  if (publish && !p.summary.trim())
    issues.push({
      step: "basics",
      text: "برای انتشار، خلاصه محصول را بنویسید.",
    });
  if (publish && !p.images.length)
    issues.push({
      step: "images",
      text: "برای انتشار، دست‌کم یک تصویر اضافه کنید.",
    });
  if (publish && !p.packages.length)
    issues.push({
      step: "packages",
      text: "برای انتشار، دست‌کم یک بسته اضافه کنید.",
    });
  p.packages.forEach((pack, i) => {
    if (publish && !pack.packagingId) {
      issues.push({
        step: "packages",
        text: `بسته‌بندی محصول را برای بسته ${i + 1} انتخاب کنید.`,
      });
    }
    if (
      pack.packagingId &&
      (!pack.netGrams || pack.netGrams < 1 || !Number.isInteger(pack.netGrams))
    ) {
      issues.push({
        step: "packages",
        text: `وزن خالص محصول را برای بسته ${i + 1} وارد کنید.`,
      });
    }
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
        step: "packages",
        text: `مقدار، قیمت، وزن ارسال و سقف خرید بسته ${(i + 1).toLocaleString("fa-IR")} را بررسی کنید.`,
      });
  });
  p.packages.forEach((pack, i) => {
    if (!pack.packagingId) return;
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
    if (enteredInvalid || (publish && incomplete.length))
      issues.push({
        step: "packages",
        text: `بسته ${i + 1}: ${incomplete.join("، ")}`,
      });
  });
  if (p.sections.some((s) => !s.title.trim()))
    issues.push({
      step: "details",
      text: "برای هر بخش توضیحات یک عنوان بنویسید یا بخش خالی را حذف کنید.",
    });
  if (p.nutrients.length && !p.nutrientSource.trim())
    issues.push({
      step: "details",
      text: "منبع اطلاعات تغذیه‌ای را وارد کنید.",
    });
  return issues;
}
