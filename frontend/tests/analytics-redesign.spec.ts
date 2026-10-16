import { test, expect } from "@playwright/test";
import { loginStaffAPI } from "./staff-login";

test("real analytics reports, customer drilldown and filtered export", async ({
  page,
  baseURL,
}) => {
  test.skip(
    process.env.ANALYTICS_FIXTURE !== "1",
    "Requires the isolated analytics fixture documented in tests/fixtures/analytics.sql",
  );
  test.setTimeout(120000);
  await loginStaffAPI(page.request, baseURL!, "owner");
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const badResponses: string[] = [];
  page.on("response", (r) => {
    if (r.url().includes("/omnisire/analytics") && !r.ok())
      badResponses.push(`${r.status()} ${r.url()}`);
  });
  for (const section of [
    "overview",
    "products",
    "packages",
    "prices",
    "customers",
    "categories",
    "searches",
  ]) {
    await page.goto(`/omnisire/analytics?section=${section}`);
    await expect(page.locator(".analytics-summary article")).toHaveCount(3);
    await expect(page.locator(".analytics-table-panel table")).toBeVisible();
    await expect(page.locator(".omni-line-chart svg")).toBeVisible();
    await expect(page.locator(".analytics-workspace [role=alert]")).toHaveCount(
      0,
    );
  }
  await page.goto("/omnisire/analytics?section=products");
  await expect(page.locator(".analytics-summary article")).toHaveCount(3);
  await page.screenshot({
    path: "test-results/analytics-redesign-desktop.png",
    fullPage: true,
  });
  const table = page.locator(".analytics-table-panel");
  await table.getByRole("checkbox").first().check();
  await expect(page.locator(".analytics-chips button")).toHaveCount(1);
  await page.getByLabel("شاخص نمودار", { exact: true }).selectOption("views");
  await expect(page.locator(".analytics-ranking h2")).toContainText("بازدید");
  await table
    .getByRole("button", { name: "فروش خالص (تومان)", exact: true })
    .click();
  await expect(table.locator('th[aria-sort="ascending"]')).toContainText(
    "فروش خالص",
  );
  await page.getByRole("searchbox").fill("نتیجه‌ای‌ندارد");
  await expect(
    page.getByRole("heading", { name: "نتیجه‌ای برای این جستجو پیدا نشد" }),
  ).toBeVisible();
  await expect(page.locator(".analytics-chips button")).toHaveCount(1);
  await page
    .getByRole("button", { name: "پاک کردن جستجو", exact: true })
    .first()
    .click();
  await expect(table.locator("tbody tr")).toHaveCount(25);
  await page.getByRole("button", { name: "دریافت اکسل", exact: true }).click();
  const download = page.getByRole("link", {
    name: "دانلود فایل اکسل",
    exact: true,
  });
  await expect(download).toBeVisible({ timeout: 20000 });
  const response = await page.request.get(
    (await download.getAttribute("href"))!,
  );
  expect(response.ok()).toBe(true);
  expect(response.headers()["content-type"]).toContain("spreadsheetml");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: "test-results/analytics-redesign-mobile.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/omnisire/analytics?section=customers");
  await page.locator(".analytics-table-panel tbody .text-link").first().click();
  await expect(
    page.getByRole("heading", { name: "سفارش‌های مشتری", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".analytics-ranking")).toHaveCount(0);
  await expect(page.locator(".analytics-summary article")).toHaveCount(3);
  await page
    .getByRole("button", { name: "بازگشت به مشتریان", exact: true })
    .click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("مشتریان");
  expect(errors).toEqual([]);
  expect(badResponses).toEqual([]);
});

test("owner analytics renders all reports with the current development data", async ({
  page,
  baseURL,
}) => {
  await loginStaffAPI(page.request, baseURL!, "owner");
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  for (const section of [
    "overview",
    "products",
    "packages",
    "prices",
    "customers",
    "categories",
    "searches",
  ]) {
    await page.goto(`/omnisire/analytics?section=${section}`);
    await expect(page.locator(".analytics-summary article")).toHaveCount(3);
    await expect(page.locator(".analytics-workspace [role=alert]")).toHaveCount(
      0,
    );
    await expect(
      page.locator(".analytics-chart-loading,.analytics-table-loading"),
    ).toHaveCount(0);
  }
  expect(errors).toEqual([]);
});
