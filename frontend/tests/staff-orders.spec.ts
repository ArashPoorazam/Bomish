import { test, expect } from "@playwright/test";
import type { Order } from "../src/lib/types";

test("compact orders open clear details and retain per-package packing checks", async ({
  page,
}) => {
  const order: Order = {
    id: "order-checklist-demo",
    status: "paid",
    createdAt: "2026-09-28T08:30:00Z",
    tracking: "",
    address: {
      id: "address",
      recipient: "مریم احمدی",
      phone: "09121234567",
      province: "تهران",
      city: "تهران",
      street: "خیابان ولیعصر، کوچه بهار، پلاک ۱۲، واحد ۳",
      postalCode: "1234567890",
    },
    items: [
      {
        productId: "spice",
        packageId: "small",
        name: "زردچوبه",
        packageLabel: "۱۰۰ گرم",
        quantity: 2,
        grams: 200,
        priceRials: 100000,
        totalRials: 200000,
        packed: false,
      },
      {
        productId: "spice",
        packageId: "large",
        name: "زردچوبه",
        packageLabel: "۵۰۰ گرم",
        quantity: 1,
        grams: 500,
        priceRials: 400000,
        totalRials: 400000,
        packed: false,
      },
    ],
    subtotalRials: 600000,
    shippingRials: 100000,
    totalRials: 650000,
    discountCode: "SAVE",
    discountRials: 50000,
    events: [{ status: "paid", createdAt: "2026-09-28T08:31:00Z" }],
  };
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace("/api/v1", "");
    if (path.endsWith("/packing")) {
      const body = route.request().postDataJSON();
      order.items.find(
        (i) => i.productId === body.productId && i.packageId === body.packageId,
      )!.packed = body.packed;
      return route.fulfill({ json: { ok: true } });
    }
    if (
      path === `/staff/orders/${order.id}` &&
      route.request().method() === "PATCH"
    ) {
      const body = route.request().postDataJSON();
      order.status = body.status;
      order.tracking = body.tracking || order.tracking;
      order.events.push({
        status: body.status,
        createdAt: new Date().toISOString(),
      });
      return route.fulfill({ json: { ok: true } });
    }
    const values: Record<string, unknown> = {
      "/session": {
        csrf: "test",
        role: "operator",
        staffId: "operator",
        permissions: ["orders", "orders.edit", "orders.pack"],
      },
      "/cart": { items: [], subtotalRials: 0 },
      "/staff/orders": { items: [order], total: 1, page: 1, pageSize: 25 },
      [`/staff/orders/${order.id}`]: order,
    };
    await route.fulfill({ json: values[path] ?? {} });
  });
  await page.goto("/staff?section=orders");
  const row = page.getByRole("button", { name: "جزئیات سفارش", exact: false });
  await expect(row).toBeVisible();
  expect((await row.boundingBox())!.height).toBeLessThan(140);
  await expect(row.locator(".staff-order-stage")).toHaveCount(5);
  await expect(
    page.getByText(order.address.street, { exact: false }),
  ).toHaveCount(0);
  await row.click();
  const detail = page.locator(".staff-order-detail");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(".staff-order-list")).toHaveCount(0);
  await expect(detail.locator(".is-expanded .staff-stage-dot svg")).toHaveCount(
    5,
  );
  await expect(
    detail.getByRole("heading", { name: "قدم بعدی", exact: true }),
  ).toBeVisible();
  await expect(detail).toBeVisible();
  const stages = detail.locator(".staff-order-stages");
  await expect(stages.locator(".is-done")).toHaveCount(2);
  await expect(stages.locator(".is-current")).toContainText("بسته‌بندی");
  await expect(stages.locator(".is-current")).not.toHaveClass(/is-done/);
  await expect(stages.getByText("انجام شد", { exact: true })).toHaveCount(2);
  await expect
    .poll(() =>
      stages
        .locator(".is-current .staff-stage-dot")
        .evaluate((el) => getComputedStyle(el, "::before").animationName),
    )
    .toBe("order-stage-border");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect
    .poll(() =>
      stages
        .locator(".is-current .staff-stage-dot")
        .evaluate((el) => getComputedStyle(el, "::before").animationName),
    )
    .toBe("none");
  await page.emulateMedia({ reducedMotion: "no-preference" });

  await expect(
    detail.getByText(order.address.street, { exact: false }),
  ).toBeVisible();
  const checks = detail.getByRole("checkbox");
  await expect(checks).toHaveCount(2);
  await expect(
    detail.getByRole("button", { name: "تأیید بسته‌بندی", exact: true }),
  ).toBeDisabled();
  await checks.first().check();
  await expect(detail.getByRole("status")).toHaveText(
    "وضعیت بسته‌بندی ذخیره شد.",
  );
  await expect(checks.first()).toBeChecked();
  await expect(checks.nth(1)).not.toBeChecked();
  await expect(
    detail.getByRole("button", { name: "تأیید بسته‌بندی", exact: true }),
  ).toBeDisabled();
  await checks.nth(1).check();
  await expect(
    detail.getByRole("button", { name: "تأیید بسته‌بندی", exact: true }),
  ).toBeEnabled();
  await detail.screenshot({
    path: "test-results/staff-order-detail-desktop.png",
  });
  await detail
    .getByRole("button", { name: "بازگشت به سفارش‌ها", exact: true })
    .click();
  await expect(detail).toHaveCount(0);
  await expect(row).toBeFocused();
  await page.reload();
  await row.click();
  await expect(detail.getByRole("checkbox").first()).toBeChecked();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await detail.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  await detail.screenshot({
    path: "test-results/staff-order-detail-mobile.png",
  });
  await detail.getByRole("button", { name: "بازگشت به سفارش‌ها" }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await row.click();
  await detail
    .getByRole("button", { name: "تأیید بسته‌بندی", exact: true })
    .click();
  await expect(stages.locator(".is-done")).toHaveCount(3);
  await expect(stages.locator(".is-current")).toContainText("ارسال");
  await detail.getByLabel("کد رهگیری مرسوله").fill("12345678901234567890");
  await detail
    .getByRole("button", { name: "ثبت ارسال و اطلاع‌رسانی", exact: true })
    .click();
  await expect(stages.locator(".is-done")).toHaveCount(4);
  await expect(stages.locator(".is-current")).toContainText("تحویل");
  await detail
    .getByRole("button", { name: "تأیید تحویل به مشتری", exact: true })
    .click();
  await expect(stages.locator(".is-done")).toHaveCount(5);
  await expect(stages.locator(".is-current")).toHaveCount(0);
});
