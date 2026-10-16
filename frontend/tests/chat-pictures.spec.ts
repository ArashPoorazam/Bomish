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
        return route.fulfill({ json: { items: [], total: 0 } });
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
      const popup = page.waitForEvent("popup");
      await page
        .getByRole("link", { name: "مشاهده همه سفارش‌های مشتری" })
        .click();
      const orders = await popup;
      await expect(orders).toHaveURL(/staff\/customer-orders\/chat-customer/);
      await expect(
        orders.getByRole("heading", { name: "همه سفارش‌های مشتری" }),
      ).toBeVisible();
      await expect(
        orders.getByText("این مشتری هنوز سفارشی ثبت نکرده است."),
      ).toBeVisible();
    }
  });
}
