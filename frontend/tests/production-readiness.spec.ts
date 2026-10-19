import { test, expect } from "@playwright/test";
import { totp } from "./staff-login";

test.skip(
  process.env.STORE_MODE !== "catalog",
  "Requires the catalog test server",
);

// Run against a disposable catalog-mode server with development fixtures in CI.
// The separate Compose smoke test exercises APP_ENV=production with no fixtures.
test("public catalog browses stable categories and blocks customer transactions", async ({
  page,
  request,
}) => {
  const categories = await (await request.get("/api/v1/categories")).json();
  expect(categories.map((c: { id: string }) => c.id)).toEqual(
    expect.arrayContaining(["spices", "herbs", "seeds"]),
  );
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "باز کردن سبد خرید" }),
  ).toHaveCount(0);
  await page
    .locator('.category-tile[href="/products?category=spices"]')
    .click();
  await expect(page).toHaveURL(/category=spices/);
  await page.goto("/products/pantry-turmeric");
  await expect(
    page.getByText("فروش آنلاین به‌زودی آغاز می‌شود.", { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "افزودن به سبد" })).toHaveCount(
    0,
  );
  await page.goto("/checkout");
  await expect(
    page.getByRole("heading", { name: "فروش آنلاین به‌زودی" }),
  ).toBeVisible();
  for (const path of [
    "/checkout",
    "/checkout/quote",
    "/auth/request",
    "/orders/fake/simulate",
  ]) {
    expect((await request.post("/api/v1" + path, { data: {} })).status()).toBe(
      503,
    );
  }
});

test("staff use passwords while owners unlock Omnisire separately", async ({
  browser,
  baseURL,
}) => {
  const staffContext = await browser.newContext();
  const ownerContext = await browser.newContext();
  try {
    const staff = await staffContext.newPage();
    await staff.goto(baseURL + "/staff");
    await expect(staff.getByLabel("کد برنامه رمزساز")).toHaveCount(0);
    await staff.getByLabel("نام کاربری", { exact: true }).fill("manager");
    await staff
      .getByLabel("گذرواژه", { exact: true })
      .fill("Bomish-demo-2026!");
    await staff
      .getByRole("button", { name: "ورود به فضای کار", exact: true })
      .click();
    await expect(
      staff.getByRole("navigation", { name: "ناوبری فضای کار" }),
    ).toBeVisible();
    await staff.goto(baseURL + "/staff/shipping");
    await expect(
      staff.getByRole("heading", { name: "ارسال", exact: true }),
    ).toBeVisible();
    expect(
      (await staff.request.get(baseURL + "/api/v1/omnisire/members")).status(),
    ).toBe(403);

    const owner = await ownerContext.newPage();
    await owner.goto(baseURL + "/staff");
    await owner.getByLabel("نام کاربری", { exact: true }).fill("owner");
    await owner
      .getByLabel("گذرواژه", { exact: true })
      .fill("Bomish-demo-2026!");
    await owner
      .getByRole("button", { name: "ورود به فضای کار", exact: true })
      .click();
    await expect(
      owner.getByRole("navigation", { name: "ناوبری فضای کار" }),
    ).toBeVisible();
    await expect(
      owner.getByRole("heading", { name: "محصولات", exact: true }),
    ).toBeVisible();
    expect(
      (await owner.request.get(baseURL + "/api/v1/omnisire/members")).status(),
    ).toBe(428);
    await owner.goto(baseURL + "/omnisire");
    await expect(
      owner.getByRole("heading", { name: "ورود به امنی‌سایر" }),
    ).toBeVisible();
    await owner.getByLabel("کد برنامه رمزساز", { exact: true }).fill(totp());
    await owner
      .getByRole("button", { name: "ورود به امنی‌سایر", exact: true })
      .click();
    await expect(
      owner.getByRole("heading", { name: "نمای کلی", exact: true }),
    ).toBeVisible();
    expect(
      (await owner.request.get(baseURL + "/api/v1/omnisire/members")).status(),
    ).toBe(200);
    await owner
      .getByRole("button", { name: "خروج از حساب", exact: true })
      .click();
    await expect(
      owner.getByRole("heading", { name: "ورود همکاران" }),
    ).toBeVisible();
    expect(
      (await owner.request.get(baseURL + "/api/v1/omnisire/members")).status(),
    ).toBe(403);
  } finally {
    await staffContext.close();
    await ownerContext.close();
  }
});
