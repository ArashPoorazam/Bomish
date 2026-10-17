import { test, expect } from "@playwright/test";

for (const staff of [false, true]) {
  test(`${staff ? "staff" : "customer"} sends pictures and uses Enter / Shift+Enter`, async ({
    page,
    context,
  }) => {
    const previewErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error" && message.text().includes("empty string"))
        previewErrors.push(message.text());
    });
    const sent: string[] = [];
    await context.route("**/api/v1/**", async (route) => {
      const req = route.request();
      const path = new URL(req.url()).pathname.replace("/api/v1", "");
      if (path === "/session")
        return route.fulfill({
          json: {
            csrf: "test",
            authenticated: true,
            role: staff ? "owner" : "",
            staffId: staff ? "owner" : "",
            permissions: ["requests"],
          },
        });
      if (path === "/cart")
        return route.fulfill({ json: { items: [], subtotalRials: 0 } });
      if (path === "/staff/notifications")
        return route.fulfill({ json: { support: 0, custom: 0, orders: 0 } });
      if (path.endsWith("/messages") && req.method() === "POST") {
        sent.push(req.postData() || "");
        return route.fulfill({ json: { id: sent.length } });
      }
      if (path.endsWith("/messages")) return route.fulfill({ json: [] });
      if (path.endsWith("/requests")) {
        const items = [
          {
            id: "chat-customer",
            phone: "09120000000",
            description: "سلام",
            kind: "support",
            updatedAt: new Date().toISOString(),
          },
        ];
        return route.fulfill({ json: staff ? { items, total: 1 } : items });
      }
      if (path.endsWith("/orders"))
        return route.fulfill({
          json: {
            items: [
              {
                id: "customer-order-complete",
                status: "received",
                createdAt: "2026-10-01T10:00:00Z",
                tracking: "",
                address: {
                  recipient: "مریم احمدی",
                  phone: "09120000000",
                  city: "تهران",
                  province: "تهران",
                  street: "خیابان بهار",
                  postalCode: "1234567890",
                },
                items: [
                  {
                    productId: "spice",
                    packageId: "small",
                    name: "زردچوبه",
                    quantity: 1,
                    grams: 100,
                    priceRials: 100000,
                    totalRials: 100000,
                    packed: true,
                  },
                ],
                subtotalRials: 100000,
                shippingRials: 0,
                discountRials: 0,
                totalRials: 100000,
                events: [],
              },
            ],
            total: 1,
          },
        });
      return route.fulfill({ json: [] });
    });
    await page.goto(staff ? "/staff?section=support" : "/account");
    if (staff) await page.locator(".request-list-item").click();
    else
      await page
        .getByRole("button", { name: "گفتگو با پشتیبانی", exact: true })
        .click();
    const input = page.getByRole("textbox", { name: "پیام شما", exact: true });
    await input.fill("first");
    await input.press("Shift+Enter");
    await input.pressSequentially("second");
    await expect(input).toHaveValue("first\nsecond");
    expect(sent).toHaveLength(0);
    await input.press("Enter");
    await expect.poll(() => sent.length).toBe(1);
    expect(JSON.parse(sent[0]).body).toBe("first\nsecond");
    await expect(input).toHaveValue("");
    await page.getByLabel("افزودن تصویر", { exact: true }).setInputFiles({
      name: "photo.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX2kAAAAASUVORK5CYII=",
        "base64",
      ),
    });
    await expect(page.getByAltText("پیش‌نمایش تصویر")).toBeVisible();
    await expect(page.getByAltText("پیش‌نمایش تصویر")).toHaveAttribute(
      "src",
      /^blob:/,
    );
    expect(previewErrors).toEqual([]);
    await page.getByRole("button", { name: "ارسال پیام", exact: true }).click();
    await expect.poll(() => sent.length).toBe(2);
    expect(sent[1]).toContain('filename="photo.png"');
    await expect(page.getByAltText("پیش‌نمایش تصویر")).toHaveCount(0);
    if (staff) {
      const pageCount = context.pages().length;
      await page
        .getByRole("link", { name: "مشاهده همه سفارش‌های مشتری" })
        .click();
      const orders = page;
      expect(context.pages()).toHaveLength(pageCount);
      await expect(orders).toHaveURL(/staff\/customer-orders\/chat-customer/);
      await expect(
        orders.getByRole("heading", { name: "سفارش‌های مشتری" }),
      ).toBeVisible();
      await orders.locator(".staff-order-row").click();
      await expect(orders.locator(".staff-order-detail")).toBeVisible();
      await expect(orders.getByText("زردچوبه", { exact: true })).toBeVisible();
      await expect(orders.getByRole("checkbox")).toBeDisabled();
      await orders.getByRole("button", { name: "بازگشت به سفارش‌ها" }).click();
      await expect(orders.locator(".staff-order-row")).toBeFocused();
    }
  });
}
