import { test, expect } from "@playwright/test";

for (const kind of ["support", "custom"] as const) {
  test(`${kind} workspace fills the viewport with independent pane scrolling`, async ({
    page,
  }) => {
    const now = new Date().toISOString();
    const requests = Array.from({ length: 20 }, (_, i) => ({
      id: `request-${i}`,
      kind,
      phone: `091200000${String(i).padStart(2, "0")}`,
      description:
        kind === "custom"
          ? "جزئیات سفارش اختصاصی مشتری. ".repeat(60)
          : "سلام، درباره سفارش سؤال دارم.",
      latestMessage: "پیام مشتری",
      status: "new",
      response: "",
      quantity: "۱۰ کیلوگرم",
      budgetRials: 10000000,
      version: 1,
      createdAt: now,
      updatedAt: now,
      unread: false,
    }));
    const messages = Array.from({ length: 60 }, (_, i) => ({
      id: i + 1,
      body: `پیام شماره ${i + 1}: لطفاً سفارش را بررسی کنید.`,
      fromStaff: i % 2 === 0,
      createdAt: now,
    }));
    await page.route("**/api/v1/**", (route) => {
      const url = new URL(route.request().url());
      const path = url.pathname.replace("/api/v1", "");
      let data: unknown = { ok: true };
      if (path === "/session")
        data = {
          csrf: "test",
          role: "owner",
          staffId: "owner",
          permissions: ["requests", "products"],
        };
      else if (path === "/cart") data = { items: [], subtotalRials: 0 };
      else if (path === "/staff/notifications")
        data = { support: 0, custom: 0, orders: 0 };
      else if (path === "/staff/requests")
        data = { items: requests, total: 20, page: 1, pageSize: 20 };
      else if (path.endsWith("/messages"))
        data = url.searchParams.has("after") ? [] : messages;
      else if (path === "/categories") data = [];
      return route.fulfill({ json: data });
    });
    await page.goto(`/staff?section=${kind}`);
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 1100, height: 600 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      const list = page.locator(".request-list");
      if (viewport.width === 1440)
        await page.locator(".request-list-item").first().click();
      if (viewport.width <= 800) {
        await page
          .getByRole("button", { name: "بازگشت به درخواست‌ها", exact: true })
          .click();
      }
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollHeight <= innerHeight + 1,
          ),
        )
        .toBe(true);
      if (viewport.width <= 800) {
        await expect(list).toBeVisible();
        await page.locator(".request-list-item").first().click();
      } else {
        expect(
          await list.evaluate((el) => el.scrollHeight > el.clientHeight),
        ).toBe(true);
        await list.evaluate((el) => {
          el.scrollTop = 180;
        });
        expect(await list.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
      }
      const pane = page.locator(
        kind === "support" ? ".chat-messages" : ".custom-review",
      );
      await expect(pane).toBeVisible();
      await expect
        .poll(() => pane.evaluate((el) => el.scrollHeight > el.clientHeight))
        .toBe(true);
      await pane.evaluate((el) => {
        el.scrollTop = 100;
      });
      expect(await pane.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
      expect(await page.evaluate(() => window.scrollY)).toBe(0);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      const bounds = await page.locator(".requests-workbench").boundingBox();
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);
      expect(bounds!.y + bounds!.height).toBeGreaterThan(viewport.height - 25);
      if (kind === "support") {
        const composer = await page.locator(".chat-composer").boundingBox();
        expect(composer!.y + composer!.height).toBeLessThanOrEqual(
          viewport.height,
        );
      } else {
        await pane.evaluate((el) => {
          el.scrollTop = el.scrollHeight;
        });
        await expect(
          page.getByRole("button", { name: "ثبت نتیجه", exact: true }),
        ).toBeInViewport();
      }
      await page.screenshot({
        path: `test-results/${kind}-workspace-${viewport.width}.png`,
      });
    }
  });
}
