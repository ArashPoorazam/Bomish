import { test, expect } from "@playwright/test";

test("discount form distinguishes per-customer and total limits on mobile", async ({
  page,
}) => {
  const codes: Record<string, unknown>[] = [];
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace("/api/v1", "");
    if (path === "/staff/discount-codes") {
      if (route.request().method() === "POST") {
        const code = {
          ...route.request().postDataJSON(),
          active: true,
          usedCount: 0,
          reservedCount: 0,
          createdAt: new Date().toISOString(),
        };
        codes.push(code);
        return route.fulfill({ status: 201, json: code });
      }
      return route.fulfill({ json: codes });
    }
    const data: Record<string, unknown> = {
      "/session": {
        csrf: "test",
        role: "owner",
        staffId: "owner",
        permissions: ["pricing", "products"],
      },
      "/cart": { items: [], subtotalRials: 0 },
      "/categories": [],
      "/staff/product-options": url.searchParams.has("page")
        ? { items: [], total: 0, page: 1, pageSize: 25 }
        : [],
      "/staff/product-discounts": [],
    };
    await route.fulfill({ json: data[path] ?? { items: [], total: 0 } });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/staff?section=pricing");
  await page.getByRole("tab", { name: "کدهای تخفیف", exact: false }).click();
  await page
    .getByRole("button", { name: "کد تخفیف جدید", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("textbox", { name: "کد تخفیف", exact: true })
    .fill("ONCE10");
  await dialog
    .getByRole("textbox", { name: "درصد تخفیف", exact: true })
    .fill("۱۰");
  const perCustomer = dialog.getByRole("textbox", {
    name: "سقف استفاده هر مشتری",
    exact: true,
  });
  await expect(perCustomer).toBeVisible();
  await expect(perCustomer).toHaveAccessibleDescription(/حساب کاربری/);
  await perCustomer.fill("۱");
  await dialog
    .getByRole("textbox", { name: "سقف استفاده کل کد", exact: true })
    .fill("۱۰۰");
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: "test-results/discount-customer-limit-mobile.png",
    fullPage: true,
  });
  await dialog
    .getByRole("button", { name: "ساخت کد تخفیف", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  expect(codes[0]).toMatchObject({
    code: "ONCE10",
    maxUsesPerCustomer: 1,
    maxUses: 100,
  });
  const card = page
    .locator(".discount-code-card")
    .filter({ hasText: "ONCE10" });
  await expect(card.getByText("۱ بار", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "کد تخفیف جدید", exact: true })
    .click();
  await dialog
    .getByRole("textbox", { name: "کد تخفیف", exact: true })
    .fill("UNLIMITED");
  await dialog
    .getByRole("textbox", { name: "درصد تخفیف", exact: true })
    .fill("5");
  await dialog
    .getByRole("button", { name: "ساخت کد تخفیف", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
  expect(codes[1]).toMatchObject({ maxUsesPerCustomer: 0, maxUses: 0 });
});
