import { test, expect, type APIRequestContext } from "@playwright/test";
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
    await page.request.get("/api/v1/staff/products")
  ).json()) as Product[];
  // This suite is opt-in and requires a disposable seeded database with SHIPPING_SIMULATED=true.
  for (const product of products) {
    if (product.status === "archived") continue;
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
  const product = products.find((p) => p.id === "turmeric")!;
  await page.goto("/staff?section=products&q=turmeric&step=shipping");
  await expect(
    page.getByRole("navigation", { name: "مراحل محصول" }).getByRole("button"),
  ).toHaveCount(6);
  await expect(
    page.getByRole("heading", { name: "بسته‌بندی و ارسال", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("طول (سانتی‌متر)", { exact: true })
    .first()
    .fill("۱۲٫۵");
  await page
    .getByLabel("طول (سانتی‌متر)", { exact: true })
    .first()
    .press("Tab");
  await page
    .getByRole("checkbox", {
      name: "اندازه‌ها و وزن واقعی این بسته را تأیید می‌کنم",
    })
    .first()
    .check();
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
    "/staff/products/turmeric/publish",
    "POST",
    undefined,
    headers,
  );
  let config = (await (
    await page.request.get("/api/v1/staff/shipping")
  ).json()) as ShippingConfig;
  config = {
    ...config,
    mode: "calculated",
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
  await page.goto("/staff?section=shipping");
  // Navigation is owned by the dashboard; visit the explicit shipping section link.
  const shippingNav = page.getByRole("link", { name: "ارسال", exact: true });
  if (await shippingNav.count()) await shippingNav.click();
  await expect(
    page.getByRole("heading", { name: "مبدأ ارسال", exact: true }),
  ).toBeVisible();
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
    "/cart/items/turmeric",
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
  await expect(
    customerPage.getByText("پیک اسنپ · 1 کارتن ارسال"),
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
    page.getByRole("heading", { name: "پیک اسنپ · ارسال سفارش" }),
  ).toBeVisible();
  // Existing per-line checklist plus physical parcel confirmation are both mandatory.

  // Use the documented checklist endpoint if its existing label differs; parcel readiness stays in UI.
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
  await page
    .getByRole("checkbox", {
      name: "محتویات، وزن و بسته‌بندی واقعی این کارتن را تأیید می‌کنم",
    })
    .check();
  await page
    .getByLabel("دلیل اصلاح / نتیجه بررسی واقعی")
    .fill("بسته‌بندی آزمایشی و وزن بررسی شد");
  await page.getByRole("button", { name: "ذخیره بسته‌بندی واقعی" }).click();
  await expect(page.getByText("تغییر ثبت شد.", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "تأیید آمادگی ارسال", exact: true })
    .click();
  await page
    .getByRole("button", { name: "بررسی هزینه پیک", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "درخواست پیک", exact: true }),
  ).toBeEnabled();
  await page.screenshot({
    path: testInfo.outputPath("dispatch-review-desktop.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "درخواست پیک", exact: true }).click();
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

test("missing pin explicitly accepts post, postal tracking and zero cost stay distinct", async ({
  browser,
  page,
}, testInfo) => {
  test.setTimeout(150000);
  const headers = await loginStaffAPI(page.request, origin, "owner");
  const cfg = (await (
    await page.request.get("/api/v1/staff/shipping")
  ).json()) as ShippingConfig;
  expect(cfg.mode).toBe("calculated");
  cfg.boxes[0].maxGrams = 350;
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
    await context.request.get("/api/v1/products/turmeric")
  ).json()) as Product;
  await checked(
    context.request,
    "/cart/items/turmeric",
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
    cp.getByRole("button", { name: "ارسال با پست را می‌پذیرم" }),
  ).toBeVisible();
  await expect(
    cp.getByRole("button", { name: "تأیید سفارش و پرداخت" }),
  ).toBeDisabled();
  await cp.screenshot({
    path: testInfo.outputPath("postal-fallback-mobile.png"),
    fullPage: true,
  });
  await cp.getByRole("button", { name: "ارسال با پست را می‌پذیرم" }).click();
  await expect(
    cp.getByRole("button", { name: "تأیید سفارش و پرداخت" }),
  ).toBeEnabled();
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
