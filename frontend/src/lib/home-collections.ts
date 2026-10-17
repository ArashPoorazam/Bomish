import type { HomeSlide } from "./types";

// Destinations are curated so a slide always leads to a working store collection.
export const homeCollections = {
  products: {
    label: "همه محصولات",
    href: "/products",
    title: "طعم بعدی را پیدا کنید",
    caption: "از چاشنی‌های آشنا تا انتخاب‌های تازه برای آشپزی هر روز.",
  },
  spices: {
    label: "ادویه‌ها",
    href: "/products?category=spices",
    title: "یک چاشنی، هزار طعم",
    caption: "ادویه دلخواهتان را برای غذای بعدی انتخاب کنید.",
  },
  herbs: {
    label: "سبزی‌های خشک",
    href: "/products?category=herbs",
    title: "عطر آشنای غذای خانه",
    caption: "از میان سبزی‌های خشک، عطر دلخواه آشپزخانه‌تان را پیدا کنید.",
  },
  seeds: {
    label: "دانه‌های خوراکی",
    href: "/products?category=seeds",
    title: "جزئیات کوچک، طعم‌های تازه",
    caption: "انتخابی برای روی نان، کنار غذا یا دستور بعدی شما.",
  },
  arrivals: {
    label: "تازه‌های بومیش",
    href: "/products?collection=arrivals&sort=newest",
    title: "تازه به بومیش رسیده",
    caption: "جدیدترین محصولات را ببینید و طعم تازه‌ای امتحان کنید.",
  },
  bestsellers: {
    label: "محبوب‌های بومیش",
    href: "/products?collection=bestsellers",
    title: "انتخاب مشتریان بومیش",
    caption: "محصولات پرفروش ۳۰ روز گذشته را یک‌جا ببینید.",
  },
  suggestions: {
    label: "پیشنهادهای بومیش",
    href: "/products?collection=suggestions",
    title: "برای انتخاب بعدی شما",
    caption: "چند پیشنهاد از میان قفسه‌ها، به انتخاب تیم بومیش.",
  },
} satisfies Record<
  NonNullable<HomeSlide["collection"]>,
  { label: string; href: string; title: string; caption: string }
>;
