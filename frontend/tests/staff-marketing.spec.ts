import { test, expect, type Page } from "@playwright/test";
import { loginStaff } from "./staff-login";
import type { Product } from "../src/lib/types";
const product = {
  id: "sample",
  name: "زردچوبه نمونه",
  slug: "sample",
  categoryId: "spices",
  status: "published",
  summary: "نمونه",
  images: [],
  aliases: [],
  tags: [],
  sections: [],
  nutrients: [],
  relatedIds: [],
  discountPercent: 10,
  outOfStock: false,
  packages: [
    {
      id: "small",
      amount: 100,
      unit: "g",
      priceRials: 1000000,
      maxQuantity: 5,
      shippingGrams: 0,
    },
  ],
};
const articles = [
  {
    id: "one",
    title: "راهنمای ادویه",
    slug: "spice-guide",
    status: "published",
    excerpt: "ادویه‌ها را بهتر بشناسیم",
    body: "متن نمونه",
    image: "/images/spices.png",
    productIds: null,
    updatedAt: "2026-09-20T12:00:00Z",
  },
  {
    id: "two",
    title: "روش نگهداری سبزی",
    slug: "herbs-guide",
    status: "draft",
    excerpt: "نوشته در حال آماده‌سازی",
    body: "",
    image: "",
    productIds: [],
    updatedAt: "2026-09-22T12:00:00Z",
  },
];
async function mockedStaff(page: Page) {
  const changes: Record<string, unknown>[] = [];
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace("/api/v1", "");
    if (
      ["/staff/pricing", "/staff/product-discounts"].includes(path) &&
      route.request().method() === "POST"
    ) {
      changes.push(route.request().postDataJSON());
      return route.fulfill({ json: { count: 1 } });
    }
    const data: Record<string, unknown> = {
      "/session": {
        csrf: "test",
        role: "owner",
        staffId: "owner",
        permissions: [
          "products",
          "articles",
          "categories",
          "pricing",
          "orders",
          "shipping",
          "sales",
          "omnisire",
        ],
      },
      "/cart": { items: [], subtotalRials: 0 },
      "/staff/products": { items: [product], total: 1, page: 1, pageSize: 25 },
      "/staff/product-options": new URL(route.request().url()).searchParams.has(
        "page",
      )
        ? { items: [product], total: 1, page: 1, pageSize: 25 }
        : [product],
      "/categories": [{ id: "spices", name: "ادویه‌ها" }],
      "/staff/articles": {
        items: articles,
        total: articles.length,
        page: 1,
        pageSize: 25,
      },
      "/staff/orders": [],
      "/staff/members": [],
      "/staff/audit": [],
      "/staff/shipping": {},
      "/staff/discount-codes": [],
      "/staff/product-discounts": [],
    };
    const params = new URL(route.request().url()).searchParams;
    const response = data[path];
    if (
      params.has("page") &&
      response &&
      typeof response === "object" &&
      "items" in response
    ) {
      const paged = response as {
        items: Record<string, unknown>[];
        total: number;
      };
      const query = params.get("q") || "",
        status = params.get("status") || "";
      const items = paged.items.filter(
        (item) =>
          (!query || JSON.stringify(item).includes(query)) &&
          (!status || item.status === status),
      );
      return route.fulfill({ json: { ...paged, items, total: items.length } });
    }
    return route.fulfill({ json: data[path] ?? { ok: true } });
  });
  await page.goto("/staff");
  return changes;
}
test("journal library uses top controls, filters articles, and edits legacy records", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await mockedStaff(page);
  await page.getByRole("button", { name: "مجله", exact: true }).click();
  await expect(page.locator(".journal-card")).toHaveCount(2);
  const sidebar = await page
    .locator(".journal-workspace .staff-tools")
    .boundingBox();
  const content = await page
    .locator(".journal-workspace .staff-main")
    .boundingBox();
  expect(sidebar!.y + sidebar!.height).toBeLessThan(content!.y);
  expect(sidebar!.height).toBeLessThan(210);
  await page.getByLabel("وضعیت مقاله").selectOption("draft");
  await expect(page.locator(".journal-card")).toHaveCount(1);
  await expect(page.locator(".journal-card")).toContainText("روش نگهداری سبزی");
  await page.getByRole("button", { name: "پاک کردن فیلترها" }).click();
  await page.getByLabel("جستجوی مقاله").fill("ادویه");
  await expect(page.locator(".journal-card")).toHaveCount(1);
  await expect(page.locator(".journal-card")).toContainText("راهنمای ادویه");
  await page.getByRole("button", { name: "ویرایش مقاله", exact: true }).click();
  await expect(page.getByLabel("عنوان", { exact: true })).toHaveValue(
    "راهنمای ادویه",
  );
  await expect(page.getByLabel("زردچوبه نمونه")).not.toBeChecked();
  await page.getByRole("button", { name: "بازگشت به مقاله‌ها" }).click();
  await page.getByRole("button", { name: "پاک کردن فیلترها" }).click();
  await page
    .locator(".journal-workspace")
    .screenshot({ path: "test-results/journal-desktop.png" });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page
    .locator(".journal-workspace")
    .screenshot({ path: "test-results/journal-mobile.png" });
  expect(errors).toEqual([]);
});
test("pricing shows before/after values, validates reductions, and preserves units", async ({
  page,
}) => {
  const changes = await mockedStaff(page);
  await page.getByRole("button", { name: "قیمت و تخفیف", exact: true }).click();
  await page.getByLabel("جستجوی محصولات").fill("زردچوبه");
  await page
    .getByRole("button", { name: "انتخاب زردچوبه نمونه", exact: true })
    .click();
  await page.getByLabel("نام تخفیف", { exact: true }).fill("تخفیف نمونه");
  await page.getByLabel("درصد تخفیف", { exact: true }).fill("۲۰");
  await expect(page.locator(".pricing-preview")).toContainText("۸۰٬۰۰۰ تومان");
  await page
    .getByRole("button", { name: "ساخت تخفیف برای ۱ محصول", exact: true })
    .click();
  await expect(
    page.locator(".pricing-workspace").getByRole("status"),
  ).toContainText("ساخته شد");
  expect(changes[0]).toEqual({
    id: expect.any(String),
    name: "تخفیف نمونه",
    all: false,
    productIds: ["sample"],
    percent: 20,
  });
  await page
    .getByRole("tab", { name: "اصلاح قیمت پایه", exact: false })
    .click();
  await page.getByLabel("جستجوی محصولات").fill("زردچوبه");
  await page
    .getByRole("button", { name: "انتخاب زردچوبه نمونه", exact: true })
    .click();
  await page.getByLabel("نوع تغییر").selectOption("decrease");
  await page
    .getByLabel("میزان تغییر هر بسته (تومان)", { exact: true })
    .fill("۱۰۰۰۰۰");
  await expect(
    page.locator(".pricing-workspace").getByRole("alert"),
  ).toContainText("خارج از محدوده مجاز");
  await expect(
    page.getByRole("button", { name: "اعمال تغییر قیمت برای ۱ محصول" }),
  ).toBeDisabled();
  await page
    .getByLabel("میزان تغییر هر بسته (تومان)", { exact: true })
    .fill("۲۰۰۰۰");
  await expect(
    page.getByLabel("میزان تغییر هر بسته (تومان)", { exact: true }),
  ).toHaveValue("20,000");
  await page
    .locator(".pricing-workspace")
    .screenshot({ path: "test-results/pricing-desktop.png" });
  await page
    .getByRole("button", { name: "اعمال تغییر قیمت برای ۱ محصول" })
    .click();
  await expect.poll(() => changes.length).toBe(2);
  expect(changes[1]).toEqual({
    productIds: ["sample"],
    amount: -200000,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("staff creates a discount code and customer applies it through a paid order", async ({
  browser,
}) => {
  test.setTimeout(75000);
  const ownerContext = await browser.newContext();
  const owner = await ownerContext.newPage();
  const customerContext = await browser.newContext();
  const customer = await customerContext.newPage();
  const code = `UI${Date.now()}`;
  try {
    await owner.goto("/staff");
    await loginStaff(owner, "owner");
    await owner
      .getByRole("button", { name: "قیمت و تخفیف", exact: true })
      .click();
    await owner.getByRole("tab", { name: "کدهای تخفیف", exact: false }).click();
    await owner
      .getByRole("button", { name: "کد تخفیف جدید", exact: true })
      .click();
    const dialog = owner.getByRole("dialog", { name: "کد تخفیف جدید" });
    await dialog.getByLabel("کد تخفیف", { exact: true }).fill(code);
    await dialog.getByLabel("درصد تخفیف", { exact: true }).fill("15");
    await dialog.getByText("شرایط استفاده · اختیاری").click();
    await dialog.getByLabel("حداکثر تعداد استفاده", { exact: true }).fill("1");
    await dialog.getByRole("button", { name: "ساخت کد تخفیف" }).click();
    await expect(dialog).not.toBeVisible();
    await expect(
      owner.locator(".discount-code-card").filter({ hasText: code }),
    ).toBeVisible();
    await owner
      .locator(".pricing-workspace")
      .screenshot({ path: "test-results/codes-desktop.png" });
    const publicProducts: Product[] = await (
      await customer.request.get("/api/v1/products")
    ).json();
    const inStock = publicProducts.find(
      (p) => p.packages[0]?.unit === "g" && !p.outOfStock,
    );
    expect(
      inStock,
      "a published, in-stock demo product is available",
    ).toBeTruthy();
    await customer.goto("/products/" + inStock!.slug);
    await customer.getByRole("button", { name: "افزودن به سبد" }).click();
    await customer
      .getByRole("link", { name: "ادامه خرید", exact: true })
      .click();
    await customer
      .getByLabel("شماره همراه", { exact: true })
      .fill(`091${String(Date.now()).slice(-8)}`);
    const otpResponse = customer.waitForResponse(
      (r) =>
        r.url().endsWith("/auth/request") && r.request().method() === "POST",
    );
    await customer.getByRole("button", { name: "دریافت کد تأیید" }).click();
    await customer
      .getByLabel("کد تأیید", { exact: true })
      .fill((await (await otpResponse).json()).devCode);
    await customer.getByRole("button", { name: "تأیید و ادامه" }).click();
    await customer
      .getByLabel("نام گیرنده", { exact: true })
      .fill("مشتری کد تخفیف");
    await customer.getByLabel("شماره همراه گیرنده").fill("09121234567");
    await customer.getByLabel("شهر", { exact: true }).fill("تهران");
    await customer
      .getByLabel("نشانی کامل، پلاک و واحد")
      .fill("خیابان آزمایشی پلاک ۱۲ واحد ۲");
    await customer.getByLabel("کد پستی", { exact: true }).fill("1234567890");
    await customer.getByRole("button", { name: "محاسبه هزینه ارسال" }).click();
    await customer
      .getByLabel("کد تخفیف", { exact: true })
      .fill("DOES-NOT-EXIST");
    await customer
      .getByRole("button", { name: "اعمال کد", exact: true })
      .click();
    await expect(
      customer.locator(".checkout-code").getByRole("alert"),
    ).toContainText("معتبر نیست");
    await customer
      .getByLabel("کد تخفیف", { exact: true })
      .fill(code.toLowerCase());
    const discounted = customer.waitForResponse(
      (r) =>
        r.url().endsWith("/checkout/quote") && r.request().method() === "POST",
    );
    await customer
      .getByRole("button", { name: "اعمال کد", exact: true })
      .click();
    const quote = await (await discounted).json();
    expect(quote.discountRials).toBeGreaterThan(0);
    expect(quote.totalRials).toBe(
      quote.subtotalRials - quote.discountRials + quote.shippingRials,
    );
    await expect(customer.locator(".coupon-saving")).toContainText(code);
    await customer.getByRole("button", { name: "حذف کد", exact: true }).click();
    await expect(customer.locator(".coupon-saving")).toHaveCount(0);
    await customer.getByLabel("کد تخفیف", { exact: true }).fill(code);
    await customer
      .getByRole("button", { name: "اعمال کد", exact: true })
      .click();
    await expect(customer.locator(".coupon-saving")).toContainText(code);
    await customer.setViewportSize({ width: 390, height: 844 });
    expect(
      await customer.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await customer
      .locator(".checkout-summary")
      .screenshot({ path: "test-results/coupon-checkout-mobile.png" });
    await customer
      .getByRole("button", { name: "تأیید سفارش و پرداخت" })
      .click();
    await customer
      .getByRole("button", { name: "شبیه‌سازی پرداخت موفق" })
      .click();
    await expect(customer).toHaveURL(/account\/orders\//);
    await expect(customer.locator(".coupon-saving")).toContainText(code);
  } finally {
    const session = await (await owner.request.get("/api/v1/session")).json();
    await owner.request.patch(`/api/v1/staff/discount-codes/${code}`, {
      headers: {
        Origin: "http://localhost:3000",
        "X-CSRF-Token": session.csrf,
      },
      data: { active: false },
    });
    await ownerContext.close();
    await customerContext.close();
  }
});
