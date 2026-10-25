import { test, expect, type Page } from "@playwright/test";
import { loginStaff } from "./staff-login";
import type { components } from "@/lib/api-types";
type Snapshot = components["schemas"]["ServerMonitoring"];
function snapshot(): Snapshot {
  const now = Date.now();
  return {
    status: "healthy",
    checkedAt: new Date(now).toISOString(),
    startedAt: new Date(now - 3 * 86400000).toISOString(),
    uptimeSeconds: 259920,
    environment: "production",
    catalogOnly: true,
    database: {
      status: "healthy",
      latencyMs: 2.4,
      activeConnections: 3,
      idleConnections: 5,
      maxConnections: 20,
    },
    runtime: {
      version: "go1.27.3",
      os: "linux",
      arch: "amd64",
      cpuCount: 4,
      goroutines: 32,
      heapBytes: 85 * 1024 ** 2,
      reservedBytes: 120 * 1024 ** 2,
    },
    disk: { totalBytes: 80 * 1024 ** 3, availableBytes: 52 * 1024 ** 3 },
    traffic: Array.from({ length: 30 }, (_, i) => ({
      at: new Date(now - (29 - i) * 60000).toISOString(),
      requests: 20 + ((i * 17) % 75),
      errors: 0,
      averageMs: 24.6,
    })),
  };
}
async function mock(page: Page, role = "owner") {
  const state = { data: snapshot(), fail: false, calls: 0 };
  await page.route("**/api/v1/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/omnisire/monitoring")) {
      state.calls++;
      return route.fulfill(
        state.fail
          ? { status: 503, json: { error: "Unavailable" } }
          : { json: state.data },
      );
    }
    if (path.endsWith("/session"))
      return route.fulfill({
        json: {
          csrf: "test",
          role,
          staffId: "monitor-test",
          omnisireVerified: true,
          permissions: [],
          fullName: "مدیر بومیش",
        },
      });
    if (path.endsWith("/cart"))
      return route.fulfill({ json: { items: [], subtotalRials: 0 } });
    return route.fulfill({ json: {} });
  });
  return state;
}

test("monitoring renders live metrics, navigation, accessible details and mobile layout", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await mock(page);
  await page.goto("/omnisire/monitoring");
  await expect(
    page.getByRole("heading", { name: "پایش سرور", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "سرویس‌های بررسی‌شده در دسترس‌اند" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "پایش سرور", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("img", { name: /درخواست و/ })).toBeVisible();
  await page.screenshot({
    path: "test-results/monitoring-desktop.png",
    fullPage: true,
  });
  await page.getByText("جزئیات دقیقه‌ای", { exact: true }).click();
  await expect(page.locator(".monitor-details tbody tr")).toHaveCount(30);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("heading", { name: "پایش سرور", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByText("جزئیات دقیقه‌ای", { exact: true }).click();
  await page.screenshot({
    path: "test-results/monitoring-mobile.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("refresh failures retain metrics with unknown health and recover", async ({
  page,
}) => {
  const state = await mock(page);
  await page.goto("/omnisire/monitoring");
  await expect(page.getByText("۸۵ مگابایت", { exact: true })).toBeVisible();
  state.fail = true;
  await page.getByRole("button", { name: "به‌روزرسانی", exact: true }).click();
  await expect(page.locator(".monitor-error[role=alert]")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "وضعیت فعلی نامشخص است" }),
  ).toBeVisible();
  await expect(page.getByText("۸۵ مگابایت", { exact: true })).toBeVisible();
  await expect(page.locator(".monitor-service .status-healthy")).toHaveCount(0);
  state.fail = false;
  await page.getByRole("button", { name: "به‌روزرسانی", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "سرویس‌های بررسی‌شده در دسترس‌اند" }),
  ).toBeVisible();
});

test("initial failure, unavailable disk and empty traffic are explicit", async ({
  page,
}) => {
  const state = await mock(page);
  state.fail = true;
  await page.goto("/omnisire/monitoring");
  await expect(page.locator(".monitor-error[role=alert]")).toBeVisible();
  await expect(page.locator(".monitor-metrics")).toHaveCount(0);
  state.fail = false;
  state.data.disk = null;
  state.data.traffic = [];
  await page.getByRole("button", { name: "به‌روزرسانی", exact: true }).click();
  await expect(
    page.getByText("در این بازه درخواستی ثبت نشده است."),
  ).toBeVisible();
  await expect(
    page.getByText("اندازه‌گیری این فضای ذخیره‌سازی در دسترس نیست"),
  ).toBeVisible();
});

test("degraded services and low disk have visible warnings", async ({
  page,
}) => {
  const state = await mock(page);
  state.data.status = "attention";
  state.data.database.status = "unavailable";
  state.data.disk!.availableBytes = 1024 ** 3;
  state.data.traffic[0].errors = 10;
  await page.goto("/omnisire/monitoring");
  await expect(
    page.getByRole("heading", { name: "نیاز به بررسی" }),
  ).toBeVisible();
  await expect(page.getByText("قطع ارتباط", { exact: true })).toBeVisible();
  await expect(page.getByText("فضای کم", { exact: true })).toBeVisible();
  await expect(page.locator(".metric-warning")).toBeVisible();
});

test("auto refresh can pause, expires old health, and resumes", async ({
  page,
}) => {
  const state = await mock(page);
  await page.clock.install();
  await page.goto("/omnisire/monitoring");
  await expect(page.locator(".monitor-metrics")).toBeVisible();
  await page.clock.fastForward(16000);
  await expect.poll(() => state.calls).toBeGreaterThan(1);
  await page.getByRole("checkbox", { name: "خودکار", exact: true }).uncheck();
  await expect(
    page.getByRole("button", { name: "به‌روزرسانی", exact: true }),
  ).toBeEnabled();
  const pausedCalls = state.calls;
  await page.clock.fastForward(60000);
  expect(state.calls).toBe(pausedCalls);
  await expect(
    page.getByRole("heading", { name: "وضعیت فعلی نامشخص است" }),
  ).toBeVisible();
  await page.getByRole("checkbox", { name: "خودکار", exact: true }).check();
  await expect.poll(() => state.calls).toBeGreaterThan(pausedCalls);
  await expect(
    page.getByRole("heading", { name: "سرویس‌های بررسی‌شده در دسترس‌اند" }),
  ).toBeVisible();
});

test("staff cannot render or fetch monitoring", async ({ page }) => {
  const state = await mock(page, "manager");
  await page.goto("/omnisire/monitoring");
  await expect(
    page.getByRole("heading", { name: "دسترسی محدود" }),
  ).toBeVisible();
  expect(state.calls).toBe(0);
});

test("verified owner sees real server measurements", async ({ page }) => {
  test.skip(
    process.env.MONITORING_LIVE !== "true",
    "Requires disposable seeded local API",
  );
  await page.goto("/staff");
  await loginStaff(page, "owner");
  await page.goto("/omnisire/monitoring");
  await expect(
    page.getByRole("heading", { name: "سرویس‌های بررسی‌شده در دسترس‌اند" }),
  ).toBeVisible();
  const response = await page.request.get("/api/v1/omnisire/monitoring");
  expect(response.ok()).toBe(true);
  expect(response.headers()["cache-control"]).toBe("no-store");
  const data: Snapshot = await response.json();
  expect(data.database.status).toBe("healthy");
  expect(data.runtime.heapBytes).toBeGreaterThan(0);
  expect(data.traffic.length).toBeGreaterThan(0);
});
