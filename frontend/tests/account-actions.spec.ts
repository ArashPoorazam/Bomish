import { test, expect } from "@playwright/test";

test("owner account menu stays in staff workspace", async ({ page }) => {
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    await route.fulfill({
      json: path.endsWith("/session")
        ? {
            csrf: "test",
            role: "owner",
            permissions: [
              "sales",
              "analytics",
              "orders",
              "overview",
              "shipping",
            ],
            omnisireVerified: true,
          }
        : {
            orders: 0,
            support: 0,
            custom: 0,
            revenue: 0,
            members: 0,
            payable: 0,
          },
    });
  });
  await page.goto("/staff/account");
  const nav = page.getByRole("navigation", { name: "ناوبری فضای کار" });
  await expect(
    nav.getByRole("link", { name: "فروش من", exact: true }),
  ).toHaveAttribute("href", "/staff/sales");
  await expect(nav.locator('a[href^="/omnisire"]')).toHaveCount(0);
  await nav.getByRole("button", { name: "حساب کاربری" }).click();
  await expect(
    nav.getByRole("link", { name: "فروش من", exact: true }),
  ).toBeHidden();
  await page
    .getByLabel("گذرواژه فعلی", { exact: true })
    .fill("current-password");
  await page
    .getByLabel("گذرواژه جدید", { exact: true })
    .fill("new-password-123");
  await page
    .getByLabel("تکرار گذرواژه جدید", { exact: true })
    .fill("different-password");
  await page
    .getByRole("button", { name: "تغییر گذرواژه", exact: true })
    .click();
  await expect(page.locator("form").getByRole("alert")).toContainText(
    "یکسان نیست",
  );
  await page.goto("/omnisire");
  await expect(
    nav.getByRole("button", { name: "تحلیل داده‌ها" }),
  ).toBeVisible();
});

test("customer cancellation requires confirmation and shows refund timing", async ({
  page,
}) => {
  let cancelled = false,
    requests = 0;
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    let body: unknown = [];
    if (path.endsWith("/session"))
      body = {
        csrf: "test",
        authenticated: true,
        permissions: [],
        role: "",
        catalogOnly: false,
      };
    if (path.endsWith("/cart")) body = { items: [], subtotalRials: 0 };
    if (path.endsWith("/cancel")) {
      cancelled = true;
      requests++;
      body = { ok: true };
    }
    if (path.endsWith("/orders"))
      body = ["paid", "shipped"].map((status) => ({
        id: status + "-order",
        status: status === "paid" && cancelled ? "cancelled" : status,
        createdAt: "2026-10-21T12:00:00Z",
        totalRials: 1000,
        items: [],
      }));
    await route.fulfill({ json: body });
  });
  await page.goto("/account?section=orders");
  const button = page.getByRole("button", { name: "لغو سفارش", exact: true });
  await expect(button).toHaveCount(1);
  await button.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("۲۴ تا ۴۸ ساعت");
  await dialog.getByRole("button", { name: "انصراف" }).click();
  expect(requests).toBe(0);
  await button.click();
  await dialog.getByRole("button", { name: "تأیید لغو سفارش" }).click();
  await expect(page.getByText("سفارش لغو شد.", { exact: false })).toBeVisible();
  expect(requests).toBe(1);
  await expect(button).toHaveCount(0);
});
