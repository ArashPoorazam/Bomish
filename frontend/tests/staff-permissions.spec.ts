import { test, expect } from "@playwright/test";
import { loginStaff } from "./staff-login";

test("staff overrides survive role changes, enforce read-only access, and reset", async ({
  page,
  browser,
}) => {
  await page.goto("/staff");
  await loginStaff(page, "owner");
  await page.goto("/omnisire/members");
  await page.getByRole("link", { name: "همکار جدید", exact: true }).click();
  await expect(page).toHaveURL(/\/omnisire\/members\/new$/);
  await expect(
    page.getByRole("link", { name: "بازگشت به همکاران" }),
  ).toHaveAttribute("href", "/omnisire/members");
  const form = page
    .locator("form")
    .filter({ has: page.getByLabel("نام و نام خانوادگی", { exact: true }) });
  await expect(form.locator(".permission-section")).toHaveCount(10);
  for (const label of [
    "نمای کلی",
    "همکاران و حساب‌ها",
    "تحلیل داده‌ها",
    "رویدادها",
  ])
    await expect(
      form
        .locator(".permission-section")
        .filter({ has: page.getByText(label, { exact: true }) }),
    ).toHaveCount(0);
  const username = `permissions-${Date.now()}`;
  await form
    .getByLabel("نام و نام خانوادگی", { exact: true })
    .fill("آزمایش دسترسی اختصاصی");
  await form.getByLabel("نام کاربری", { exact: true }).fill(username);
  await form.getByLabel("شماره همراه", { exact: true }).fill("09123456789");
  await form
    .getByLabel("شماره کارت بانکی", { exact: true })
    .fill("5022291002696175");
  await form.getByLabel("گذرواژه اولیه").fill("test-permissions-123");
  const section = (label: string) =>
    form
      .locator(".permission-section")
      .filter({ has: page.getByText(label, { exact: true }) });
  await section("محصولات")
    .getByRole("checkbox", { name: "مشاهده بخش" })
    .check();
  const edit = section("محصولات").getByRole("checkbox", {
    name: "ویرایش / انجام عملیات",
  });
  await edit.check();
  await edit.uncheck();
  await section("فروش من")
    .getByRole("checkbox", { name: "مشاهده بخش" })
    .uncheck();
  await form
    .getByRole("combobox", { name: "نقش", exact: true })
    .selectOption("editor");
  await expect(edit).not.toBeChecked();
  await expect(
    section("فروش من").getByRole("checkbox", { name: "مشاهده بخش" }),
  ).not.toBeChecked();
  await section("محصولات")
    .getByRole("checkbox", { name: "ایجاد", exact: true })
    .uncheck();
  await section("محصولات")
    .getByRole("checkbox", { name: "حذف / بایگانی" })
    .uncheck();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/staff-permissions-mobile.png",
    fullPage: true,
  });
  const response = page.waitForResponse(
    (r) =>
      r.url().endsWith("/omnisire/members") && r.request().method() === "POST",
  );
  await form.getByRole("button", { name: "ایجاد حساب همکار" }).click();
  const createdResponse = await response;
  expect(createdResponse.status()).toBe(201);
  const created = await createdResponse.json();
  const detail = await (
    await page.request.get(`/api/v1/omnisire/members/${created.id}`)
  ).json();
  expect(detail.permissionOverrides).toMatchObject({
    products: true,
    "products.edit": false,
    sales: false,
  });

  const staffContext = await browser.newContext();
  const staff = await staffContext.newPage();
  const origin = new URL(page.url()).origin;
  await staff.goto(origin + "/staff");
  await staff.getByLabel("نام کاربری", { exact: true }).fill(username);
  await staff
    .getByLabel("گذرواژه", { exact: true })
    .fill("test-permissions-123");
  await staff.getByRole("button", { name: "ورود به فضای کار" }).click();
  await expect(
    staff.getByRole("heading", { name: "محصولات", exact: true }),
  ).toBeVisible();
  await expect(
    staff.getByRole("button", { name: "افزودن محصول", exact: true }),
  ).toHaveCount(0);
  await expect(
    staff.getByRole("link", { name: "فروش من", exact: true }),
  ).toHaveCount(0);
  await staff
    .locator("table")
    .getByRole("button", { name: "ویرایش", exact: true })
    .first()
    .click();
  await expect(
    staff.getByRole("button", { name: "ذخیره پیش‌نویس", exact: true }),
  ).toBeDisabled();
  await staff.goto(origin + "/staff/account");
  await expect(
    staff.getByRole("heading", { name: "اطلاعات حساب", exact: true }),
  ).toBeVisible();
  await expect(staff.locator(".staff-account-details")).toContainText(username);
  await expect(
    staff.getByRole("button", { name: "تغییر گذرواژه", exact: true }),
  ).toBeEnabled();
  await expect(
    staff.getByRole("link", { name: "فروش من", exact: true }),
  ).toHaveCount(0);
  await staff.goto(origin + "/staff/sales");
  await expect(
    staff.getByText("دسترسی به فروش شخصی برای این حساب فعال نیست."),
  ).toBeVisible();
  await staff.goto(origin + "/staff/shipping");
  await expect(
    staff.getByRole("heading", { name: "دسترسی محدود" }),
  ).toBeVisible();
  await staffContext.close();

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`/omnisire/members/${created.id}`);
  await page
    .getByRole("button", { name: "اطلاعات و دسترسی", exact: true })
    .click();
  await page.getByRole("button", { name: "بازنشانی", exact: true }).click();
  const saved = page.waitForResponse(
    (r) =>
      r.url().endsWith(`/omnisire/members/${created.id}`) &&
      r.request().method() === "PATCH",
  );
  await page
    .getByRole("button", { name: "ذخیره تغییرات", exact: true })
    .click();
  expect((await saved).ok()).toBe(true);
  const reset = await (
    await page.request.get(`/api/v1/omnisire/members/${created.id}`)
  ).json();
  expect(reset.permissionOverrides).toEqual({});
  await page.reload();
  await page
    .getByRole("button", { name: "اطلاعات و دسترسی", exact: true })
    .click();
  await expect(
    section("فروش من").getByRole("checkbox", { name: "مشاهده بخش" }),
  ).toBeChecked();
});
