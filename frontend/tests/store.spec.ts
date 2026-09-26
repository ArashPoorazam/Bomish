import { test, expect, type Page } from "@playwright/test";
import { createHmac } from "node:crypto";
const phone = () => `091${String(Date.now()).slice(-8)}`;
function totp() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of "JBSWY3DPEHPK3PXP")
    bits += chars.indexOf(c).toString(2).padStart(5, "0");
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const b = Buffer.alloc(8);
  b.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const digest = createHmac("sha1", key).update(b).digest();
  return String(
    (digest.readUInt32BE(digest[19] & 15) & 0x7fffffff) % 1000000,
  ).padStart(6, "0");
}
async function loginCustomer(page: Page) {
  await page.getByLabel("شماره همراه", { exact: true }).fill(phone());
  const response = page.waitForResponse(
    (r) => r.url().endsWith("/auth/request") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "دریافت کد تأیید" }).click();
  const data = await (await response).json();
  await page.getByLabel("کد تأیید", { exact: true }).fill(data.devCode);
  await page.getByRole("button", { name: "تأیید و ادامه" }).click();
}
test("Persian discovery, live search, article and responsive layout", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("طعم");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  const search = page.getByRole("combobox", { name: "جستجوی محصولات" });
  await search.fill("زرچوبه");
  await expect(
    page.locator("#search-results").getByRole("option").first(),
  ).toContainText("زردچوبه");
  await search.press("ArrowDown");
  await search.press("Enter");
  await expect(page).toHaveURL(/products\/turmeric/);
  await expect(
    page.getByRole("heading", { name: "چطور استفاده کنیم؟" }),
  ).toBeVisible();
  await page.goto("/blog/spice-guide");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "ادویه‌ها را بهتر بشناسیم",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/mobile-home.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
test("mobile weight entry and accessible left cart survive refresh", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/products/turmeric");
  await page.getByLabel("واحد", { exact: true }).selectOption("kg");
  await page.getByLabel("وزن دلخواه", { exact: true }).fill("۱٫۵");
  await page.getByRole("button", { name: "افزودن به سبد" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("۱٫۵ کیلوگرم");
  expect((await dialog.boundingBox())!.x).toBe(0);
  for (let i = 0; i < 12; i++) await page.keyboard.press("Tab");
  expect(
    await page.evaluate(() =>
      document.querySelector("dialog")?.contains(document.activeElement),
    ),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "افزودن به سبد" }),
  ).toBeFocused();
  await page.reload();
  await page.getByRole("button", { name: "باز کردن سبد خرید" }).click();
  await expect(dialog).toContainText("۱٫۵ کیلوگرم");
  await dialog.getByRole("button", { name: "افزایش وزن زردچوبه" }).click();
  await expect(dialog).toContainText("۱٫۵۵ کیلوگرم");
  await dialog.getByRole("button", { name: "حذف زردچوبه" }).click();
  await expect(dialog).toContainText("سبد شما هنوز خالی است");
});
test("SMS login, shipping quote, payment and order history", async ({
  page,
}) => {
  await page.goto("/products/turmeric");
  await page.getByRole("button", { name: "۱ کیلوگرم", exact: true }).click();
  await page.getByRole("button", { name: "افزودن به سبد" }).click();
  await page.getByRole("link", { name: "ادامه خرید" }).click();
  await loginCustomer(page);
  await page.getByLabel("نام گیرنده", { exact: true }).fill("خریدار آزمایشی");
  await page.getByLabel("شماره همراه گیرنده").fill("۰۹۱۲۱۲۳۴۵۶۷");
  await page.getByLabel("شهر", { exact: true }).fill("تهران");
  await page
    .getByLabel("نشانی کامل، پلاک و واحد")
    .fill("خیابان نمونه پلاک ۱۲ واحد ۲");
  await page.getByLabel("کد پستی", { exact: true }).fill("۱۲۳۴۵۶۷۸۹۰");
  await page.getByRole("button", { name: "محاسبه هزینه ارسال" }).click();
  await expect(page.locator(".checkout-summary")).toContainText("۶۵٬۰۰۰");
  await page.getByRole("button", { name: "تأیید سفارش و پرداخت" }).click();
  await expect(
    page.getByRole("heading", { name: "درگاه پرداخت آزمایشی" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "شبیه‌سازی پرداخت موفق" }).click();
  await expect(
    page.getByRole("heading", { name: "سفارش شما ثبت شد" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "دیدن سفارش‌ها" }).click();
  await expect(page.locator(".order-card").first()).toContainText("پرداخت‌شده");
  await expect(
    page.getByText("تهران، تهران، خیابان نمونه پلاک ۱۲ واحد ۲"),
  ).toBeVisible();
});
test("employee drafts through UI, owner publishes, customer finds product", async ({
  browser,
}) => {
  const editorContext = await browser.newContext();
  const editor = await editorContext.newPage();
  const slug = "browser-" + Date.now();
  await editor.goto("/staff");
  await editor.getByLabel("نام کاربری", { exact: true }).fill("editor");
  await editor.getByLabel("گذرواژه", { exact: true }).fill("Bomish-demo-2026!");
  await editor.getByLabel("کد برنامه رمزساز", { exact: true }).fill(totp());
  await editor.getByRole("button", { name: "ورود به فضای کار" }).click();
  await editor
    .getByRole("button", { name: "+ محصول جدید", exact: true })
    .click();
  await editor
    .getByLabel("نام محصول", { exact: true })
    .fill("ادویه آزمایش مرورگر");
  await editor.getByLabel("نشانی صفحه", { exact: true }).fill(slug);
  await editor.getByLabel("دسته‌بندی", { exact: true }).selectOption("spices");
  await editor
    .getByLabel("خلاصه محصول")
    .fill("یک محصول برای بررسی جریان انتشار");
  await editor
    .getByLabel("معرفی و توضیحات")
    .fill("توضیحات محصول آزمایشی برای بررسی رابط کاربری فروشگاه.");
  await editor
    .getByLabel("بارگذاری تصویر")
    .setInputFiles("public/images/spices.png");
  await expect(editor.getByRole("img", { name: "تصویر 1" })).toBeVisible();
  await editor
    .getByRole("button", { name: "ذخیره پیش‌نویس", exact: true })
    .click();
  await expect(editor.getByRole("status")).toContainText("پیش‌نویس ذخیره شد");
  await expect(editor.getByLabel("قیمت هر کیلو (تومان)")).toHaveCount(0);
  const publicResponse = await editor.request.get("/api/v1/products/" + slug);
  expect(publicResponse.status()).toBe(404);
  const forbidden = await editor.request.get("/api/v1/staff/orders");
  expect(forbidden.status()).toBe(403);
  const ownerContext = await browser.newContext();
  const owner = await ownerContext.newPage();
  await owner.goto("/staff");
  await owner.getByLabel("نام کاربری", { exact: true }).fill("owner");
  await owner.getByLabel("گذرواژه", { exact: true }).fill("Bomish-demo-2026!");
  await owner.getByLabel("کد برنامه رمزساز", { exact: true }).fill(totp());
  await owner.getByRole("button", { name: "ورود به فضای کار" }).click();
  await owner
    .getByRole("button", { name: /ادویه آزمایش مرورگر/ })
    .first()
    .click();
  await owner.getByLabel("قیمت هر کیلو (تومان)").fill("180000");
  await owner
    .getByRole("button", { name: "ذخیره و انتشار", exact: true })
    .click();
  await expect(owner.getByRole("status")).toContainText("محصول منتشر شد");
  await owner.getByLabel("تغییر موجودی به گرم (مثبت یا منفی)").fill("10000");
  await owner.getByLabel("دلیل تغییر").fill("موجودی آزمایشی");
  await owner.getByRole("button", { name: "ثبت تغییر موجودی" }).click();
  await expect(owner.getByRole("status")).toContainText("موجودی به‌روز شد");
  await expect(owner.getByText("موجودی قابل فروش: ۱۰٬۰۰۰ گرم")).toBeVisible();
  await owner.goto("/products/" + slug);
  await expect(owner.getByRole("heading", { level: 1 })).toHaveText(
    "ادویه آزمایش مرورگر",
  );
  await owner.getByRole("button", { name: "افزودن به سبد" }).click();
  await expect(owner.getByRole("dialog")).toContainText("ادویه آزمایش مرورگر");
  const state = await (await owner.request.get("/api/v1/session")).json();
  const product = await (
    await owner.request.get("/api/v1/products/" + slug)
  ).json();
  const archived = await owner.request.post(
    `/api/v1/staff/products/${product.id}/archive`,
    {
      headers: {
        Origin: new URL(owner.url()).origin,
        "X-CSRF-Token": state.csrf,
      },
    },
  );
  expect(archived.ok()).toBe(true);
  expect((await owner.request.get("/api/v1/products/" + slug)).status()).toBe(
    404,
  );
  await editorContext.close();
  await ownerContext.close();
});
