import { test, expect } from "@playwright/test";

test("the deferred cart restores focus and scrolling on close and navigation", async ({
  page,
}) => {
  const scopes: string[] = [];
  let cartReads = 0;
  await page.route("**/api/v1/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/session")) {
      scopes.push(url.searchParams.get("workspace") || "customer");
      return route.fulfill({
        json: { csrf: "test", authenticated: false, role: "", permissions: [] },
      });
    }
    if (url.pathname.endsWith("/cart")) {
      cartReads++;
      return route.fulfill({ json: { items: [], subtotalRials: 0 } });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto("/about");
  await expect.poll(() => cartReads).toBe(1);
  const trigger = page.getByRole("button", { name: /سبد خرید/ });
  const drawer = page.getByRole("dialog", { name: "سبد خرید", exact: true });
  await page.evaluate(() => {
    document.body.style.overflow = "auto";
  });
  await trigger.click();
  await expect(drawer).toBeVisible();
  await expect(page.locator("body")).toHaveCSS("overflow", "hidden");
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(page.locator("body")).toHaveCSS("overflow", "auto");
  await trigger.click();
  await expect(drawer).toBeVisible();
  await drawer.getByRole("link", { name: "دیدن محصولات" }).click();
  await expect(page).toHaveURL(/\/products$/);
  await expect(drawer).toHaveCount(0);
  await expect(page.locator("body")).toHaveCSS("overflow", "auto");
  await page.goto("/staff");
  await expect(
    page.getByRole("button", { name: "ورود به فضای کار" }),
  ).toBeVisible();
  await expect(page.locator(".site-header")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "گفتگو با پشتیبانی", exact: true }),
  ).toHaveCount(0);
  expect(scopes).toContain("staff");
  expect(cartReads).toBe(1);
  await expect(page.locator("body")).not.toHaveCSS("overflow", "hidden");
});

test("a page render failure preserves storefront navigation and support", async ({
  page,
}) => {
  await page.route("**/api/v1/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/session"))
      return route.fulfill({
        json: { csrf: "test", authenticated: true, role: "", permissions: [] },
      });
    if (path.endsWith("/cart"))
      return route.fulfill({ json: { items: [], subtotalRials: 0 } });
    // Deliberately violate the contract to exercise the render error boundary.
    if (path.endsWith("/orders")) return route.fulfill({ json: {} });
    return route.fulfill({ json: [] });
  });
  await page.goto("/account");
  await expect(
    page.getByRole("heading", { name: "ارتباط با فروشگاه برقرار نشد" }),
  ).toBeVisible();
  await expect(page.locator(".site-header")).toBeVisible();
  await page
    .getByRole("button", { name: "گفتگو با پشتیبانی", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "پشتیبانی بومیش" }),
  ).toBeVisible();
  await expect(page.locator("main#main")).toHaveCount(1);
});
