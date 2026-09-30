import { test, expect, type Page } from "@playwright/test";

async function customer(page: Page) {
  await page.route("**/api/v1/session", (r) =>
    r.fulfill({
      json: {
        csrf: "test",
        authenticated: true,
        permissions: [],
        development: true,
      },
    }),
  );
  await page.route("**/api/v1/cart", (r) =>
    r.fulfill({ json: { items: [], subtotalRials: 0 } }),
  );
}

test("order polling survives address failures, coalesces refreshes and recovers expiry", async ({
  page,
}) => {
  await customer(page);
  let addresses = 0,
    calls = 0,
    failure = false,
    expired = false;
  let release: (() => void) | undefined;
  await page.route("**/api/v1/addresses", (r) => {
    addresses++;
    return r.fulfill({
      status: 503,
      json: { error: "نشانی موقتاً در دسترس نیست" },
    });
  });
  await page.route("**/api/v1/orders", async (r) => {
    calls++;
    if (calls === 2)
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    return r.fulfill({
      status: expired ? 401 : failure ? 503 : 200,
      json: expired || failure ? { error: "خطای موقت سفارش" } : [],
    });
  });
  await page.goto("/account?section=orders");
  await expect(page.getByText("سفارشی در این بخش نیست")).toBeVisible();
  await expect(page.getByText("نشانی موقتاً در دسترس نیست")).toBeVisible();
  const refresh = page.getByRole("button", {
    name: "به‌روزرسانی وضعیت",
    exact: true,
  });
  await refresh.click();
  await expect.poll(() => calls).toBe(2);
  await page.evaluate(() => {
    for (let i = 0; i < 5; i++)
      document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(
    page.getByRole("button", { name: "در حال به‌روزرسانی…", exact: true }),
  ).toBeDisabled();
  expect(calls).toBe(2);
  release!();
  await expect(refresh).toBeEnabled();
  expect(addresses).toBe(1);
  failure = true;
  await refresh.click();
  await expect(page.getByText("خطای موقت سفارش")).toBeVisible();
  await expect(page.getByText("سفارشی در این بخش نیست")).toBeVisible();
  failure = false;
  await refresh.click();
  await expect(page.getByText("خطای موقت سفارش")).toBeHidden();
  expired = true;
  await page.unroute("**/api/v1/session");
  await page.route("**/api/v1/session", (r) =>
    r.fulfill({
      json: {
        csrf: "new",
        authenticated: false,
        permissions: [],
        development: true,
      },
    }),
  );
  await refresh.click();
  await expect(
    page.getByRole("heading", { name: "به بومیش خوش آمدید" }),
  ).toBeVisible();
});

test("chat bounds history, preserves scroll and retries a lost send without duplicates", async ({
  page,
}) => {
  await customer(page);
  await page.route("**/api/v1/requests?kind=support", (r) =>
    r.fulfill({ json: [{ id: "chat-hardening" }] }),
  );
  const messages = Array.from({ length: 250 }, (_, i) => ({
    id: i + 1,
    body: `history ${i + 1}`,
    fromStaff: false,
    createdAt: "2026-09-30T12:00:00Z",
  }));
  const reads: string[] = [],
    keys: string[] = [];
  let lost = true;
  await page.route("**/api/v1/requests/chat-hardening/messages*", async (r) => {
    if (r.request().method() === "POST") {
      const body = r.request().postDataJSON();
      keys.push(body.idempotencyKey);
      if (lost) {
        lost = false;
        messages.push({
          id: 251,
          body: body.body,
          fromStaff: false,
          createdAt: "2026-09-30T12:00:00Z",
        });
        return r.abort();
      }
      return r.fulfill({ status: 201, json: { id: 251 } });
    }
    const q = new URL(r.request().url()).searchParams;
    reads.push(q.toString());
    const batch = q.has("latest")
      ? messages.slice(-100)
      : q.has("before")
        ? messages.filter((m) => m.id < Number(q.get("before"))).slice(-100)
        : messages.filter((m) => m.id > Number(q.get("after"))).slice(0, 100);
    return r.fulfill({ json: batch });
  });
  await page.goto("/products");
  await page
    .getByRole("button", { name: "گفتگو با پشتیبانی", exact: true })
    .click();
  await expect(page.locator(".chat-message")).toHaveCount(100);
  // Development Strict Mode can start and cancel the first effect once.
  expect(reads.length).toBeLessThanOrEqual(2);
  expect(reads.every((q) => q === "latest=true")).toBe(true);
  const log = page.getByRole("log");
  await log.evaluate((el) => {
    el.scrollTop = 0;
    el.dispatchEvent(new Event("scroll"));
  });
  const anchor = page.locator(".chat-message").first();
  const top = (await anchor.boundingBox())!.y;
  await page.getByRole("button", { name: "پیام‌های قدیمی‌تر" }).click();
  await expect(page.locator(".chat-message")).toHaveCount(200);
  expect(
    Math.abs(
      (await page
        .locator(".chat-message")
        .filter({ hasText: "history 151" })
        .boundingBox())!.y - top,
    ),
  ).toBeLessThan(3);
  await page
    .getByRole("textbox", { name: "پیام شما", exact: true })
    .fill("retry draft");
  await page.getByRole("button", { name: "ارسال پیام", exact: true }).click();
  await expect(page.locator(".support-chat").getByRole("alert")).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "پیام شما", exact: true }),
  ).toHaveValue("retry draft");
  await page.getByRole("button", { name: "ارسال پیام", exact: true }).click();
  await expect(log.getByText("retry draft", { exact: true })).toHaveCount(1);
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
  await page.clock.install();
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  const hiddenCount = reads.length;
  await page.clock.fastForward(15000);
  expect(reads).toHaveLength(hiddenCount);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(() => reads.length).toBeGreaterThan(hiddenCount);
  await page.getByRole("button", { name: "بستن گفتگو", exact: true }).click();
  const count = reads.length;
  await page.clock.fastForward(15000);
  expect(reads).toHaveLength(count);
  await expect(
    page.getByRole("button", { name: "گفتگو با پشتیبانی", exact: true }),
  ).toBeFocused();
});

test("suggestion retries preserve edits and event sound ignores unchanged polling and audio failures", async ({
  page,
}) => {
  let savedFailure = true,
    searchFailure = false,
    marker = 1;
  await page.addInitScript(() => {
    const state = { sounds: 0, blocked: false };
    Object.assign(window, { audioTest: state });
    class FakeAudio {
      state = "running";
      currentTime = 0;
      destination = {};
      async resume() {}
      async close() {}
      createOscillator() {
        if (state.blocked) throw Error("blocked");
        return {
          connect() {},
          frequency: { value: 0 },
          start() {
            state.sounds++;
          },
          stop() {},
        };
      }
      createGain() {
        return {
          connect() {},
          gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} },
        };
      }
    }
    Object.assign(window, { AudioContext: FakeAudio });
  });
  await page.route("**/api/v1/**", (r) => {
    const url = new URL(r.request().url());
    const path = url.pathname.replace("/api/v1", "");
    if (path === "/session")
      return r.fulfill({
        json: {
          csrf: "test",
          role: "owner",
          staffId: "owner",
          permissions: ["products", "orders", "requests"],
          authenticated: false,
        },
      });
    if (path === "/staff/notifications")
      return r.fulfill({
        json: {
          support: 1,
          custom: 0,
          orders: 0,
          supportEvent: marker,
          customEvent: 0,
          orderEvent: 0,
        },
      });
    if (path === "/staff/suggestions")
      return savedFailure
        ? r.fulfill({
            status: 503,
            json: { error: "پیشنهادها موقتاً در دسترس نیست" },
          })
        : r.fulfill({
            json: [
              { id: "saved", name: "پیشنهاد ذخیره‌شده", status: "published" },
            ],
          });
    if (path === "/products")
      return searchFailure
        ? r.fulfill({
            status: 503,
            json: { error: "جستجو موقتاً در دسترس نیست" },
          })
        : r.fulfill({
            json: [{ id: "extra", name: "محصول تازه", status: "published" }],
          });
    if (path === "/staff/products")
      return r.fulfill({
        json: { items: [], total: 0, page: 1, pageSize: 25 },
      });
    return r.fulfill({ json: [] });
  });
  await page.goto("/staff");
  await page
    .getByRole("button", { name: "پیشنهادهای بومیش", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "ذخیره پیشنهادها", exact: true }),
  ).toBeDisabled();
  savedFailure = false;
  await page
    .getByRole("button", { name: "تلاش دوباره برای پیشنهادها", exact: true })
    .click();
  await expect(page.locator(".suggestion-list")).toContainText(
    "پیشنهاد ذخیره‌شده",
  );
  await page.locator(".suggestion-results button").click();
  searchFailure = true;
  await page.getByLabel("جستجوی محصول", { exact: true }).fill("جستجو");
  await expect(
    page.getByRole("button", { name: "تلاش دوباره برای جستجو", exact: true }),
  ).toBeVisible();
  searchFailure = false;
  await page
    .getByRole("button", { name: "تلاش دوباره برای جستجو", exact: true })
    .click();
  await expect(page.locator(".suggestion-list li")).toHaveCount(2);
  const soundCount = () =>
    page.evaluate(
      () =>
        (window as unknown as { audioTest: { sounds: number } }).audioTest
          .sounds,
    );
  expect(await soundCount()).toBe(0);
  await page
    .getByRole("button", { name: "فعال‌کردن صدای اعلان", exact: true })
    .click();
  expect(await soundCount()).toBe(0);
  marker++;
  await page.evaluate(() =>
    window.dispatchEvent(new Event("bomish:notifications")),
  );
  await expect.poll(soundCount).toBe(1);
  await page.evaluate(() =>
    window.dispatchEvent(new Event("bomish:notifications")),
  );
  await expect(
    page.getByRole("button", { name: "صدای اعلان روشن است" }),
  ).toBeVisible();
  expect(await soundCount()).toBe(1);
  await page.evaluate(() => {
    (
      window as unknown as { audioTest: { blocked: boolean } }
    ).audioTest.blocked = true;
  });
  marker++;
  await page.evaluate(() =>
    window.dispatchEvent(new Event("bomish:notifications")),
  );
  await expect(
    page.getByRole("button", { name: "صدای اعلان روشن است" }),
  ).toBeVisible();
  await expect(page.locator(".suggestion-list li")).toHaveCount(2);
});

test("switching staff conversations ignores an older delayed response", async ({
  page,
}) => {
  let release: (() => void) | undefined;
  await page.route("**/api/v1/**", async (r) => {
    const path = new URL(r.request().url()).pathname.replace("/api/v1", "");
    if (path === "/session")
      return r.fulfill({
        json: {
          csrf: "test",
          role: "operator",
          staffId: "operator",
          permissions: ["requests"],
        },
      });
    if (path === "/staff/notifications")
      return r.fulfill({
        json: {
          support: 2,
          custom: 0,
          orders: 0,
          supportEvent: 2,
          customEvent: 0,
          orderEvent: 0,
        },
      });
    if (path === "/staff/requests")
      return r.fulfill({
        json: {
          items: [
            {
              id: "first",
              phone: "09120000001",
              description: "first conversation",
              updatedAt: "2026-09-30T12:00:00Z",
            },
            {
              id: "second",
              phone: "09120000002",
              description: "second conversation",
              updatedAt: "2026-09-30T12:00:00Z",
            },
          ],
          total: 2,
          page: 1,
          pageSize: 20,
        },
      });
    if (path.endsWith("/messages")) {
      const first = path.includes("/first/");
      if (first)
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      await r
        .fulfill({
          json: [
            {
              id: first ? 1 : 2,
              body: first ? "obsolete message" : "current message",
              fromStaff: false,
              createdAt: "2026-09-30T12:00:00Z",
            },
          ],
        })
        .catch(() => {});
      return;
    }
    return r.fulfill({ json: {} });
  });
  await page.goto("/staff");
  await page.getByRole("button", { name: /گفتگو با پشتیبانی/ }).click();
  await page.getByRole("button", { name: /09120000001/ }).click();
  await expect.poll(() => !!release).toBe(true);
  await page
    .getByRole("button", { name: "بازگشت به درخواست‌ها", exact: true })
    .click();
  await page.getByRole("button", { name: /09120000002/ }).click();
  await expect(page.getByRole("log")).toContainText("current message");
  release!();
  await expect(page.getByRole("log")).not.toContainText("obsolete message");
});
