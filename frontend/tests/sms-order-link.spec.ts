import { prepareCommerce, payCart, completePostal } from "./commerce-fixture";
import { test, expect, type Page } from "@playwright/test";

async function loginAtLink(page: Page, phone: string) {
  await page.getByLabel("شماره همراه", { exact: true }).fill(phone);
  const challenge = page.waitForResponse((r) =>
    r.url().endsWith("/auth/request"),
  );
  await page
    .getByRole("button", { name: "دریافت کد تأیید", exact: true })
    .click();
  const response = await challenge;
  expect(response.ok()).toBeTruthy();
  const { devCode } = await response.json();
  await page.getByLabel("کد تأیید", { exact: true }).fill(devCode);
  await page
    .getByRole("button", { name: "تأیید و ادامه", exact: true })
    .click();
}

test("SMS order URL survives login and never exposes another customer's order", async ({
  page,
  context,
  browser,
  baseURL,
}) => {
  test.setTimeout(120000);
  const request = context.request;
  const session = await (await request.get("/api/v1/session")).json();
  const headers = { Origin: baseURL!, "X-CSRF-Token": session.csrf };
  const phone = "0912" + String(Date.now()).slice(-7);
  const challenge = await (
    await request.post("/api/v1/auth/request", { headers, data: { phone } })
  ).json();
  expect(
    (
      await request.post("/api/v1/auth/verify", {
        headers,
        data: { phone, code: challenge.devCode },
      })
    ).ok(),
  ).toBeTruthy();
  await prepareCommerce(baseURL!, "turmeric");
  const product = await (await request.get("/api/v1/products/turmeric")).json();
  expect(
    (
      await request.put(`/api/v1/cart/items/${product.id}`, {
        headers,
        data: { packageId: product.packages[0].id, quantity: 1 },
      })
    ).ok(),
  ).toBeTruthy();
  const order = { orderId: await payCart(request, baseURL!) };
  const path = `/account/orders/${order.orderId}`;
  await page.goto(path);
  await expect(page.locator(".order-detail-content")).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`${path}$`));
  const outsiderContext = await browser.newContext({ baseURL });
  try {
    const outsider = await outsiderContext.newPage();
    await outsider.goto(path);
    await expect(
      outsider.getByLabel("شماره همراه", { exact: true }),
    ).toBeVisible();
    await expect(outsider.locator(".order-detail-content")).toHaveCount(0);
    await loginAtLink(outsider, "0935" + String(Date.now()).slice(-7));
    await expect(outsider.locator(".account-panel[role=alert]")).toContainText(
      "سفارش پیدا نشد",
    );
    await expect(outsider.locator(".order-detail-content")).toHaveCount(0);
    await expect(outsider).toHaveURL(new RegExp(`${path}$`));
  } finally {
    await outsiderContext.close();
  }
  await page.getByRole("button", { name: "خروج از حساب", exact: true }).click();
  await expect(page.getByLabel("شماره همراه", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`${path}$`));
  await loginAtLink(page, phone);
  await expect(page.locator(".order-detail-content")).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`${path}$`));
  await expect(
    page.locator('.order-timeline [aria-current="step"]'),
  ).toContainText("پرداخت");
});
