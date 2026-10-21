import { test, expect, type Page } from "@playwright/test";
const session = {
  csrf: "test",
  role: "owner",
  staffId: "owner",
  username: "work.owner",
  fullName: "مریم احمدی",
  omnisireVerified: true,
  permissions: [
    "products",
    "articles",
    "categories",
    "pricing",
    "orders",
    "support",
    "custom",
    "home",
    "shipping",
    "sales",
  ],
};
const orders = Array.from({ length: 20 }, (_, i) => ({
  id: `order-${String(i).padStart(4, "0")}`,
  status: "paid",
  createdAt: "2026-10-20T08:30:00Z",
  address: { recipient: `مشتری ${i}`, city: "تهران", phone: "09121234567" },
  items: [],
  events: [],
  totalRials: 100000,
  tracking: "",
}));
const products = Array.from({ length: 20 }, (_, i) => ({
  id: `product-${i}`,
  name: `محصول ${i}`,
  slug: `product-${i}`,
  packages: [],
  status: "published",
  publishedShippingReady: true,
}));
const paged = (items: unknown[]) => ({
  items,
  total: items.length,
  page: 1,
  pageSize: 25,
});
async function mockWorkspace(page: Page) {
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const responses: Record<string, unknown> = {
      "/session": session,
      "/categories": [],
      "/staff/notifications": { orders: 0, custom: 0, support: 0 },
      "/staff/products": paged(products),
      "/staff/orders": paged(orders),
      "/staff/sales": url.searchParams.has("part")
        ? paged([])
        : {
            balanceRials: 0,
            earnedRials: 0,
            paidRials: 0,
            customers: 0,
            salesRials: 0,
            referralLink: "http://localhost/?ref=owner",
          },
    };
    await route.fulfill({
      json: responses[url.pathname.replace("/api/v1", "")] ?? paged([]),
    });
  });
}
test("Staff preserves sidebar position and collapsed groups across routes with matching active styles", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 600 });
  await mockWorkspace(page);
  await page.goto("/staff?section=orders");
  await expect(page.locator(".staff-order-row")).toHaveCount(20);
  const nav = page.getByRole("navigation", { name: "ناوبری فضای کار" });
  const sidebar = page.locator(".omni-sidebar");
  await nav.getByRole("button", { name: "درخواست‌ها", exact: true }).click();
  for (const name of ["فروش من", "اطلاعات حساب"]) {
    const link = nav.getByRole("link", { name, exact: true });
    await link.scrollIntoViewIfNeeded();
    const before = await sidebar.evaluate((el) => el.scrollTop);
    expect(before).toBeGreaterThan(0);
    await link.click();
    await expect(link).toHaveAttribute("aria-current", "page");
    await expect(link).toHaveCSS("background-color", "rgb(226, 236, 201)");
    await expect
      .poll(() => sidebar.evaluate((el) => el.scrollTop))
      .toBe(before);
    await expect(
      nav.getByRole("button", { name: "درخواست‌ها", exact: true }),
    ).toHaveAttribute("aria-expanded", "false");
  }
  await page.goBack();
  await expect(
    nav.getByRole("link", { name: "فروش من", exact: true }),
  ).toHaveAttribute("aria-current", "page");
});
test("Omnisire preserves sidebar position when opening account", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 520 });
  await mockWorkspace(page);
  await page.goto("/omnisire/events");
  const sidebar = page.locator(".omni-sidebar");
  const account = sidebar.getByRole("link", {
    name: "اطلاعات حساب",
    exact: true,
  });
  await account.scrollIntoViewIfNeeded();
  const before = await sidebar.evaluate((el) => el.scrollTop);
  expect(before).toBeGreaterThan(0);
  await account.click();
  await expect(page).toHaveURL(/\/omnisire\/account$/);
  await expect(account).toHaveAttribute("aria-current", "page");
  await expect.poll(() => sidebar.evaluate((el) => el.scrollTop)).toBe(before);
  await expect(page.getByRole("heading", { name: "مریم احمدی" })).toBeVisible();
});
test("products load once with default filters without moving the toolbar", async ({
  page,
}) => {
  await mockWorkspace(page);
  let requests = 0;
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/v1/staff/products?**", async (route) => {
    requests++;
    await held;
    await route.fulfill({ json: paged(products) });
  });
  await page.goto("/staff?section=products");
  const toolbar = page.locator(".catalog-toolbar-area");
  await expect(toolbar).toBeVisible();
  await page.waitForTimeout(600); // Allow the controls' debounce to settle.
  expect(requests).toBe(1);
  const before = await toolbar.boundingBox();
  await expect(page.getByText("محصولی با این فیلترها پیدا نشد.")).toHaveCount(
    0,
  );
  release();
  await expect(page.locator("tbody tr")).toHaveCount(20);
  expect((await toolbar.boundingBox())!.y).toBe(before!.y);
  await page.waitForTimeout(400);
  expect(requests).toBe(1);
});
test("orders polling preserves row positions, scroll and focus through slow responses and errors", async ({
  page,
}) => {
  await mockWorkspace(page);
  await page.clock.install();
  let requests = 0;
  let release: (() => void) | undefined;
  let fail = false;
  await page.route("**/api/v1/staff/orders?**", async (route) => {
    requests++;
    if (requests > 1)
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    await route.fulfill(
      fail
        ? { status: 503, json: { error: "خطای موقت" } }
        : { json: paged(orders) },
    );
  });
  await page.goto("/staff?section=orders");
  const rows = page.locator(".staff-order-row");
  await expect(rows).toHaveCount(20);
  await page.clock.fastForward(600);
  expect(requests).toBe(1);
  const search = page.getByRole("searchbox");
  await search.focus();
  await page.evaluate(() => window.scrollTo(0, 350));
  const before = await rows.nth(4).boundingBox();
  const scroll = await page.evaluate(() => scrollY);
  for (const failure of [false, true, false]) {
    fail = failure;
    release = undefined;
    await page.clock.fastForward(10000);
    await expect.poll(() => !!release).toBe(true);
    expect((await rows.nth(4).boundingBox())!.y).toBe(before!.y);
    await expect(search).toBeFocused();
    const count = requests;
    await page.clock.fastForward(10000);
    expect(requests).toBe(count);
    const response = page.waitForResponse((r) =>
      r.url().includes("/staff/orders?"),
    );
    release!();
    await response;
    if (failure)
      await expect(page.getByRole("alert")).toContainText("خطای موقت");
    else await expect(page.getByRole("alert")).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(scroll);
    expect((await rows.nth(4).boundingBox())!.y).toBe(before!.y);
    await expect(search).toBeFocused();
  }
});
test("account shows identity, validates passwords, handles errors and works on mobile", async ({
  page,
}) => {
  await mockWorkspace(page);
  let fail = true;
  const changes: unknown[] = [];
  await page.route("**/api/v1/staff/password", async (route) => {
    changes.push(route.request().postDataJSON());
    await route.fulfill(
      fail
        ? { status: 400, json: { error: "گذرواژه فعلی نادرست است" } }
        : { json: { ok: true } },
    );
  });
  await page.goto("/staff/account");
  await expect(page.getByRole("heading", { name: "مریم احمدی" })).toBeVisible();
  await expect(page.locator(".staff-account-details")).toContainText(
    "work.owner",
  );
  const current = page.getByLabel("گذرواژه فعلی", { exact: true });
  const next = page.getByLabel("گذرواژه جدید", { exact: true });
  const confirm = page.getByLabel("تکرار گذرواژه جدید", { exact: true });
  await current.fill("current-password");
  await next.fill("new-password-123");
  await confirm.fill("different-password");
  const save = page.getByRole("button", { name: "تغییر گذرواژه", exact: true });
  await save.click();
  await expect(page.getByRole("alert")).toContainText("یکسان نیست");
  expect(changes).toHaveLength(0);
  await expect(confirm).toBeFocused();
  await confirm.fill("new-password-123");
  await page
    .getByRole("button", { name: "نمایش گذرواژه جدید", exact: true })
    .click();
  await expect(next).toHaveAttribute("type", "text");
  await save.click();
  await expect(page.getByRole("alert")).toContainText("نادرست");
  await expect(next).toHaveValue("new-password-123");
  fail = false;
  await save.click();
  await expect(page.getByRole("status")).toContainText("گذرواژه تغییر کرد");
  await expect(next).toHaveValue("");
  await expect(next).toHaveAttribute("type", "password");
  await expect(current).toHaveValue("");
  expect(changes.at(-1)).toEqual({
    currentPassword: "current-password",
    newPassword: "new-password-123",
  });
  await page.screenshot({
    path: "test-results/workspace-account-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "فهرست", exact: true }).click();
  await page.getByRole("link", { name: "فروش من", exact: true }).click();
  await expect(page).toHaveURL(/\/staff\/sales$/);
  await expect(page.locator(".omni-sidebar")).not.toHaveClass(/is-open/);
  await page.goto("/staff/account");
  await page.screenshot({
    path: "test-results/workspace-account-mobile.png",
    fullPage: true,
  });
});
