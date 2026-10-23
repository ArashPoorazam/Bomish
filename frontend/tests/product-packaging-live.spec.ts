import { test, expect } from "@playwright/test";
import { loginStaffAPI } from "./staff-login";
import type { Product, ProductPackaging } from "../src/lib/types";

test.skip(
  process.env.PACKAGING_ACCEPTANCE !== "true",
  "Requires an isolated, seeded development server",
);

test("staff packaging and new product persist through the real API", async ({
  page,
}) => {
  const origin = process.env.BASE_URL || "http://localhost:3000";
  await loginStaffAPI(page.request, origin, "editor");
  const suffix = Date.now().toString();
  const packagingName = `شیشه آزمایش ${suffix}`;
  const productName = `محصول آزمایش ${suffix}`;
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/staff?section=packaging");
  await page
    .getByRole("button", { name: "افزودن بسته‌بندی", exact: true })
    .click();
  await page.getByLabel("نام بسته‌بندی", { exact: true }).fill(packagingName);
  await page.getByLabel("وزن بسته‌بندی خالی (گرم)").fill("150");
  await page.getByLabel("طول بیرونی (سانتی‌متر)").fill("8");
  await page.getByLabel("عرض بیرونی (سانتی‌متر)").fill("8");
  await page.getByLabel("ارتفاع بیرونی (سانتی‌متر)").fill("10");
  await page.getByRole("button", { name: "محاسبه حجم از ابعاد" }).click();
  await page
    .getByRole("button", { name: "ذخیره بسته‌بندی", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("بسته‌بندی ذخیره شد.");
  const packagingResponse = await page.request.get(
    "/api/v1/staff/product-packaging",
  );
  expect(packagingResponse.ok()).toBe(true);
  const packaging = (
    (await packagingResponse.json()) as ProductPackaging[]
  ).find((item) => item.name === packagingName)!;
  expect(packaging).toMatchObject({
    emptyGrams: 150,
    lengthMm: 80,
    widthMm: 80,
    heightMm: 100,
    volumeCm3: 640,
  });
  await page
    .getByRole("navigation", { name: "ناوبری فضای کار" })
    .getByRole("button", { name: "محصولات", exact: true })
    .click();
  await page.getByRole("button", { name: "افزودن محصول", exact: true }).click();
  await page.getByLabel("نام محصول", { exact: true }).fill(productName);
  await page
    .getByLabel("نشانی صفحه", { exact: true })
    .fill(`packaging-${suffix}`);
  await page.getByLabel("دسته‌بندی", { exact: true }).selectOption("spices");
  await page
    .getByRole("navigation", { name: "مراحل محصول" })
    .getByRole("button", { name: "بسته‌ها" })
    .click();
  await page.getByRole("button", { name: "افزودن بسته", exact: true }).click();
  await page.getByLabel("مقدار محتویات", { exact: true }).fill("500");
  await page
    .getByLabel("بسته‌بندی محصول", { exact: true })
    .selectOption(packaging.id);
  await expect(page.getByText("وزن ارسال:")).toContainText("۶۵۰");
  await page
    .getByRole("button", { name: "ذخیره پیش‌نویس", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "پیش‌نویس ذخیره شد" }),
  ).toBeVisible();
  const productResponse = await page.request.get(
    `/api/v1/staff/products?q=packaging-${suffix}&page=1`,
  );
  expect(productResponse.ok()).toBe(true);
  const products = (await productResponse.json()) as { items: Product[] };
  const matches = products.items.filter(
    (item) => item.slug === `packaging-${suffix}`,
  );
  expect(matches).toHaveLength(1);
  const product = matches[0];
  const { usedByProducts: _usage, ...definition } = packaging;
  expect(product.packages[0]).toMatchObject({
    packagingId: packaging.id,
    packaging: definition,
    netGrams: 500,
    shippingGrams: 650,
    lengthMm: 80,
    widthMm: 80,
    heightMm: 100,
    shippingVerified: true,
  });
  await page.goto("/staff?section=packaging");
  await page
    .getByLabel("جستجوی بسته‌بندی", { exact: true })
    .fill(packagingName);
  await expect(page.getByText("در ۱ محصول", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: `ویرایش ${packagingName}`, exact: true })
    .click();
  await expect(
    page.getByText("۱ محصول به‌روز می‌شود", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("وزن بسته‌بندی خالی (گرم)").fill("200");
  await page.getByLabel("عرض بیرونی (سانتی‌متر)").fill("9");
  await page.getByRole("button", { name: "محاسبه حجم از ابعاد" }).click();
  await page.screenshot({
    path: "test-results/packaging-editor-desktop.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "ذخیره بسته‌بندی", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "۱ محصول و پیش‌نویس‌های مرتبط به‌روز شدند.",
  );
  const refreshed = await page.request.get(
    `/api/v1/staff/products?q=${product.id}&page=1`,
  );
  expect(refreshed.ok()).toBe(true);
  const updated = (await refreshed.json()) as { items: Product[] };
  const refreshedProduct = updated.items.find((item) => item.id === product.id);
  expect(refreshedProduct?.packages[0]).toMatchObject({
    shippingGrams: 700,
    widthMm: 90,
    packaging: { emptyGrams: 200, widthMm: 90, volumeCm3: 720 },
  });
  await page.getByLabel("جستجوی بسته‌بندی", { exact: true }).fill("");
  await page.screenshot({
    path: "test-results/packaging-catalog-desktop.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
