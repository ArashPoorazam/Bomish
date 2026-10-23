import { test, expect } from "@playwright/test";

const sections = {
  products: "محصولات",
  articles: "مجله",
  packaging: "بسته‌بندی‌ها",
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
  await page.goto("/staff?section=packaging");
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
      /\/staff\/(products|product-packaging|shipping|sales)$/.test(path),
    ),
  ).toEqual([]);
});

test("packaging and account navigation use the requested order", async ({
  page,
}) => {
  await page.route("**/api/v1/**", async (route) => {
    await route.fulfill({
      json: new URL(route.request().url()).pathname.endsWith("/session")
        ? {
            csrf: "test",
            role: "manager",
            staffId: "member",
            permissions: Object.keys(sections),
          }
        : { orders: 0, support: 0, custom: 0 },
    });
  });
  await page.goto("/staff/account");
  const nav = page.getByRole("navigation", { name: "ناوبری فضای کار" });
  await expect(nav.locator("#nav-store a")).toHaveText([
    "محصولات",
    "مجله",
    "بسته‌بندی‌ها",
    "دسته‌بندی‌ها",
    "قیمت و تخفیف",
    "مدیریت خانه",
  ]);
  await expect(nav.locator("#nav-account a")).toHaveText([
    "اطلاعات حساب",
    "فروش من",
  ]);
});

test("packaging actions follow their own grants without product access", async ({
  page,
}) => {
  let permissions = ["packaging"];
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    await route.fulfill({
      json: path.endsWith("/session")
        ? { csrf: "test", role: "salesperson", staffId: "member", permissions }
        : path.endsWith("/staff/product-packaging")
          ? [
              {
                id: "jar",
                name: "شیشه",
                emptyGrams: 150,
                lengthMm: 80,
                widthMm: 80,
                heightMm: 100,
                volumeCm3: 640,
              },
            ]
          : { orders: 0, support: 0, custom: 0 },
    });
  });
  for (const action of ["view", "create", "edit"]) {
    permissions =
      action === "view" ? ["packaging"] : ["packaging", `packaging.${action}`];
    await page.goto("/staff?section=packaging");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "بسته‌بندی‌ها",
    );
    await expect(
      page.getByRole("heading", { name: "شیشه", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "افزودن بسته‌بندی", exact: true }),
    ).toHaveCount(action === "create" ? 1 : 0);
    await expect(
      page.getByRole("button", { name: "ویرایش شیشه", exact: true }),
    ).toHaveCount(action === "edit" ? 1 : 0);
  }
});
