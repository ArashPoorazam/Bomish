import { test, expect } from "@playwright/test";
const session = {
  csrf: "test",
  role: "owner",
  staffId: "owner",
  permissions: [
    "products",
    "categories",
    "articles",
    "pricing",
    "orders",
    "shipping",
    "sales",
    "omnisire",
  ],
};
const products = Array.from({ length: 30 }, (_, i) => ({
  id: String(i + 1),
  name: `محصول ${i + 1}`,
  quantity: i + 1,
  clicks: i + 2,
  revenue: (i + 1) * 10000,
}));
test("weekly charts compare products across pages and keep whole-period shares", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const requests: URL[] = [];
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/session"))
      return route.fulfill({ json: session });
    if (url.pathname.endsWith("/charts")) {
      requests.push(url);
      const ids = (url.searchParams.get("ids") || "1,2,3,4,5").split(",");
      const days = [
        "2026-09-22",
        "2026-09-23",
        "2026-09-24",
        "2026-09-25",
        "2026-09-26",
        "2026-09-27",
        "2026-09-28",
      ];
      return route.fulfill({
        json: {
          days,
          totals: products,
          packages: [
            {
              name: "محصول 1",
              package: "۲۰۰ گرم",
              quantity: 2,
              revenue: 10000,
            },
          ],
          points: products
            .filter((p) => ids.includes(p.id))
            .flatMap((p) =>
              days.map((day, i) => ({ ...p, day, quantity: i, clicks: i + 1 })),
            ),
        },
      });
    }
    if (url.pathname.endsWith("/analytics")) {
      const p = Number(url.searchParams.get("page") || 1);
      return route.fulfill({
        json: {
          items: products.slice((p - 1) * 25, p * 25),
          total: 30,
          page: p,
          pageSize: 25,
          columns: [
            { key: "name", label: "محصول", kind: "text" },
            { key: "quantity", label: "تعداد", kind: "number" },
          ],
        },
      });
    }
    return route.fulfill({ json: { items: [] } });
  });
  await page.goto("/omnisire/analytics?section=products");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "عملکرد محصولات",
  );
  await expect(
    page.locator(".omni-top,.omni-report-nav,.omni-bar-chart"),
  ).toHaveCount(0);
  await expect(page.locator(".omni-line-chart svg path")).toHaveCount(5);
  const from = await page.getByLabel("از تاریخ", { exact: true }).inputValue(),
    to = await page.getByLabel("تا تاریخ", { exact: true }).inputValue();
  expect((Date.parse(to) - Date.parse(from)) / 86400000).toBe(6);
  const report = page
    .locator(".omni-panel")
    .filter({ has: page.getByRole("heading", { name: "داده‌های گزارش" }) });
  await report
    .getByRole("checkbox", { name: "انتخاب محصول 1", exact: true })
    .check();
  await expect(page.locator(".omni-line-chart svg path")).toHaveCount(1);
  await page.getByRole("button", { name: "بعدی", exact: true }).click();
  await report
    .getByRole("checkbox", { name: "انتخاب محصول 26", exact: true })
    .check();
  await expect(page.locator(".omni-line-chart svg path")).toHaveCount(2);
  await page.getByRole("button", { name: "قبلی", exact: true }).click();
  await expect(
    report.getByRole("checkbox", { name: "انتخاب محصول 1", exact: true }),
  ).toBeChecked();
  await page
    .getByRole("combobox", { name: "شاخص نمودار", exact: true })
    .selectOption("clicks");
  await page.getByRole("slider", { name: "روز نمودار" }).fill("2");
  await expect(page.locator(".chart-tooltip")).toContainText("محصول 26");
  await expect(page.locator(".chart-pie")).toHaveCount(2);
  await expect(
    page.getByRole("heading", { name: "فروش هر بسته در محصولات" }),
  ).toBeVisible();
  await page.getByLabel("از تاریخ", { exact: true }).fill("2026-09-01");
  await expect
    .poll(() => requests.at(-1)?.searchParams.get("from"))
    .toBe("2026-09-01");
  expect(requests.at(-1)?.searchParams.get("ids")).toBe("1,26");
  await page.screenshot({
    path: "test-results/charts-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "فهرست", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "تاریخچه قیمت", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.screenshot({
    path: "test-results/charts-mobile.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
test("staff navigation, category editing page, and member cancellation", async ({
  page,
}) => {
  const saved: unknown[] = [];
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/session")) return route.fulfill({ json: session });
    if (
      path.endsWith("/categories/spices") &&
      route.request().method() === "PUT"
    ) {
      saved.push(route.request().postDataJSON());
      return route.fulfill({ json: { ok: true } });
    }
    if (path.endsWith("/categories"))
      return route.fulfill({
        json: [{ id: "spices", name: "ادویه‌ها", description: "توضیح" }],
      });
    if (path.endsWith("/category-counts"))
      return route.fulfill({ json: { spices: 1 } });
    if (path.endsWith("/product-options")) return route.fulfill({ json: [] });
    return route.fulfill({
      json: { items: [], total: 0, page: 1, pageSize: 25 },
    });
  });
  await page.goto("/staff?section=categories");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "دسته‌بندی‌ها",
  );
  await expect(page.locator(".omni-sidebar")).toContainText("Staff Interface");
  await expect(page.locator(".omni-sidebar")).not.toContainText(
    "ورود به Omnisire",
  );
  await page.getByRole("link", { name: "ویرایش", exact: true }).click();
  await expect(page).toHaveURL(/\/staff\/categories\/spices$/);
  await expect(page.locator(".category-cards")).toHaveCount(0);
  await page.getByLabel("نام دسته", { exact: true }).fill("ادویه تازه");
  await page.getByRole("button", { name: "ذخیره دسته", exact: true }).click();
  await expect(page).toHaveURL(/section=categories/);
  expect(saved).toEqual([{ name: "ادویه تازه", description: "توضیح" }]);
  await page.goto("/omnisire/members");
  await page.getByRole("button", { name: "همکار جدید", exact: true }).click();
  await expect(
    page.getByLabel("شماره کارت بانکی", { exact: true }),
  ).toHaveAttribute("placeholder", "1111 - 2222 - 3333 - 4444");
  await page.getByRole("button", { name: "انصراف", exact: true }).click();
  await expect(
    page.getByLabel("نام و نام خانوادگی", { exact: true }),
  ).toHaveCount(0);
});
