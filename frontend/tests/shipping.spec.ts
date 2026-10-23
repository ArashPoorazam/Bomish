import { test, expect, type APIRequestContext } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loginStaffAPI } from "./staff-login";
import type {
  ShippingConfig,
  Product,
  Address,
  DeliveryRecord,
} from "../src/lib/types";
test.skip(
  process.env.SHIPPING_ACCEPTANCE !== "true",
  "Requires an isolated simulated shipping server",
);
const origin = process.env.BASE_URL || "http://localhost:3000";
let shippingProduct: Product;
const address: Address = {
  id: "",
  recipient: "گیرنده آزمایشی ارسال",
  phone: "09125550123",
  province: "تهران",
  city: "تهران",
  provinceId: "tehran-province",
  cityId: "tehran-city",
  street: "خیابان آزمایشی ارسال، پلاک ۱۰",
  postalCode: "1234567890",
  latitude: 35.7,
  longitude: 51.4,
  pinConfirmed: true,
};
async function checked(
  request: APIRequestContext,
  path: string,
  method: string,
  data: unknown,
  headers: Record<string, string>,
) {
  const r = await request.fetch(`/api/v1${path}`, { method, data, headers });
  expect(r.ok(), await r.text()).toBeTruthy();
  return r.json();
}
test("calculated shipping: measurements, setup, customer quote, readiness, one courier and delivery", async ({
  browser,
  page,
}, testInfo) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const headers = await loginStaffAPI(page.request, origin, "owner");
  const products = (await (
    await page.request.get("/api/v1/staff/products?pageSize=100")
  ).json()) as Product[];
  // This suite is opt-in and requires a disposable seeded database with SHIPPING_SIMULATED=true.
  for (const product of products) {
    if (product.status !== "published") continue;
    product.packages = product.packages.map((p) => ({
      ...p,
      lengthMm: 80,
      widthMm: 80,
      heightMm: 100,
      shippingGrams:
        (p.unit === "kg" ? p.amount * 1000 : p.unit === "g" ? p.amount : 1400) +
        100,
      shippingVerified: true,
    }));
    await checked(
      page.request,
      `/staff/products/${product.id}`,
      "PUT",
      product,
      headers,
    );
    await checked(
      page.request,
      `/staff/products/${product.id}/publish`,
      "POST",
      undefined,
      headers,
    );
  }
  const product = products.find(
    (p) =>
      p.status === "published" &&
      p.packages[0]?.unit === "g" &&
      p.packages[0]?.amount === 100,
  )!;
  shippingProduct = product;
  await page.goto(`/staff?section=products&q=${product.id}&step=shipping`);
  await expect(
    page.getByRole("navigation", { name: "مراحل محصول" }).getByRole("button"),
  ).toHaveCount(5);
  await expect(
    page.getByRole("heading", { name: "بسته‌ها", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("طول (سانتی‌متر)", { exact: true })
    .first()
    .fill("۱۲٫۵");
  await page
    .getByLabel("طول (سانتی‌متر)", { exact: true })
    .first()
    .press("Tab");
  for (const width of [360, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    await page.screenshot({
      path: testInfo.outputPath(`packages-${width}.png`),
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: testInfo.outputPath("measurements-mobile.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "ذخیره پیش‌نویس", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("dialog").getByRole("button").last().click();
  await checked(
    page.request,
    `/staff/products/${shippingProduct.id}/publish`,
    "POST",
    undefined,
    headers,
  );
  let config = (await (
    await page.request.get("/api/v1/staff/shipping")
  ).json()) as ShippingConfig;
  config = {
    ...config,
    origin: address,
    localities: [
      {
        id: address.cityId!,
        provinceId: address.provinceId!,
        province: address.province,
        city: address.city,
        tapinProvince: "1",
        tapinCity: "1",
        verified: true,
      },
    ],
    boxes: [
      {
        id: "browser-box",
        name: "کارتن آزمایشی تأییدشده",
        inside: { lengthMm: 250, widthMm: 250, heightMm: 250 },
        outside: { lengthMm: 260, widthMm: 260, heightMm: 260 },
        emptyGrams: 100,
        fillerGrams: 20,
        insetMm: 5,
        maxGrams: 10000,
        postalSizeId: "1",
        active: true,
        verified: true,
      },
    ],
    snapp: {
      enabled: true,
      verified: true,
      service: "sim-bike",
      shopId: "",
      currency: "rial",
      cityId: address.cityId!,
      area: [
        [35, 51],
        [36, 51],
        [36, 52],
        [35, 52],
      ],
      maxGrams: 10000,
      maxVolumeCm3: 100000,
      maxParcels: 4,
      maxSize: { lengthMm: 500, widthMm: 500, heightMm: 500 },
    },
    tapin: {
      enabled: true,
      verified: true,
      service: "0",
      shopId: "sim-shop",
      currency: "rial",
      cityId: "",
      area: [],
      maxGrams: 10000,
      maxVolumeCm3: 0,
      maxParcels: 20,
      maxSize: { lengthMm: 1000, widthMm: 1000, heightMm: 1000 },
    },
  };
  await checked(page.request, "/staff/shipping", "PUT", config, headers);
  // File-owned settings are applied through the backend CLI against this disposable database.
  expect(
    process.env.DATABASE_URL,
    "Set DATABASE_URL to the isolated acceptance database",
  ).toBeTruthy();
  const directory = mkdtempSync(join(tmpdir(), "bomish-shipping-"));
  try {
    const file = join(directory, "shipping.json");
    writeFileSync(
      file,
      JSON.stringify({
        localities: config.localities,
        snapp: config.snapp,
        tapin: config.tapin,
        postalBoxSizes: Object.fromEntries(
          config.boxes.map((box) => [box.id, box.postalSizeId]),
        ),
      }),
    );
    execFileSync("go", ["run", "./cmd/server", "apply-shipping-config"], {
      cwd: "../backend",
      env: {
        ...process.env,
        APP_ENV: "development",
        SHIPPING_SIMULATED: "true",
        SHIPPING_CONFIG_FILE: file,
        SEED_DEMO: "false",
      },
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }

  await page.goto("/staff?section=shipping");
  // Navigation is owned by the dashboard; visit the explicit shipping section link.
  const shippingNav = page.getByRole("link", { name: "ارسال", exact: true });
  if (await shippingNav.count()) await shippingNav.click();
  await expect(
    page.getByRole("heading", { name: "مبدأ ارسال", exact: true }),
  ).toBeVisible();
  for (const width of [360, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    await page.screenshot({
      path: testInfo.outputPath(`settings-${width}.png`),
      fullPage: true,
    });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: testInfo.outputPath("settings-mobile.png"),
    fullPage: true,
  });
  const customer = await browser.newContext({
    baseURL: origin,
    viewport: { width: 390, height: 844 },
  });
  const customerPage = await customer.newPage();
  const s = await (await customer.request.get("/api/v1/session")).json();
  const customerHeaders = { Origin: origin, "X-CSRF-Token": s.csrf };
  const otp = await checked(
    customer.request,
    "/auth/request",
    "POST",
    { phone: address.phone },
    customerHeaders,
  );
  await checked(
    customer.request,
    "/auth/verify",
    "POST",
    { phone: address.phone, code: otp.devCode },
    customerHeaders,
  );
  await checked(
    customer.request,
    `/cart/items/${shippingProduct.id}`,
    "PUT",
    { packageId: product.packages[0].id, quantity: 2 },
    customerHeaders,
  );
  await checked(
    customer.request,
    "/addresses",
    "POST",
    address,
    customerHeaders,
  );
  await customerPage.goto("/checkout");
  await customerPage
    .getByLabel("نشانی‌های ذخیره‌شده")
    .selectOption({ index: 1 });
  await customerPage
    .getByRole("button", { name: "ارسال با پیک", exact: false })
    .click();
  await expect(
    customerPage.getByText("ارسال با پیک در تهران", { exact: true }),
  ).toBeVisible();
  await customerPage.screenshot({
    path: testInfo.outputPath("checkout-mobile.png"),
    fullPage: true,
  });
  await customerPage
    .getByRole("button", { name: "تأیید سفارش و پرداخت" })
    .click();
  await customerPage
    .getByRole("button", { name: "شبیه‌سازی پرداخت موفق" })
    .click();
  await customerPage.waitForURL("**/account/orders/*");
  const id = customerPage.url().split("/").pop()!;
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`/staff?section=orders&q=${id}`);
  const ordersNav = page.getByRole("link", { name: "سفارش‌ها", exact: true });
  if (await ordersNav.count()) await ordersNav.click();
  await page.getByPlaceholder("نام، همراه، شماره سفارش یا رهگیری").fill(id);
  await page
    .getByRole("button", { name: new RegExp(`جزئیات سفارش ${id.slice(0, 8)}`) })
    .click();
  await expect(
    page.getByRole("heading", { name: "ارسال تهران · ارسال سفارش" }),
  ).toBeVisible();
  // Courier readiness requires the per-line checklist, without carton confirmation.

  // Confirm order lines through the API, then verify courier readiness in the UI.
  const order = await (
    await page.request.get(`/api/v1/staff/orders/${id}`)
  ).json();
  for (const item of order.items)
    await checked(
      page.request,
      `/staff/orders/${id}/packing`,
      "PATCH",
      { productId: item.productId, packageId: item.packageId, packed: true },
      headers,
    );
  await page
    .getByRole("button", { name: "به‌روزرسانی وضعیت ارسال", exact: true })
    .click();
  await expect(page.getByText("کارتن انتخابی", { exact: true })).toHaveCount(0);
  await page
    .getByRole("button", { name: "تأیید آمادگی ارسال", exact: true })
    .click();
  await page.getByRole("radio", { name: /^اسنپ/ }).check();
  await page
    .getByRole("button", { name: "بررسی هزینه پیک", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "درخواست پیک اسنپ", exact: true }),
  ).toBeEnabled();
  await page.screenshot({
    path: testInfo.outputPath("dispatch-review-desktop.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "درخواست پیک اسنپ", exact: true })
    .click();
  await page
    .getByRole("button", { name: "به‌روزرسانی وضعیت ارسال", exact: true })
    .click();
  await expect(
    page.getByText("در انتظار پیک", { exact: true }).first(),
  ).toBeVisible();
  let delivery = (await checked(
    page.request,
    `/staff/orders/${id}/shipments/simulate`,
    "POST",
    { status: "picked_up" },
    headers,
  )) as DeliveryRecord;
  expect(delivery.status).toBe("picked_up");
  delivery = await checked(
    page.request,
    `/staff/orders/${id}/shipments/simulate`,
    "POST",
    { status: "delivered" },
    headers,
  );
  expect(delivery.status).toBe("delivered");
  await customerPage
    .getByRole("button", { name: "به‌روزرسانی وضعیت", exact: true })
    .click();
  await expect(
    customerPage.getByText("تحویل گیرنده شد", { exact: true }).first(),
  ).toBeVisible();
  await customerPage.screenshot({
    path: testInfo.outputPath("customer-delivered-mobile.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
  await customer.close();
});

test("Tehran staff courier: role, packing, assignment, history and delivery", async ({
  browser,
  page,
}, testInfo) => {
  test.setTimeout(150000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const headers = await loginStaffAPI(page.request, origin, "owner");
  if (!shippingProduct) {
    const products = (await (
      await page.request.get("/api/v1/staff/products?pageSize=100")
    ).json()) as Product[];
    shippingProduct = products.find(
      (p) =>
        p.status === "published" &&
        p.packages[0]?.unit === "g" &&
        p.packages[0]?.amount === 100,
    )!;
  }
  await page.goto("/omnisire/members/new");
  const form = page
    .locator("form")
    .filter({ has: page.getByLabel("نام و نام خانوادگی", { exact: true }) });
  await form
    .getByLabel("نام و نام خانوادگی", { exact: true })
    .fill("پیک تهران آزمایشی");
  await form
    .getByLabel("نام کاربری", { exact: true })
    .fill(`courier-${Date.now()}`);
  await form.getByLabel("شماره همراه", { exact: true }).fill("09123334455");
  await form
    .getByLabel("شماره کارت بانکی", { exact: true })
    .fill("5022291002696175");
  await form.getByLabel("گذرواژه اولیه").fill("courier-test-password");
  await form
    .getByRole("combobox", { name: "نقش", exact: true })
    .selectOption("courier");
  const createdPromise = page.waitForResponse(
    (r) =>
      r.url().endsWith("/omnisire/members") && r.request().method() === "POST",
  );
  await form.getByRole("button", { name: "ایجاد حساب همکار" }).click();
  const createdResponse = await createdPromise;
  expect(createdResponse.status()).toBe(201);
  const created = await createdResponse.json();
  await checked(
    page.request,
    "/omnisire/members",
    "POST",
    {
      fullName: "پیک غیرفعال آزمایشی",
      username: `courier-inactive-${Date.now()}`,
      phone: "09123334456",
      bankCard: "5022291002696175",
      role: "courier",
      active: false,
      password: "courier-test-password",
      restrictions: [],
    },
    headers,
  );

  const customer = await browser.newContext({ baseURL: origin });
  const customerPage = await customer.newPage();
  const session = await (await customer.request.get("/api/v1/session")).json();
  const ch = { Origin: origin, "X-CSRF-Token": session.csrf };
  const phone = "09125550129";
  const otp = await checked(
    customer.request,
    "/auth/request",
    "POST",
    { phone },
    ch,
  );
  await checked(
    customer.request,
    "/auth/verify",
    "POST",
    { phone, code: otp.devCode },
    ch,
  );
  await checked(
    customer.request,
    `/cart/items/${shippingProduct.id}`,
    "PUT",
    { packageId: shippingProduct.packages[0].id, quantity: 1 },
    ch,
  );
  const quote = await checked(
    customer.request,
    "/checkout/quote",
    "POST",
    { address: { ...address, phone } },
    ch,
  );
  expect(quote.method).toBe("snapp");
  const checkout = await checked(
    customer.request,
    "/checkout",
    "POST",
    {
      address: { ...address, phone },
      shippingQuoteId: quote.shippingQuoteId,
      method: "snapp",
      expectedTotalRials: quote.totalRials,
      idempotencyKey: crypto.randomUUID(),
    },
    ch,
  );
  const id = checkout.orderId;
  await checked(
    customer.request,
    `/orders/${id}/simulate`,
    "POST",
    { success: true },
    ch,
  );
  await page.goto(`/staff?section=orders&q=${id}`);
  await page
    .getByRole("button", { name: new RegExp(`جزئیات سفارش ${id.slice(0, 8)}`) })
    .click();
  await expect(page.getByRole("radio", { name: /^پیک بومیش/ })).toHaveCount(0);
  const itemChecks = page.locator(".staff-packing-item input[type=checkbox]");
  for (let i = 0; i < (await itemChecks.count()); i++)
    await itemChecks.nth(i).check();
  await expect(page.getByText("کارتن انتخابی", { exact: true })).toHaveCount(0);
  await page
    .getByRole("button", { name: "تأیید آمادگی ارسال", exact: true })
    .click();
  await page.route(
    "**/api/v1/staff/shipping/couriers",
    (route) =>
      route.fulfill({
        status: 503,
        json: { error: "خطای آزمایشی دریافت پیک‌ها" },
      }),
    { times: 1 },
  );
  await page.getByRole("radio", { name: /^پیک بومیش/ }).check();
  await expect(page.getByText("خطای آزمایشی دریافت پیک‌ها")).toBeVisible();
  await page.route(
    "**/api/v1/staff/shipping/couriers",
    (route) => route.fulfill({ json: [] }),
    { times: 1 },
  );
  await page.getByRole("button", { name: "تازه‌سازی فهرست پیک‌ها" }).click();
  await expect(page.getByText(/هنوز پیک فعالی ثبت نشده است/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "ثبت تحویل به پیک بومیش" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "تازه‌سازی فهرست پیک‌ها" }).click();
  const select = page.getByRole("combobox", { name: "همکار پیک", exact: true });
  await expect(select).toBeEnabled();
  await expect(select.locator(`option[value="${created.id}"]`)).toHaveCount(1);
  await expect(
    select.getByRole("option", { name: /پیک غیرفعال آزمایشی/ }),
  ).toHaveCount(0);
  await select.selectOption(created.id);
  const dispatch = page.getByRole("button", { name: "ثبت تحویل به پیک بومیش" });
  await expect(dispatch).toBeDisabled();
  await page
    .getByRole("checkbox", {
      name: "همه بسته‌ها را به پیک تهران آزمایشی تحویل داده‌ام.",
    })
    .check();
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await select.scrollIntoViewIfNeeded();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBeTruthy();
    await page.screenshot({
      path: testInfo.outputPath(`own-courier-${width}.png`),
      fullPage: true,
    });
  }
  await dispatch.click();
  await expect(
    page.getByRole("heading", { name: "پیک بومیش · پیک تهران آزمایشی" }),
  ).toBeVisible();
  await page.reload();
  await page
    .getByRole("button", { name: new RegExp(`جزئیات سفارش ${id.slice(0, 8)}`) })
    .click();
  await expect(
    page.getByRole("heading", { name: "پیک بومیش · پیک تهران آزمایشی" }),
  ).toBeVisible();
  const delivery = await (
    await page.request.get(`/api/v1/staff/orders/${id}/delivery`)
  ).json();
  expect(delivery).toMatchObject({
    assignedCourier: { id: created.id },
    status: "picked_up",
    method: "snapp",
    attemptId: "",
    actualCostRials: null,
  });
  await page
    .getByRole("button", { name: "تأیید تحویل به مشتری", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("button", { name: "تأیید", exact: true }),
  ).toBeDisabled();
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: "تأیید", exact: true }).click();
  await expect(
    page.getByText("تحویل سفارش به مشتری تأیید شده است."),
  ).toBeVisible();
  await customerPage.goto(`/account/orders/${id}`);
  await expect(customerPage.getByText(/پیک بومیش/)).toBeVisible();
  const result = await (
    await customer.request.get(`/api/v1/orders/${id}`)
  ).json();
  expect(result.order.totalRials).toBe(quote.totalRials);
  expect(result.order.status).toBe("received");
  expect(JSON.stringify(result)).not.toContain(created.id);
  expect(errors).toEqual([]);
  await customer.close();
});

test("customer selects post without a pin, postal tracking and zero cost stay distinct", async ({
  browser,
  page,
}, testInfo) => {
  test.setTimeout(150000);
  const headers = await loginStaffAPI(page.request, origin, "owner");
  const cfg = (await (
    await page.request.get("/api/v1/staff/shipping")
  ).json()) as ShippingConfig;
  // The derived usable space holds one 125 × 80 × 100 mm package.
  cfg.boxes = [
    {
      ...cfg.boxes[0],
      outside: { lengthMm: 157, widthMm: 112, heightMm: 132 },
    },
  ];
  await checked(page.request, "/staff/shipping", "PUT", cfg, headers);
  const context = await browser.newContext({
    baseURL: origin,
    viewport: { width: 390, height: 844 },
  });
  const cp = await context.newPage();
  const session = await (await context.request.get("/api/v1/session")).json();
  const ch = { Origin: origin, "X-CSRF-Token": session.csrf };
  const phone = "09125550124";
  const otp = await checked(
    context.request,
    "/auth/request",
    "POST",
    { phone },
    ch,
  );
  await checked(
    context.request,
    "/auth/verify",
    "POST",
    { phone, code: otp.devCode },
    ch,
  );
  const product = (await (
    await context.request.get(`/api/v1/products/${shippingProduct.slug}`)
  ).json()) as Product;
  await checked(
    context.request,
    `/cart/items/${shippingProduct.id}`,
    "PUT",
    { packageId: product.packages[0].id, quantity: 2 },
    ch,
  );
  await checked(
    context.request,
    "/addresses",
    "POST",
    { ...address, phone, pinConfirmed: false },
    ch,
  );
  await cp.goto("/checkout");
  await cp.getByLabel("نشانی‌های ذخیره‌شده").selectOption({ index: 1 });
  await expect(
    cp.getByRole("button", { name: "تأیید سفارش و پرداخت" }),
  ).toHaveCount(0);
  await cp.getByRole("button", { name: "ارسال با پیک", exact: false }).click();
  await expect(cp.locator(".checkout-page .error[role=alert]")).toContainText(
    "موقعیت تحویل",
  );
  await cp.getByRole("button", { name: "ارسال با پست", exact: false }).click();
  await expect(
    cp.getByRole("button", { name: "تأیید سفارش و پرداخت" }),
  ).toBeEnabled();
  await cp.screenshot({
    path: testInfo.outputPath("postal-choice-mobile.png"),
    fullPage: true,
  });
  await cp.getByRole("button", { name: "تأیید سفارش و پرداخت" }).click();
  await cp.getByRole("button", { name: "شبیه‌سازی پرداخت موفق" }).click();
  await cp.waitForURL("**/account/orders/*");
  const id = cp.url().split("/").pop()!;
  const order = await (
    await page.request.get(`/api/v1/staff/orders/${id}`)
  ).json();
  for (const item of order.items)
    await checked(
      page.request,
      `/staff/orders/${id}/packing`,
      "PATCH",
      { productId: item.productId, packageId: item.packageId, packed: true },
      headers,
    );
  let d = (await (
    await page.request.get(`/api/v1/staff/orders/${id}/delivery`)
  ).json()) as DeliveryRecord;
  expect(d.parcels).toHaveLength(2);
  d.parcels.forEach((p) => (p.confirmed = true));
  d = await checked(
    page.request,
    `/staff/orders/${id}/parcels`,
    "PUT",
    { version: d.version, parcels: d.parcels, reason: "بررسی واقعی" },
    headers,
  );
  d = await checked(
    page.request,
    `/staff/orders/${id}/ready`,
    "POST",
    { version: d.version },
    headers,
  );
  for (const [i, p] of d.parcels.entries())
    d = await checked(
      page.request,
      `/staff/orders/${id}/parcels/${p.id}`,
      "PATCH",
      {
        version: d.version,
        tracking: `1234567890${i}`,
        actualCostRials: i === 0 ? 0 : null,
      },
      headers,
    );
  expect(d.actualCostRials).toBeNull();
  await checked(
    page.request,
    `/staff/orders/${id}`,
    "PATCH",
    { status: "shipped", tracking: "" },
    headers,
  );
  await cp
    .getByRole("button", { name: "به‌روزرسانی وضعیت", exact: true })
    .click();
  await expect(
    cp.getByRole("link", { name: /پیگیری مرسوله پستی/ }),
  ).toHaveCount(2);
  await context.close();
});
