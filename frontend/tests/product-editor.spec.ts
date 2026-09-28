import { test, expect, type Page } from "@playwright/test";
const legacy = {
  id: "legacy-demo",
  slug: "legacy-demo",
  name: "زیره آزمایشی",
  categoryId: "spices",
  status: "published",
  packages: [
    {
      id: "legacy",
      amount: 100,
      unit: "g",
      priceRials: 1800000,
      maxQuantity: 5,
      shippingGrams: 0,
    },
  ],
  sections: null,
  images: ["/images/spices.png"],
  tags: null,
  aliases: null,
  relatedIds: null,
  nutrients: null,
  summary: "خلاصه محصول نمونه",
  description: "معرفی محصول",
  uses: "",
  preparation: "",
  storage: "",
  ingredients: "",
  allergens: "",
  nutrientSource: "",
  discountPercent: 0,
  popularity: 0,
  priceRials: 0,
  minGrams: 100,
  stepGrams: 100,
  maxGrams: 25000,
  outOfStock: false,
};
async function workspace(page: Page) {
  const saved: Record<string, unknown>[] = [];
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace("/api/v1", "");
    if (
      route.request().method() === "PUT" &&
      path.startsWith("/staff/products/")
    ) {
      saved.push(route.request().postDataJSON());
      return route.fulfill({ json: { ok: true } });
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
      "/staff/products": { items: [legacy], total: 1, page: 1, pageSize: 25 },
      "/staff/product-options": new URL(route.request().url()).searchParams.has(
        "page",
      )
        ? { items: [legacy], total: 1, page: 1, pageSize: 25 }
        : [legacy],
      "/categories": [{ id: "spices", name: "ادویه‌ها", description: "" }],
      "/staff/articles": { items: [], total: 0, page: 1, pageSize: 25 },
      "/staff/orders": [],
      "/staff/members": [],
      "/staff/audit": [],
      "/staff/shipping": {},
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
  return saved;
}
async function step(page: Page, name: string) {
  await page
    .getByRole("navigation", { name: "مراحل محصول" })
    .getByRole("button", { name })
    .click();
}
test("legacy null lists open, step state persists, drafts save, and mobile layout fits", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const saved = await workspace(page);
  await page.getByRole("button", { name: "ویرایش", exact: true }).click();
  await expect(page.getByLabel("نام محصول", { exact: true })).toHaveValue(
    legacy.name,
  );
  await page.getByLabel("نام محصول", { exact: true }).fill("زیره ویرایش‌شده");
  await step(page, "اطلاعات تکمیلی");
  await page.getByText("برچسب‌ها و نام‌های جستجو", { exact: true }).click();
  await page
    .getByLabel("برچسب‌ها (با ویرگول جدا کنید)")
    .pressSequentially("ادویه، آشپزی");
  await step(page, "بسته‌ها و قیمت");
  const price = page.getByLabel("قیمت بسته (تومان)", { exact: true });
  await price.fill("۱٬۲۳۴٬۵۶۷");
  await expect(price).toHaveValue("1,234,567");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("button", { name: "حذف بسته", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/product-packages-mobile.png",
    fullPage: true,
  });
  await step(page, "اطلاعات اصلی");
  await expect(page.getByLabel("نام محصول", { exact: true })).toHaveValue(
    "زیره ویرایش‌شده",
  );
  await page
    .getByRole("button", { name: "ذخیره پیش‌نویس", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "پیش‌نویس ذخیره شد" }),
  ).toBeVisible();
  expect(saved[0]).toMatchObject({
    name: "زیره ویرایش‌شده",
    tags: ["ادویه", "آشپزی"],
    packages: [{ ...legacy.packages[0], priceRials: 12345670 }],
  });
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "ذخیره پیش‌نویس", exact: true }),
  ).toBeFocused();
  expect(errors).toEqual([]);
});
test("new drafts can be incomplete; publishing leads to the missing step", async ({
  page,
}) => {
  const saved = await workspace(page);
  await page.getByRole("button", { name: "افزودن محصول", exact: true }).click();
  await page.getByLabel("نام محصول", { exact: true }).fill("محصول جدید");
  await page.getByLabel("نشانی صفحه", { exact: true }).fill("new-product");
  await page.getByLabel("دسته‌بندی", { exact: true }).selectOption("spices");
  await page
    .getByRole("button", { name: "ذخیره پیش‌نویس", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "پیش‌نویس ذخیره شد" }),
  ).toBeVisible();
  expect(saved[0]).toMatchObject({ summary: "", packages: [], images: [] });
  await page.getByRole("button", { name: "ادامه ویرایش" }).click();
  await expect(
    page.getByRole("button", { name: "پیش‌نمایش", exact: true }),
  ).toHaveCount(0);
  await step(page, "بررسی و انتشار");
  await page.getByRole("button", { name: "پیش‌نمایش", exact: true }).click();
  await expect(page.locator("#product-preview")).toContainText("محصول جدید");
  await page
    .getByRole("button", { name: "ذخیره و انتشار", exact: true })
    .click();
  await expect(
    page.locator(".product-wizard").getByRole("alert"),
  ).toContainText("خلاصه محصول");
  await expect(page.getByLabel("خلاصه محصول · برای انتشار")).toBeVisible();
  expect(saved).toHaveLength(1);
});
test("batch upload preserves successful images and retries only failures", async ({
  page,
}) => {
  await workspace(page);
  let uploads = 0;
  await page.route("**/api/v1/staff/uploads", async (route) => {
    uploads++;
    await route.fulfill(
      uploads === 2
        ? { status: 500, json: { error: "بارگذاری ناموفق" } }
        : { json: { url: "/images/spices.png" } },
    );
  });
  await page.getByRole("button", { name: "ویرایش", exact: true }).click();
  await step(page, "تصاویر");
  await page
    .getByLabel("بارگذاری تصاویر")
    .setInputFiles(["public/images/spices.png", "public/images/spices.png"]);
  await expect(
    page.locator(".product-wizard").getByRole("alert"),
  ).toContainText("تصاویر موفق حفظ شدند");
  await expect(page.locator(".product-image")).toHaveCount(2);
  await page
    .getByRole("button", { name: "تلاش دوباره برای تصاویر ناموفق" })
    .click();
  await expect(page.locator(".product-image")).toHaveCount(3);
  expect(uploads).toBe(3);
  await expect(page.locator(".product-wizard").getByRole("alert")).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "حذف تصویر 2", exact: true }).click();
  await expect(page.locator(".product-image")).toHaveCount(2);
});
test("publication failure reports the saved draft and preserves edits", async ({
  page,
}) => {
  const saved = await workspace(page);
  await page.route("**/api/v1/staff/products/*/publish", (route) =>
    route.fulfill({ status: 500, json: { error: "انتشار ناموفق" } }),
  );
  await page.getByRole("button", { name: "ویرایش", exact: true }).click();
  await step(page, "بررسی و انتشار");
  await page
    .getByRole("button", { name: "ذخیره و انتشار", exact: true })
    .click();
  await expect(
    page.locator(".product-wizard").getByRole("alert"),
  ).toContainText("پیش‌نویس ذخیره شد، اما انتشار انجام نشد");
  expect(saved).toHaveLength(1);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("filters reset and unsaved work is protected when leaving products", async ({
  page,
}) => {
  await workspace(page);
  const reset = page.getByRole("button", { name: "پاک کردن فیلترها" });
  await expect(reset).toBeDisabled();
  await page.getByLabel("جستجوی محصول", { exact: true }).fill("نام ناموجود");
  await expect(page.getByText("محصولی با این فیلترها پیدا نشد.")).toBeVisible();
  await reset.click();
  await page.getByRole("button", { name: "ویرایش", exact: true }).click();
  await page.getByLabel("نام محصول", { exact: true }).fill("تغییر ذخیره‌نشده");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "مجله", exact: true }).click();
  await expect(page.getByLabel("نام محصول", { exact: true })).toHaveValue(
    "تغییر ذخیره‌نشده",
  );
  await step(page, "بررسی و انتشار");
  await page.getByRole("button", { name: "پیش‌نمایش", exact: true }).click();
  await page
    .locator(".product-wizard")
    .screenshot({ path: "test-results/product-review-desktop.png" });
});

test("manual availability is independent of editor drafts and stock fields are gone", async ({
  page,
}) => {
  await workspace(page);
  const availability: unknown[] = [];
  await page.route("**/api/v1/staff/products/*/availability", async (route) => {
    availability.push(route.request().postDataJSON());
    await route.fulfill({ json: route.request().postDataJSON() });
  });
  await page.getByRole("button", { name: "ویرایش", exact: true }).click();
  await page.getByLabel("نام محصول", { exact: true }).fill("تغییر ذخیره‌نشده");
  await page.getByRole("button", { name: "ناموجود", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "ناموجود", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("نام محصول", { exact: true })).toHaveValue(
    "تغییر ذخیره‌نشده",
  );
  await expect(page.getByText("موجودی و انبار", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: "بایگانی محصول", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "موجود", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "موجود", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(availability).toEqual([{ outOfStock: true }, { outOfStock: false }]);
});
