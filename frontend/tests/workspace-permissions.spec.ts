import { test, expect } from "@playwright/test";

const sections = {
  products: "محصولات",
  articles: "مجله",
  categories: "دسته‌بندی‌ها",
  pricing: "قیمت و تخفیف",
  orders: "سفارش‌ها",
  support: "گفتگو با مشتری",
  custom: "سفارش‌های اختصاصی",
  home: "مدیریت خانه",
  shipping: "ارسال",
  sales: "فروش من",
};

test("each assignable permission exposes exactly its navigation entry and keeps self-service account access", async ({
  page,
}) => {
  let permissions: string[] = [];
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    await route.fulfill({
      json: path.endsWith("/session")
        ? {
            csrf: "test",
            role: "salesperson",
            staffId: "member",
            username: "team.member",
            fullName: "همکار آزمایشی",
            permissions,
          }
        : { orders: 0, support: 0, custom: 0 },
    });
  });
  for (const section of [...Object.keys(sections), "none"]) {
    permissions = section === "none" ? [] : [section];
    await page.goto("/staff/account");
    const nav = page.getByRole("navigation", { name: "ناوبری فضای کار" });
    await expect(
      nav.getByRole("link", { name: "اطلاعات حساب", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await expect(
      page.getByRole("button", { name: "تغییر گذرواژه", exact: true }),
    ).toBeEnabled();
    for (const [key, label] of Object.entries(sections))
      await expect(
        nav.getByRole("link", { name: label, exact: true }),
      ).toHaveCount(key === section ? 1 : 0);
    await expect(nav.locator('a[href^="/omnisire"]')).toHaveCount(0);
  }
});

test("denied sections cannot load through direct URLs after the navigation update", async ({
  page,
}) => {
  const requested: string[] = [];
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    requested.push(path);
    await route.fulfill({
      json: path.endsWith("/session")
        ? {
            csrf: "test",
            role: "salesperson",
            staffId: "member",
            permissions: ["orders"],
          }
        : {
            items: [],
            total: 0,
            page: 1,
            pageSize: 25,
            orders: 0,
            support: 0,
            custom: 0,
          },
    });
  });
  await page.goto("/staff?section=products");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("سفارش‌ها");
  await page.goto("/staff/shipping");
  await expect(
    page.getByRole("heading", { name: "دسترسی محدود" }),
  ).toBeVisible();
  await page.goto("/staff/sales");
  await expect(
    page.getByText("دسترسی به فروش شخصی برای این حساب فعال نیست."),
  ).toBeVisible();
  await page.goto("/omnisire/account");
  await expect(
    page.getByRole("heading", { name: "دسترسی محدود" }),
  ).toBeVisible();
  expect(
    requested.filter((path) =>
      /\/staff\/(products|shipping|sales)$/.test(path),
    ),
  ).toEqual([]);
});
