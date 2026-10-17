import { test, expect } from "@playwright/test";

test("map fills province and city even before postal mappings are configured", async ({
  page,
}) => {
  await page.route("https://*.tile.openstreetmap.org/**", (route) =>
    route.abort(),
  );
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace("/api/v1", "");
    if (path === "/session")
      return route.fulfill({
        json: { authenticated: true, csrf: "test", phone: "09120000000" },
      });
    if (path === "/cart")
      return route.fulfill({ json: { items: [], subtotalRials: 0 } });
    if (path === "/addresses/reverse")
      return route.fulfill({
        json: {
          province: "فارس",
          city: "شیراز",
          street: "شیراز، خیابان زند",
          latitude: 35.6892,
          longitude: 51.389,
        },
      });
    return route.fulfill({ json: [] });
  });
  await page.goto("/account?section=addresses");
  await page.getByRole("button", { name: "نشانی جدید", exact: true }).click();
  await expect(page.locator(".leaflet-control-zoom")).toBeVisible();
  await page.locator(".map-canvas").click({ position: { x: 160, y: 160 } });
  await expect(
    page.getByRole("button", { name: "انتخاب مرکز نقشه" }),
  ).toHaveCount(0);
  await expect(
    page.getByText("ورود دقیق مختصات نقشه", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByLabel("این موقعیت دقیق نشانی است", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("برای پیک، موقعیت دقیق روی نقشه لازم است.", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("موقعیت انتخاب شد؛ نشانی را بررسی کنید.", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("combobox", { name: "استان", exact: true }),
  ).toHaveValue("فارس");
  await expect(
    page.getByRole("combobox", { name: "شهر", exact: true }),
  ).toHaveValue("شیراز");
  await expect(
    page.getByLabel("نشانی کامل، پلاک و واحد", { exact: true }),
  ).toHaveValue("شیراز، خیابان زند");
  await page.getByRole("combobox", { name: "شهر", exact: true }).fill("مرودشت");
  await expect(
    page.getByRole("combobox", { name: "شهر", exact: true }),
  ).toHaveValue("مرودشت");
  await expect(page.getByText("شهر تأییدشده", { exact: true })).toHaveCount(0);
});
