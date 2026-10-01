import { test, expect } from "@playwright/test";

// Behavioral coverage only; visual review is performed manually.
test("support keeps the draft through navigation and minimization, and clears it on logout", async ({
  page,
}) => {
  let authenticated = true;
  let messageReads = 0;
  await page.route("**/api/v1/**", (route) => {
    const path = new URL(route.request().url()).pathname.replace("/api/v1", "");
    if (path === "/session")
      return route.fulfill({
        json: {
          csrf: "test",
          authenticated,
          permissions: [],
          role: "",
          development: true,
        },
      });
    if (path === "/cart")
      return route.fulfill({ json: { items: [], subtotalRials: 0 } });
    if (path === "/logout") {
      authenticated = false;
      return route.fulfill({ json: {} });
    }
    if (path === "/requests")
      return route.fulfill({ json: [{ id: "persistent-chat" }] });
    if (path.endsWith("/messages")) {
      messageReads++;
      return route.fulfill({
        json: [
          {
            id: 1,
            body: "گفتگوی قبلی",
            fromStaff: true,
            createdAt: "2026-10-01T09:00:00Z",
          },
        ],
      });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto("/account");
  const launcher = page.getByRole("button", {
    name: "گفتگو با پشتیبانی",
    exact: true,
  });
  await launcher.click();
  const panel = page.getByRole("dialog", { name: "پشتیبانی بومیش" });
  await expect(panel).toHaveAttribute("aria-modal", "false");
  await expect(panel.getByRole("log")).toContainText("گفتگوی قبلی");
  await panel.getByLabel("پیام شما", { exact: true }).fill("پیش‌نویس من");
  // The underlying account navigation remains interactive with the chat open.
  await page
    .getByRole("navigation", { name: "حساب کاربری" })
    .getByRole("link", { name: "سفارش‌ها", exact: true })
    .click();
  await expect(page).toHaveURL(/section=orders/);
  await expect(panel.getByLabel("پیام شما", { exact: true })).toHaveValue(
    "پیش‌نویس من",
  );
  await panel.getByRole("button", { name: "بستن گفتگو" }).click();
  await expect(launcher).toBeFocused();
  await page.clock.install();
  const before = messageReads;
  await page.clock.fastForward(15000);
  expect(messageReads).toBe(before);
  await launcher.click();
  await expect(panel.getByLabel("پیام شما", { exact: true })).toHaveValue(
    "پیش‌نویس من",
  );
  await expect.poll(() => messageReads).toBeGreaterThan(before);
  await page.getByRole("button", { name: "خروج از حساب", exact: true }).click();
  await expect(
    panel.getByText("برای حفظ گفتگو و دریافت پاسخ، وارد حساب شوید."),
  ).toBeVisible();
  await expect(
    panel.getByRole("textbox", { name: "پیام شما", exact: true }),
  ).toHaveCount(0);
  await expect(panel.getByText("گفتگوی قبلی")).toHaveCount(0);
});

test("the welcome does not create a request and first-message retries reuse their key", async ({
  page,
}) => {
  const keys: string[] = [];
  let created = false;
  await page.route("**/api/v1/**", (route) => {
    const path = new URL(route.request().url()).pathname.replace("/api/v1", "");
    if (path === "/session")
      return route.fulfill({
        json: {
          csrf: "test",
          authenticated: true,
          permissions: [],
          role: "",
          development: true,
        },
      });
    if (path === "/cart")
      return route.fulfill({ json: { items: [], subtotalRials: 0 } });
    if (path === "/requests" && route.request().method() === "POST") {
      keys.push(route.request().postDataJSON().idempotencyKey);
      created = true;
      return keys.length === 1
        ? route.abort()
        : route.fulfill({ status: 201, json: { id: "new-chat" } });
    }
    if (path === "/requests") return route.fulfill({ json: [] });
    if (path.endsWith("/messages"))
      return route.fulfill({
        json: [
          {
            id: 1,
            body: "سؤال من",
            fromStaff: false,
            createdAt: "2026-10-01T09:00:00Z",
          },
        ],
      });
    return route.fulfill({ json: [] });
  });
  await page.goto("/account");
  await page
    .getByRole("button", { name: "گفتگو با پشتیبانی", exact: true })
    .click();
  const panel = page.getByRole("dialog", { name: "پشتیبانی بومیش" });
  await expect(panel.getByText("پیام خوشامدگویی خودکار")).toBeVisible();
  expect(created).toBe(false);
  await panel.getByLabel("پیام شما", { exact: true }).fill("سؤال من");
  await panel.getByRole("button", { name: "شروع گفتگو", exact: true }).click();
  await expect(panel.getByRole("alert")).toBeVisible();
  await expect(panel.getByLabel("پیام شما", { exact: true })).toHaveValue(
    "سؤال من",
  );
  await panel.getByRole("button", { name: "شروع گفتگو", exact: true }).click();
  await expect(
    panel.getByRole("log").getByText("سؤال من", { exact: true }),
  ).toHaveCount(1);
  expect(keys).toHaveLength(2);
  expect(keys[1]).toBe(keys[0]);
});

test("staff retains drafts when switching conversations", async ({ page }) => {
  await page.route("**/api/v1/**", (route) => {
    const path = new URL(route.request().url()).pathname.replace("/api/v1", "");
    if (path === "/session")
      return route.fulfill({
        json: {
          csrf: "test",
          authenticated: false,
          role: "operator",
          staffId: "operator",
          permissions: ["requests"],
        },
      });
    if (path === "/staff/notifications")
      return route.fulfill({ json: { support: 2, custom: 0, orders: 0 } });
    if (path === "/staff/requests")
      return route.fulfill({
        json: {
          items: [1, 2].map((n) => ({
            id: `chat-${n}`,
            phone: `0912000000${n}`,
            description: "سؤال مشتری",
            latestMessage: "آخرین پیام مشتری",
            updatedAt: "2026-10-01T09:00:00Z",
          })),
          total: 2,
          page: 1,
          pageSize: 20,
        },
      });
    if (path.endsWith("/messages")) return route.fulfill({ json: [] });
    return route.fulfill({ json: {} });
  });
  await page.goto("/staff?section=support");
  await expect(
    page.getByRole("button", { name: /گفتگو با مشتری/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: /09120000001/ }).click();
  await page.getByLabel("پیام شما", { exact: true }).fill("پاسخ در حال نوشتن");
  await page.getByRole("button", { name: /09120000002/ }).click();
  await expect(page.getByLabel("پیام شما", { exact: true })).toHaveValue("");
  await page.getByRole("button", { name: /09120000001/ }).click();
  await expect(page.getByLabel("پیام شما", { exact: true })).toHaveValue(
    "پاسخ در حال نوشتن",
  );
});

test("custom order conflicts preserve drafts and allow a reviewed retry", async ({
  page,
}) => {
  let request = {
    id: "custom-review",
    kind: "custom",
    phone: "09120000001",
    description: "ترکیب ادویه اختصاصی",
    quantity: "۳ کیلوگرم",
    budgetRials: 10000000,
    status: "new",
    response: "",
    version: 1,
    createdAt: "2026-10-01T09:00:00Z",
    updatedAt: "2026-10-01T09:00:00Z",
  };
  let firstSave = true;
  const versions: number[] = [];
  await page.route("**/api/v1/**", (route) => {
    const path = new URL(route.request().url()).pathname.replace("/api/v1", "");
    if (path === "/session")
      return route.fulfill({
        json: {
          csrf: "test",
          authenticated: false,
          role: "operator",
          staffId: "operator",
          permissions: ["requests"],
        },
      });
    if (path === "/staff/notifications")
      return route.fulfill({ json: { support: 0, custom: 1, orders: 0 } });
    if (path === "/staff/requests")
      return route.fulfill({
        json: { items: [request], total: 1, page: 1, pageSize: 20 },
      });
    if (path === "/staff/requests/custom-review") {
      if (route.request().method() === "PATCH") {
        const body = route.request().postDataJSON();
        versions.push(body.version);
        if (firstSave) {
          firstSave = false;
          request = {
            ...request,
            version: 2,
            response: "پاسخ همکار",
            status: "follow_up",
          };
          return route.fulfill({
            status: 409,
            json: { error: "درخواست تغییر کرده؛ دوباره بررسی کنید" },
          });
        }
        request = {
          ...request,
          status: body.status,
          response: body.response,
          version: 3,
        };
        return route.fulfill({ json: { ok: true } });
      }
      return route.fulfill({ json: request });
    }
    return route.fulfill({ json: {} });
  });
  await page.goto("/staff?section=custom");
  await page.getByRole("button", { name: /09120000001/ }).click();
  const response = page.getByLabel("پاسخ قابل مشاهده برای مشتری", {
    exact: true,
  });
  await response.fill("پاسخ در حال بررسی من");
  await page
    .getByRole("button", { name: "به‌روزرسانی درخواست‌ها", exact: true })
    .click();
  await expect(response).toHaveValue("پاسخ در حال بررسی من");
  await page.getByRole("button", { name: "ثبت نتیجه", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("درخواست تغییر کرده");
  await page
    .getByRole("button", { name: "دریافت آخرین نسخه", exact: true })
    .click();
  await expect(response).toHaveValue("پاسخ در حال بررسی من");
  await expect(page.getByText("پاسخ همکار", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "ثبت نتیجه", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("نتیجه ثبت شد");
  await expect(response).toBeVisible();
  expect(versions).toEqual([1, 2]);
});
