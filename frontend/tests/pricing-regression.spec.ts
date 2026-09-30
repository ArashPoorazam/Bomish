import { test, expect } from "@playwright/test";
import { loginStaff } from "./staff-login";
import type { Product } from "../src/lib/types";

test("live pricing supports group lifecycle, price changes, and code action layout", async ({
  page,
}) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/staff");
  await loginStaff(page, "owner");
  await page.goto("/staff?section=pricing");
  const session = await (
    await page.request.get("/api/v1/session?workspace=staff")
  ).json();
  const headers = {
    Origin: new URL(page.url()).origin,
    "X-CSRF-Token": session.csrf,
  };
  const options = await (
    await page.request.get("/api/v1/staff/product-options?page=1&pageSize=2")
  ).json();
  const products = options.items as Product[];
  expect(products).toHaveLength(2);
  const ids = products.map((p) => p.id);
  const name = `بررسی تخفیف ${Date.now()}`;
  const code = `CHECK${Date.now()}`;
  let discountID = "";
  let priceChanged = false;
  async function selectProducts() {
    for (const p of products) {
      await page.getByLabel("جستجوی محصولات", { exact: true }).fill(p.slug);
      await page
        .getByRole("button", { name: `انتخاب ${p.name}`, exact: true })
        .click();
    }
  }
  async function currentProducts() {
    return (
      await (
        await page.request.get(
          `/api/v1/staff/product-options?page=1&ids=${ids.join(",")}`,
        )
      ).json()
    ).items as Product[];
  }
  try {
    await expect(
      page.getByRole("heading", { name: "تخفیف‌های محصولات" }),
    ).toBeVisible();
    await expect(
      page.getByText("Unexpected non-whitespace", { exact: false }),
    ).toHaveCount(0);
    await page.getByLabel("نام تخفیف", { exact: true }).fill(name);
    await selectProducts();
    await page.getByLabel("درصد تخفیف", { exact: true }).fill("17");
    const created = page.waitForResponse(
      (r) =>
        r.url().endsWith("/staff/product-discounts") &&
        r.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "ساخت تخفیف برای ۲ محصول", exact: true })
      .click();
    const response = await created;
    discountID = response.request().postDataJSON().id;
    expect(response.status()).toBe(201);
    const card = page.locator(".discount-code-card").filter({ hasText: name });
    await expect(card.getByText("فعال", { exact: true })).toBeVisible();
    for (const p of await currentProducts())
      expect(p.discountPercent).toBe(
        Math.max(17, products.find((v) => v.id === p.id)!.discountPercent),
      );
    await card
      .getByRole("button", { name: "غیرفعال کردن", exact: true })
      .click();
    await expect(card.getByText("غیرفعال", { exact: true })).toBeVisible();
    for (const p of await currentProducts())
      expect(p.discountPercent).toBe(
        products.find((v) => v.id === p.id)!.discountPercent,
      );
    await card.getByRole("button", { name: "فعال کردن", exact: true }).click();
    await expect(card.getByText("فعال", { exact: true })).toBeVisible();
    await card.getByRole("button", { name: "حذف تخفیف", exact: true }).click();
    await expect(card).toHaveCount(0);
    discountID = "";

    await page
      .getByRole("tab", { name: "اصلاح قیمت پایه", exact: false })
      .click();
    await selectProducts();
    await page
      .getByLabel("میزان تغییر هر بسته (تومان)", { exact: false })
      .fill("1");
    const adjusted = page.waitForResponse(
      (r) =>
        r.url().endsWith("/staff/pricing") && r.request().method() === "POST",
    );
    await page
      .getByRole("button", {
        name: "اعمال تغییر قیمت برای ۲ محصول",
        exact: true,
      })
      .click();
    expect((await adjusted).ok()).toBe(true);
    priceChanged = true;
    for (const p of await currentProducts()) {
      const old = products.find((v) => v.id === p.id)!;
      for (const pack of p.packages)
        expect(pack.priceRials).toBe(
          old.packages.find((v) => v.id === pack.id)!.priceRials + 10,
        );
    }

    await page.getByRole("tab", { name: "کدهای تخفیف", exact: false }).click();
    await page
      .getByRole("button", { name: "کد تخفیف جدید", exact: true })
      .click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("کد تخفیف", { exact: true }).fill(code);
    await dialog.getByLabel("درصد تخفیف", { exact: true }).fill("10");
    await dialog
      .getByRole("button", { name: "ساخت کد تخفیف", exact: true })
      .click();
    const coupon = page
      .locator(".discount-code-card")
      .filter({ hasText: code });
    await expect(coupon).toBeVisible();
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      const toggle = await coupon
        .getByRole("button", { name: "غیرفعال کردن کد", exact: true })
        .boundingBox();
      const remove = await coupon
        .getByRole("button", { name: "حذف کد تخفیف", exact: true })
        .boundingBox();
      expect(Math.abs(toggle!.y - remove!.y)).toBeLessThan(2);
      expect(Math.abs(toggle!.x - remove!.x)).toBeGreaterThan(10);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    }
    await coupon.screenshot({ path: "test-results/pricing-code-actions.png" });
    await coupon
      .getByRole("button", { name: "غیرفعال کردن کد", exact: true })
      .click();
    await expect(coupon.getByText("غیرفعال", { exact: true })).toBeVisible();
    await coupon
      .getByRole("button", { name: "فعال کردن کد", exact: true })
      .click();
    await expect(coupon.getByText("فعال", { exact: true })).toBeVisible();
    await coupon
      .getByRole("button", { name: "حذف کد تخفیف", exact: true })
      .click();
    await expect(coupon).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    if (discountID)
      await page.request.delete(
        `/api/v1/staff/product-discounts/${discountID}`,
        { headers },
      );
    if (priceChanged)
      expect(
        (
          await page.request.post("/api/v1/staff/pricing", {
            headers,
            data: { productIds: ids, amount: -10 },
          })
        ).ok(),
      ).toBe(true);
    await page.request.delete(`/api/v1/staff/discount-codes/${code}`, {
      headers,
    });
  }
});

test("plain-text missing pricing route shows a readable error and can retry", async ({
  page,
}) => {
  let missing = true;
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace("/api/v1", "");
    if (path === "/staff/product-discounts") {
      return missing
        ? route.fulfill({
            status: 404,
            contentType: "text/plain",
            body: "404 page not found\n",
          })
        : route.fulfill({ json: [] });
    }
    const data: Record<string, unknown> = {
      "/session": {
        csrf: "test",
        role: "owner",
        staffId: "owner",
        permissions: ["pricing"],
      },
      "/cart": { items: [], subtotalRials: 0 },
      "/categories": [],
      "/staff/product-options": new URL(route.request().url()).searchParams.has(
        "page",
      )
        ? { items: [], total: 0 }
        : [],
    };
    await route.fulfill({ json: data[path] ?? {} });
  });
  await page.goto("/staff?section=pricing");
  await expect(
    page.locator(".pricing-workspace").getByRole("alert"),
  ).toContainText("این بخش در سرویس فروشگاه در دسترس نیست");
  await expect(
    page.getByText("Unexpected non-whitespace", { exact: false }),
  ).toHaveCount(0);
  missing = false;
  await page.getByRole("button", { name: "تلاش دوباره", exact: true }).click();
  await expect(
    page.locator(".pricing-workspace").getByRole("alert"),
  ).toHaveCount(0);
  await expect(page.getByText("هنوز تخفیفی ساخته نشده است.")).toBeVisible();
});
