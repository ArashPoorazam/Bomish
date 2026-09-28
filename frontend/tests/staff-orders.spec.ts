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
    const values: Record<string, unknown> = {
      "/session": {
        csrf: "test",
        role: "operator",
        staffId: "operator",
        permissions: ["orders"],
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
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByText(order.address.street, { exact: false }),
  ).toBeVisible();
  const checks = dialog.getByRole("checkbox");
  await expect(checks).toHaveCount(2);
  await checks.first().check();
  await expect(dialog.getByRole("status")).toHaveText(
    "وضعیت بسته‌بندی ذخیره شد.",
  );
  await expect(checks.first()).toBeChecked();
  await expect(checks.nth(1)).not.toBeChecked();
  await dialog.screenshot({
    path: "test-results/staff-order-detail-desktop.png",
  });
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(row).toBeFocused();
  await page.reload();
  await row.click();
  await expect(dialog.getByRole("checkbox").first()).toBeChecked();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await dialog.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  await dialog.screenshot({
    path: "test-results/staff-order-detail-mobile.png",
  });
  await dialog.getByRole("button", { name: "بستن جزئیات سفارش" }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
