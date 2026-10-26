import { test, expect, type Page } from "@playwright/test";
import type { components } from "@/lib/api-types";
import { loginStaff } from "./staff-login";
type Event = components["schemas"]["AuditEvent"];
const actions = [
  ["auth.failed", "access"],
  ["product.publish", "catalog"],
  ["order.shipped", "orders"],
  ["payment.recorded", "finance"],
  ["staff.update", "access"],
  ["export.ready", "other"],
] as const;
async function mock(page: Page, role = "owner") {
  const state = {
    fail: false,
    calls: 0,
    queries: [] as URLSearchParams[],
    items: Array.from({ length: 72 }, (_, i): Event => {
      const [action, category] = actions[i % actions.length];
      return {
        id: 1000 - i,
        action,
        category,
        reviewSignal: action === "auth.failed",
        entityId: `record-${String(i + 1).padStart(3, "0")}`,
        createdAt: new Date(Date.now() - i * 24 * 60000).toISOString(),
        actorName:
          i % 6 === 0
            ? "سیستم"
            : ["Sara Ahmadi", "علی رضایی", "Nima Karimi"][i % 3],
        staffId: i % 6 === 0 ? "" : `member-${i % 3}`,
        detail: {
          requestId: `req-${i}`,
          ...(action === "staff.update"
            ? {
                before: { role: "operator" },
                after: { role: "editor" },
                reason: "Updated catalog responsibilities",
              }
            : action === "auth.failed"
              ? {}
              : { status: "recorded" }),
        },
      };
    }),
  };
  await page.route("**/api/v1/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/omnisire/events")) {
      state.calls++;
      state.queries.push(url.searchParams);
      if (state.fail)
        return route.fulfill({ status: 503, json: { error: "Unavailable" } });
      const q = url.searchParams;
      let items = state.items.filter(
        (e) =>
          (!q.get("category") || e.category === q.get("category")) &&
          (!q.get("action") || e.action === q.get("action")) &&
          (!q.get("actor") || e.staffId === q.get("actor")) &&
          (!q.get("entity") || e.entityId === q.get("entity")) &&
          (q.get("review") !== "true" || e.reviewSignal) &&
          (!q.get("q") ||
            `${e.action} ${e.entityId} ${e.actorName}`
              .toLowerCase()
              .includes(q.get("q")!.toLowerCase()) ||
            e.detail.requestId === q.get("q")) &&
          (!q.get("from") ||
            Date.parse(e.createdAt) >=
              Date.parse(`${q.get("from")}T00:00:00+03:30`)) &&
          (!q.get("to") ||
            Date.parse(e.createdAt) <
              Date.parse(`${q.get("to")}T00:00:00+03:30`) + 86400000),
      );
      if (q.get("sort") === "oldest") items = items.toReversed();
      const size = Number(q.get("pageSize") || 25),
        p = Math.min(
          Number(q.get("page") || 1),
          Math.max(1, Math.ceil(items.length / size)),
        );
      return route.fulfill({
        json: {
          items: items.slice((p - 1) * size, p * size),
          total: items.length,
          page: p,
          pageSize: size,
          summary: {
            actors: new Set(
              items.filter((e) => e.staffId).map((e) => e.staffId),
            ).size,
            unattributed: items.filter((e) => !e.staffId).length,
            review: items.filter((e) => e.reviewSignal).length,
          },
        },
      });
    }
    if (url.pathname.endsWith("/session"))
      return route.fulfill({
        json: {
          csrf: "test",
          role,
          staffId: "events-owner",
          omnisireVerified: true,
          permissions: [],
          fullName: "مدیر بومیش",
        },
      });
    if (url.pathname.endsWith("/cart"))
      return route.fulfill({ json: { items: [], subtotalRials: 0 } });
    return route.fulfill({ json: {} });
  });
  return state;
}

test("audit log has full-result counts, English content, Persian navigation and responsive layouts", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await mock(page);
  await page.goto("/omnisire/events");
  await expect(
    page.getByRole("heading", { name: "Activity log", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "رویدادها", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(page.locator(".omni-main")).toHaveAttribute("dir", "ltr");
  await expect(page.locator(".audit-stat").first()).toContainText("72");
  await expect(page.locator(".audit-event-row")).toHaveCount(25);
  await page.screenshot({
    path: "test-results/events-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/events-mobile.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("filters and pagination apply to the complete event collection", async ({
  page,
}) => {
  const state = await mock(page);
  await page.goto("/omnisire/events");
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  await expect(page.getByText("Page 2 of 3", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Catalog", exact: true }).click();
  await expect(page.locator(".audit-event-row")).toHaveCount(12);
  await expect(page.getByText("Page 1 of 1", { exact: true })).toBeVisible();
  expect(state.queries.at(-1)?.get("category")).toBe("catalog");
  await page.getByRole("button", { name: "All events", exact: true }).click();
  await page.getByRole("checkbox", { name: "Review signals only" }).check();
  await expect(page.locator(".audit-event-row")).toHaveCount(12);
  await expect(page.locator(".audit-event-row").first()).toContainText(
    "Staff sign-in failed",
  );
  await page.getByRole("checkbox", { name: "Review signals only" }).uncheck();
  await page.getByRole("searchbox", { name: "Search activity" }).fill("req-4");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page.locator(".audit-event-row")).toHaveCount(1);
  await expect(page.locator(".audit-event-row")).toContainText(
    "Team member updated",
  );
  await page.getByRole("button", { name: "Clear filters" }).click();
  await page
    .getByRole("combobox", { name: "Sort events" })
    .selectOption("oldest");
  await expect(page.locator(".audit-event-row").first()).toContainText(
    "record-072",
  );
  await page
    .getByRole("combobox", { name: "Events per page" })
    .selectOption("50");
  await expect(page.locator(".audit-event-row")).toHaveCount(50);
});

test("detail drawer supports keyboard navigation, readable payloads and safe related links", async ({
  page,
}) => {
  await mock(page);
  await page.goto("/omnisire/events");
  const row = page.getByRole("button", {
    name: "View event 996: Team member updated",
    exact: true,
  });
  await row.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Close event details" }),
  ).toBeFocused();
  await expect(
    dialog.getByText("Updated catalog responsibilities", { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("link", { name: "Open team member" }),
  ).toHaveAttribute("href", "/omnisire/members/record-005");
  await dialog.getByText("Raw event JSON", { exact: true }).click();
  await expect(dialog.locator(".audit-raw pre")).toContainText("req-4");
  await dialog.evaluate((element) => {
    element.scrollTop = 0;
  });
  await page.screenshot({
    path: "test-results/events-details.png",
    fullPage: false,
  });
  await dialog.getByRole("button", { name: "Next", exact: true }).click();
  await expect(
    dialog.getByRole("heading", { name: "Export ready", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(row).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".audit-event-row").first().click();
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(
    true,
  );
  await expect(
    dialog.getByText("System / external", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/events-details-mobile.png",
    fullPage: false,
  });
});

test("date validation, exact filters, empty results and failure recovery", async ({
  page,
}) => {
  const state = await mock(page);
  await page.goto("/omnisire/events");
  await page.getByRole("button", { name: /More filters/ }).click();
  await page.getByLabel("Exact entity ID").fill("record-004");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page.locator(".audit-event-row")).toHaveCount(1);
  await page.getByLabel("From date", { exact: true }).fill("2026-11-01");
  await page.getByLabel("To date", { exact: true }).fill("2026-10-01");
  await expect(page.locator(".audit-log [role=alert]")).toContainText(
    "Start date",
  );
  await expect(
    page.getByRole("button", { name: "Apply filters" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await page.getByRole("searchbox").fill("no-such-event");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(
    page.getByRole("heading", { name: "No matching events" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Show all events" }).click();
  await expect(page.locator(".audit-event-row")).toHaveCount(25);
  state.fail = true;
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.locator(".audit-log [role=alert]")).toContainText(
    "Could not load activity",
  );
  await expect(page.locator(".audit-event-row")).toHaveCount(25);
  state.fail = false;
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.locator(".audit-log [role=alert]")).toHaveCount(0);
});

test("unauthorized staff cannot render or fetch the audit log", async ({
  page,
}) => {
  const state = await mock(page, "manager");
  await page.goto("/omnisire/events");
  await expect(
    page.getByRole("heading", { name: "دسترسی محدود" }),
  ).toBeVisible();
  expect(state.calls).toBe(0);
});

test("verified owner can inspect real audit records", async ({ page }) => {
  test.skip(
    process.env.EVENTS_LIVE !== "true",
    "Requires disposable seeded local API",
  );
  await page.goto("/staff");
  await loginStaff(page, "owner");
  await page.goto("/omnisire/events");
  await expect(page.locator(".audit-event-row").first()).toBeVisible();
  await page
    .getByRole("button", { name: "Access & security", exact: true })
    .click();
  await expect(page.locator(".audit-event-row").first()).toBeVisible();
  await page.locator(".audit-event-row").first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  const result = await page.request.get(
    "/api/v1/omnisire/events?category=access",
  );
  expect(result.ok()).toBe(true);
  const body = await result.json();
  expect(body.summary.actors).toBeGreaterThan(0);
  expect(body.items.every((e: Event) => e.category === "access")).toBe(true);
  await page.keyboard.press("Escape");
  const session = await (
    await page.request.get("/api/v1/session?workspace=staff")
  ).json();
  await page.goto(`/omnisire/members/${session.staffId}`);
  await page.getByRole("button", { name: "فعالیت‌ها", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "تاریخچه رویدادها", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".omni-event").first()).toBeVisible();
});
