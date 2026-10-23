import { test, expect } from "@playwright/test";

test("Tehran delivery selection ignores an old courier quote after switching to post", async ({
  page,
}, testInfo) => {
  const address = {
    id: "saved-address",
    recipient: "گیرنده سفارش",
    phone: "09129999999",
    province: "تهران",
    city: "تهران",
    provinceId: "tehran-province",
    cityId: "tehran-city",
    street: "خیابان آزمایشی، پلاک ۱۰",
    postalCode: "1234567890",
    latitude: 35.7,
    longitude: 51.4,
    pinConfirmed: true,
  };
  let releaseCourier: () => void = () => {};
  let courierRequested: () => void = () => {};
  const courierStarted = new Promise<void>((resolve) => {
    courierRequested = resolve;
  });
  const courierReleased = new Promise<void>((resolve) => {
    releaseCourier = resolve;
  });
  let checkout: Record<string, unknown> | undefined;
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace("/api/v1", "");
    if (path === "/checkout/quote") {
      const { method } = route.request().postDataJSON();
      if (method === "snapp") {
        courierRequested();
        await courierReleased;
      }
      return route.fulfill({
        json: {
          shippingQuoteId: `${method}-quote`,
          method,
          service: "test",
          parcelCount: method === "post" ? 2 : 0,
          expiresAt: new Date(Date.now() + 300_000).toISOString(),
          requiresAcceptance: false,
          simulated: true,
          discountCode: "",
          discountRials: 0,
          subtotalRials: 1000000,
          shippingRials: method === "post" ? 300000 : 550000,
          totalRials: method === "post" ? 1300000 : 1550000,
          weightGrams: 600,
        },
      });
    }
    if (path === "/checkout") {
      checkout = route.request().postDataJSON();
      return route.fulfill({ json: { orderId: "confirmed-post-order" } });
    }
    const values: Record<string, unknown> = {
      "/session": {
        csrf: "test",
        authenticated: true,
        development: true,
        catalogOnly: false,
        phone: "09121110001",
      },
      "/cart": {
        items: [
          {
            product: { id: "spice", name: "زردچوبه", images: [] },
            package: { id: "small", amount: 100, unit: "g" },
            quantity: 2,
            totalRials: 1000000,
          },
        ],
        subtotalRials: 1000000,
      },
      "/addresses": [address],
      "/shipping/localities": [
        {
          id: address.cityId,
          provinceId: address.provinceId,
          province: address.province,
          city: address.city,
        },
      ],
    };
    return route.fulfill({ json: values[path] ?? [] });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/checkout");
  await page.getByLabel("نشانی‌های ذخیره‌شده").selectOption(address.id);
  const courier = page.getByRole("button", { name: /ارسال با پیک/ });
  const post = page.getByRole("button", { name: /ارسال با پست/ });
  const submit = page.getByRole("button", { name: "تأیید سفارش و پرداخت" });
  await expect(courier).toHaveAttribute("aria-pressed", "false");
  await expect(post).toHaveAttribute("aria-pressed", "false");
  await expect(submit).toHaveCount(0);
  await courier.click();
  await courierStarted;
  await post.click();
  await expect(submit).toBeEnabled();
  const lateResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/checkout/quote") &&
      response.request().postDataJSON().method === "snapp",
  );
  releaseCourier();
  await lateResponse;
  await expect(post).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText(/۲ کارتن ارسال/)).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("delivery-choice-mobile.png"),
    fullPage: true,
  });
  await submit.click();
  expect(checkout).toMatchObject({
    method: "post",
    shippingQuoteId: "post-quote",
    expectedTotalRials: 1300000,
  });
});
