import type { Product } from "./types";

export function productSections(p: Product) {
  return [
    { body: p.description, title: "داستان این طعم", id: "intro" },
    { body: p.uses, title: "برای چه غذاهایی مناسب است؟", id: "uses" },
    { body: p.preparation, title: "چطور استفاده کنیم؟", id: "preparation" },
    { body: p.storage, title: "چطور نگهداری کنیم؟", id: "storage" },
    { body: p.ingredients, title: "ترکیبات", id: "ingredients" },
    { body: p.allergens, title: "اطلاعات حساسیت‌زا", id: "allergens" },
    ...(p.sections || []).map((section, i) => ({
      body: section.body,
      title: section.title,
      id: `section-${i}`,
    })),
  ].filter((s) => s.body.trim());
}
