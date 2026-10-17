import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import type { ShippingConfig } from "../src/lib/types";

// Exercise staff setup itself; carrier/payment lifecycle is covered by shipping.spec.ts.
test("shipping setup keeps technical details out of the interface and saves a sourced box", async ({
  page,
}, testInfo) => {
  const zeroSize = { lengthMm: 0, widthMm: 0, heightMm: 0 };
  const provider = {
    enabled: false,
    verified: false,
    service: "",
    shopId: "",
    currency: "",
    cityId: "",
    area: [],
    maxGrams: 0,
    maxVolumeCm3: 0,
    maxParcels: 0,
    maxSize: zeroSize,
  };
  let cfg: ShippingConfig = {
    version: 1,
    originRevision: 1,
    simulated: true,
    origin: {
      id: "",
      recipient: "فروشگاه بومیش",
      phone: "09121110001",
      province: "تهران",
      city: "تهران",
      provinceId: "tehran-province",
      cityId: "tehran-city",
      street: "خیابان آزمایشی، پلاک ۱۰",
      postalCode: "1234567890",
      latitude: 35.7,
      longitude: 51.4,
      pinConfirmed: true,
    },
    boxes: [],
    localities: [
      {
        id: "tehran-city",
        provinceId: "tehran-province",
        province: "تهران",
        city: "تهران",
        tapinProvince: "",
        tapinCity: "",
        verified: false,
      },
    ],
    snapp: provider,
    tapin: provider,
    freeShippingRials: 0,
    supportUrl: "",
    boxCatalog: JSON.parse(
      readFileSync("../backend/internal/app/shipping_box_catalog.json", "utf8"),
    ),
    readiness: [
      {
        code: "boxes",
        group: "merchant",
        section: "boxes",
        message: "حداقل یک کارتن اندازه‌گیری‌شده و فعال لازم است",
      },
    ],
  };
  let saved: ShippingConfig | undefined;
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace("/api/v1", "");
    if (path === "/session")
      return route.fulfill({
        json: {
          role: "owner",
          staffId: "owner",
          csrf: "test",
          permissions: ["shipping", "products"],
        },
      });
    if (path === "/staff/shipping") {
      if (route.request().method() === "PUT") {
        saved = route.request().postDataJSON();
        cfg = { ...saved!, version: cfg.version + 1, readiness: [] };
      }
      return route.fulfill({ json: cfg });
    }
    if (path === "/shipping/localities")
      return route.fulfill({ json: cfg.localities });
    if (path === "/cart")
      return route.fulfill({ json: { items: [], subtotalRials: 0 } });
    return route.fulfill({ json: [] });
  });
  await page.goto("/staff?section=shipping");
  await expect(page).toHaveURL(/\/omnisire\/shipping$/);
  await expect(
    page
      .getByRole("navigation", { name: "ناوبری فضای کار" })
      .getByRole("link", { name: "ارسال", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(
    page.getByRole("heading", { name: "مبدأ ارسال", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("شناسه فروشگاه", { exact: true }),
  ).not.toBeVisible();
  await expect(
    page.getByText("شهر تهران: اسنپ · سایر شهرها: پست", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "این کارتن را داریم", exact: true })
    .first()
    .click();
  const box = page.locator(".box-stock-card").first();
  await expect(box.getByLabel("موجود و قابل استفاده")).toBeDisabled();
  await expect(
    box.getByRole("group", { name: "ابعاد داخلی", exact: true }),
  ).toHaveCount(0);
  await expect(
    box.getByLabel("ظرفیت وزن ناخالص (گرم)", { exact: true }),
  ).toHaveCount(0);
  await expect(
    box.getByLabel("وزن پرکننده (گرم)", { exact: true }),
  ).toHaveCount(0);
  await expect(
    box.getByLabel("حاشیه محافظ هر سمت (سانتی‌متر)", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "ارسال", exact: true }),
  ).toHaveCount(1);
  await expect(box.locator(".box-usable-size")).toBeVisible();
  await box.getByLabel("وزن کارتن خالی (گرم)", { exact: true }).fill("۶۰");
  await box
    .getByLabel("ابعاد بیرونی و وزن کارتن خالی را بررسی کردم", {
      exact: true,
    })
    .check();
  await box.getByLabel("موجود و قابل استفاده").check();
  await page
    .getByRole("button", { name: "ذخیره تنظیمات", exact: true })
    .click();
  await expect(
    page.getByText("تنظیمات ذخیره شد.", { exact: true }),
  ).toBeVisible();
  expect(saved?.boxes[0]).toMatchObject({
    active: true,
    verified: true,
    emptyGrams: 60,
    maxGrams: 0,
    fillerGrams: 0,
    catalog: { id: "cartonbank-post-1", version: "2026-10-12" },
  });
  await box.getByText("مشخصات و اندازه‌گیری کارتن", { exact: true }).click();
  for (const width of [360, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    await page.screenshot({
      path: testInfo.outputPath(`saved-settings-${width}.png`),
      fullPage: true,
    });
  }
  await expect(
    page.getByText("تنظیمات فنی و راه‌اندازی", { exact: true }),
  ).toHaveCount(0);
  await expect(page.locator('a[href="#shipping-technical"]')).toHaveCount(0);
  await expect(
    page.getByLabel("شناسه اندازه پستی", { exact: true }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
});
