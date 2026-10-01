import { test, expect, type APIRequestContext } from "@playwright/test";
import { loginStaff } from "./staff-login";

test("customer session, five stages, refresh, support and custom requests work across staff tabs", async ({
  page,
  context,
  baseURL,
}) => {
  test.setTimeout(90000);
  page.setDefaultTimeout(10000);
  const request: APIRequestContext = context.request;
  const customer = await (await request.get("/api/v1/session")).json();
  const customerHeaders = { Origin: baseURL!, "X-CSRF-Token": customer.csrf };
  const phone = "0912" + String(Date.now()).slice(-7);
  const challenge = await (
    await request.post("/api/v1/auth/request", {
      headers: customerHeaders,
      data: { phone },
    })
  ).json();
  expect(challenge.devCode).toBeTruthy();
  expect(
    (
      await request.post("/api/v1/auth/verify", {
        headers: customerHeaders,
        data: { phone, code: challenge.devCode },
      })
    ).ok(),
  ).toBeTruthy();
  const product = await (await request.get("/api/v1/products/turmeric")).json();
  expect(
    (
      await request.put("/api/v1/cart/items/turmeric", {
        headers: customerHeaders,
        data: { packageId: product.packages[0].id, quantity: 1 },
      })
    ).ok(),
  ).toBeTruthy();
  const quote = await (
    await request.post("/api/v1/checkout/quote", {
      headers: customerHeaders,
      data: { province: "تهران" },
    })
  ).json();
  const order = await (
    await request.post("/api/v1/checkout", {
      headers: customerHeaders,
      data: {
        address: {
          recipient: "آزمایش درخواست",
          phone,
          province: "تهران",
          city: "تهران",
          street: "خیابان آزمایشی پلاک ۱۲",
          postalCode: "1234567890",
        },
        expectedTotalRials: quote.totalRials,
        idempotencyKey: crypto.randomUUID(),
      },
    })
  ).json();
  expect(order.orderId).toBeTruthy();
  expect(
    (
      await request.post(`/api/v1/orders/${order.orderId}/simulate`, {
        headers: customerHeaders,
        data: { success: true },
      })
    ).ok(),
  ).toBeTruthy();
  await page.goto(`/account/orders/${order.orderId}`);
  await expect(page.locator(".order-timeline li")).toHaveCount(5);
  await expect(
    page.getByRole("button", { name: "به‌روزرسانی وضعیت", exact: true }),
  ).toBeVisible();

  const staff = await context.newPage();
  staff.setDefaultTimeout(10000);
  await staff.goto("/staff");
  await loginStaff(staff, "owner");
  // Both identities must remain authenticated in one cookie jar.
  expect(
    (await (await request.get("/api/v1/session")).json()).authenticated,
  ).toBe(true);
  const staffSession = await (
    await request.get("/api/v1/session?workspace=staff")
  ).json();
  const staffHeaders = { Origin: baseURL!, "X-CSRF-Token": staffSession.csrf };
  await expect(
    staff.getByRole("button", { name: "مدیریت فروشگاه", exact: true }),
  ).toHaveAttribute("aria-expanded", "true");
  await staff
    .getByRole("button", { name: "مدیریت فروشگاه", exact: true })
    .click();
  await expect(
    staff.getByRole("button", { name: "محصولات", exact: true }),
  ).toBeHidden();
  await staff
    .getByRole("button", { name: "مدیریت فروشگاه", exact: true })
    .click();

  expect(
    (
      await request.patch(`/api/v1/staff/orders/${order.orderId}`, {
        headers: staffHeaders,
        data: { status: "packing", tracking: "" },
      })
    ).ok(),
  ).toBeTruthy();
  await page
    .getByRole("button", { name: "به‌روزرسانی وضعیت", exact: true })
    .click();
  await expect(
    page.locator('.order-timeline [aria-current="step"]'),
  ).toContainText("بسته‌بندی");
  expect(
    (
      await request.patch(`/api/v1/staff/orders/${order.orderId}`, {
        headers: staffHeaders,
        data: { status: "shipped", tracking: "123456789012345678901234" },
      })
    ).ok(),
  ).toBeTruthy();
  await expect(
    page.locator('.order-timeline [aria-current="step"]'),
  ).toContainText("ارسال", { timeout: 18000 });
  await expect(page.getByText("برای ادامه وارد حساب شوید")).toHaveCount(0);
  const orderEndpoint = `**/api/v1/orders/${order.orderId}`;
  await page.route(orderEndpoint, (route) =>
    route.fulfill({
      status: 503,
      json: { error: "دریافت وضعیت موقتاً انجام نشد" },
    }),
  );
  await page
    .getByRole("button", { name: "به‌روزرسانی وضعیت", exact: true })
    .click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "دریافت وضعیت موقتاً انجام نشد" }),
  ).toBeVisible();
  await expect(
    page.locator('.order-timeline [aria-current="step"]'),
  ).toContainText("ارسال");
  await page.unroute(orderEndpoint);
  await page
    .getByRole("button", { name: "به‌روزرسانی وضعیت", exact: true })
    .click();
  await expect(page.getByText("دریافت وضعیت موقتاً انجام نشد")).toHaveCount(0);

  await page
    .getByRole("button", { name: "گفتگو با پشتیبانی", exact: true })
    .click();
  await page
    .getByLabel("پیام شما", { exact: true })
    .fill("زمان ارسال سفارش من چقدر است؟");
  await page.getByRole("button", { name: "شروع گفتگو", exact: true }).click();
  await expect(page.getByRole("log")).toContainText(
    "زمان ارسال سفارش من چقدر است؟",
  );
  await staff.getByRole("button", { name: /گفتگو با مشتری/ }).click();
  await staff.getByRole("button", { name: new RegExp(phone) }).click();
  await staff
    .getByLabel("پیام شما", { exact: true })
    .fill("سفارش شما فردا ارسال می‌شود.");
  await staff.getByRole("button", { name: "ارسال پیام", exact: true }).click();
  await expect(page.getByRole("log")).toContainText(
    "سفارش شما فردا ارسال می‌شود.",
    { timeout: 12000 },
  );
  await page.getByRole("button", { name: "بستن گفتگو", exact: true }).click();
  await page.goto("/account?section=custom");
  await page
    .getByRole("link", { name: "سفارش اختصاصی جدید", exact: true })
    .first()
    .click();
  await page
    .getByLabel("شرح محصول", { exact: true })
    .fill("ترکیب ادویه اختصاصی بدون نمک");
  await page.getByLabel("مقدار و واحد", { exact: true }).fill("۳ کیلوگرم");
  await page
    .getByLabel("بودجه کل پیشنهادی (تومان)", { exact: true })
    .fill("1000000");
  await page.getByRole("button", { name: "ثبت درخواست", exact: true }).click();
  await expect(page.locator(".request-card")).toContainText("در انتظار بررسی");
  await staff.getByRole("button", { name: /سفارش‌های اختصاصی/ }).click();
  await staff.getByRole("button", { name: new RegExp(phone) }).click();
  await staff
    .getByLabel("نتیجه بررسی", { exact: true })
    .selectOption("follow_up");
  await staff
    .getByLabel("پاسخ قابل مشاهده برای مشتری", { exact: true })
    .fill("برای ترکیب نهایی با شما تماس می‌گیریم.");
  await staff.getByRole("button", { name: "ثبت نتیجه", exact: true }).click();
  await page
    .getByRole("button", { name: "به‌روزرسانی درخواست‌ها", exact: true })
    .click();
  await expect(page.locator(".request-card")).toContainText("در حال پیگیری");
  await expect(page.locator(".request-card")).toContainText(
    "برای ترکیب نهایی با شما تماس می‌گیریم.",
  );
  await request.put("/api/v1/staff/suggestions", {
    headers: staffHeaders,
    data: { productIds: [] },
  });
  await staff.getByRole("button", { name: "مدیریت خانه", exact: true }).click();
  await staff.getByLabel("جستجوی محصول", { exact: true }).fill("زردچوبه");
  const add = staff
    .locator(".suggestion-results button")
    .filter({ hasText: "زردچوبه" });
  await add.first().click();
  await staff
    .getByRole("button", { name: "ذخیره پیشنهادها", exact: true })
    .click();
  await expect(staff.getByRole("status")).toContainText(
    "پیشنهادها ذخیره شدند.",
  );
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "پرفروش ترین‌های بومیش", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "پیشنهادهای بومیش", exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/account/orders/${order.orderId}`);
  await expect(page.locator(".order-timeline li")).toHaveCount(5);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "/tmp/bomish-customer-mobile.png",
    fullPage: true,
  });
  await staff.screenshot({
    path: "/tmp/bomish-staff-requests.png",
    fullPage: true,
  });
});
