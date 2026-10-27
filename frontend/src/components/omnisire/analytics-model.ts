export const reports = {
  overview: {
    title: "نمای کلی فروش",
    description: "مسیر فروش فروشگاه را دنبال کنید و روزهای پررونق را بشناسید.",
    metrics: [
      ["revenue", "فروش خالص"],
      ["orders", "سفارش پرداخت‌شده"],
    ],
    search: "تاریخ روز، مانند 2026-10-17",
    note: "فروش خالص کالا پس از تخفیف محصول و کد تخفیف، بدون هزینه ارسال؛ فقط سفارش‌های پرداخت‌شده، در حال آماده‌سازی، ارسال‌شده و تحویل‌شده محاسبه می‌شوند.",
  },
  products: {
    title: "عملکرد محصولات",
    description: "ببینید کدام محصول فروش می‌سازد و کدام فقط توجه می‌گیرد.",
    metrics: [
      ["revenue", "فروش خالص"],
      ["quantity", "بسته فروخته‌شده"],
      ["views", "بازدید"],
      ["clicks", "کلیک"],
    ],
    search: "نام یا شناسه محصول",
    note: "بازدید و کلیک برای هر نشست و محصول در بازه‌های ۳۰ دقیقه‌ای محدود می‌شوند. این اعداد تعداد افراد یا نرخ تبدیل نیستند. محصولات بدون فروش هم در جدول حضور دارند.",
  },
  packages: {
    title: "فروش بسته‌ها",
    description:
      "اندازه‌ها و بسته‌های پرفروش را برای تصمیم‌های تأمین مقایسه کنید.",
    metrics: [
      ["revenue", "فروش خالص"],
      ["quantity", "بسته فروخته‌شده"],
    ],
    search: "نام محصول یا بسته",
    note: "تعداد، شمار بسته‌هاست؛ وزن یا حجم نیست. جدول فقط بسته‌هایی را نشان می‌دهد که در این بازه فروش داشته‌اند.",
  },
  prices: {
    title: "تاریخچه قیمت",
    description: "قیمت نهایی هر بسته و رد تغییرات قیمت و تخفیف را بررسی کنید.",
    metrics: [["price", "قیمت نهایی بسته"]],
    search: "نام محصول، بسته یا همکار",
    note: "نمودار، قیمت پایان روز پس از تخفیف محصول و گرد کردن قیمت را نشان می‌دهد؛ کد تخفیف سفارش در آن محاسبه نمی‌شود. قبل از اولین ثبت، قیمت نامعلوم است. جدول، قیمت پایه و تخفیف را جدا نشان می‌دهد.",
  },
  customers: {
    title: "مشتریان",
    description:
      "ارزش خرید مشتریان را بشناسید و از هر مشتری به سفارش‌هایش برسید.",
    metrics: [
      ["revenue", "مبلغ خرید"],
      ["orders", "تعداد سفارش"],
    ],
    search: "نام یا شماره همراه مشتری",
    note: "مبلغ خرید بدون هزینه ارسال است. مشتریان بدون خرید نیز در جدول حضور دارند؛ انتخاب نام مشتری، سفارش‌های پرداخت‌شده او را در همین بازه باز می‌کند.",
  },
  categories: {
    title: "دسته‌بندی‌ها",
    description:
      "سهم دسته‌ها در فروش و تقاضا را برای ترکیب بهتر سبد کالا بررسی کنید.",
    metrics: [
      ["revenue", "فروش خالص"],
      ["quantity", "بسته فروخته‌شده"],
      ["clicks", "کلیک"],
    ],
    search: "نام دسته‌بندی",
    note: "فروش و تعامل محصولات به دسته‌بندی فعلی آن‌ها نسبت داده می‌شود. تغییر دسته یک محصول می‌تواند توزیع گزارش گذشته را تغییر دهد.",
  },
  searches: {
    title: "جستجوها",
    description:
      "عبارت‌های پرتکرار را بشناسید و زبان مشتری را به محتوای فروشگاه نزدیک کنید.",
    metrics: [["orders", "تعداد جستجو"]],
    search: "عبارت جستجوشده",
    note: "هر عبارت برای هر نشست در بازه‌های ۳۰ دقیقه‌ای محدود می‌شود. این گزارش تقاضای جستجو را نشان می‌دهد؛ نتیجه‌دار بودن جستجو یا خرید پس از آن اندازه‌گیری نمی‌شود.",
  },
} as const;
export type ReportSection = keyof typeof reports;
export type Selection = { id: string; name: string };
export type Filters = {
  section: ReportSection;
  from: string;
  to: string;
  q: string;
  sort: string;
  direction: string;
  page: number;
  pageSize: number;
  metric: string;
  customer: string;
  customerName: string;
  selected: Selection[];
};
function isoDay(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tehran",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
export function recentDays(count: number) {
  const to = isoDay(new Date());
  const start = new Date(to + "T12:00:00Z");
  start.setUTCDate(start.getUTCDate() - count + 1);
  return { from: isoDay(start), to };
}
export function dateError(from: string, to: string) {
  const valid = (day: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(day) &&
    !isNaN(Date.parse(day)) &&
    new Date(day).toISOString().slice(0, 10) === day;
  if (!valid(from) || !valid(to))
    return "تاریخ شروع و پایان را کامل وارد کنید.";
  if (from > to) return "تاریخ پایان باید پس از تاریخ شروع باشد.";
  if ((Date.parse(to) - Date.parse(from)) / 86400000 >= 366)
    return "برای هر گزارش، بازه‌ای حداکثر ۳۶۶ روزه انتخاب کنید.";
  return "";
}
export function initialFilters(
  params: Record<string, string | string[] | undefined>,
): Filters {
  const get = (key: string) =>
    typeof params[key] === "string" ? (params[key] as string) : "";
  const section = Object.hasOwn(reports, get("section"))
    ? (get("section") as ReportSection)
    : "overview";
  const dates = !dateError(get("from"), get("to"))
    ? { from: get("from"), to: get("to") }
    : recentDays(30);
  const ids = params.id
    ? Array.isArray(params.id)
      ? params.id
      : [params.id]
    : [];
  return {
    section,
    ...dates,
    q: get("q"),
    sort: get("sort"),
    direction: get("direction") === "asc" ? "asc" : "desc",
    page: Math.max(1, Math.min(100000, Math.floor(Number(get("page"))) || 1)),
    pageSize: [25, 50, 100].includes(Number(get("pageSize")))
      ? Number(get("pageSize"))
      : 25,
    metric: get("metric"),
    customer: section === "customers" ? get("customer") : "",
    customerName: section === "customers" ? get("customerName") : "",
    selected: [...new Set(ids)].slice(0, 5).map((id) => ({ id, name: id })),
  };
}
export function filtersQuery(f: Filters) {
  const p = new URLSearchParams({ section: f.section, from: f.from, to: f.to });
  for (const key of [
    "q",
    "sort",
    "direction",
    "metric",
    "customer",
    "customerName",
  ] as const)
    if (f[key]) p.set(key, f[key]);
  p.set("page", String(f.page));
  p.set("pageSize", String(f.pageSize));
  f.selected.forEach((s) => p.append("id", s.id));
  return p;
}
