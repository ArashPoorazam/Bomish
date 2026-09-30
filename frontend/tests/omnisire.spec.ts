import { test, expect } from "@playwright/test";
import type { Product } from "@/lib/types";
import { loginStaff, totp } from "./staff-login";

test("owner creates salesperson, referral earns commission, payout appears in sales, analytics exports", async ({
  browser,
}) => {
  test.setTimeout(120000);
  const ownerContext = await browser.newContext();
  const salesContext = await browser.newContext();
  const customerContext = await browser.newContext();
  const operatorContext = await browser.newContext();
  const owner = await ownerContext.newPage(),
    sales = await salesContext.newPage(),
    customer = await customerContext.newPage(),
    operator = await operatorContext.newPage();
  const errors: string[] = [];
  for (const p of [owner, sales, customer, operator])
    p.on("pageerror", (e) => errors.push(e.message));
  try {
    await owner.goto("/staff");
    await loginStaff(owner, "owner");
    await owner.goto("/omnisire");
    await expect(owner.getByRole("heading", { level: 1 })).toBeVisible();
    await owner.screenshot({
      path: "test-results/omnisire-desktop.png",
      fullPage: true,
    });
    await owner.goto("/omnisire/members");
    await owner
      .getByRole("button", { name: "همکار جدید", exact: true })
      .click();
    const name = "فروشنده مرورگر " + Date.now(),
      username = "sales-" + Date.now();
    await owner.getByLabel("نام و نام خانوادگی", { exact: true }).fill(name);
    await owner.getByLabel("نام کاربری", { exact: true }).fill(username);
    await owner.getByLabel("شماره همراه", { exact: true }).fill("۰۹۱۲۳۴۵۶۷۸۹");
    await owner
      .getByLabel("شماره کارت بانکی", { exact: true })
      .fill("۵۰۲۲۲۹۱۰۰۲۶۹۶۱۷۵");
    await expect(
      owner.getByLabel("شماره کارت بانکی", { exact: true }),
    ).toHaveValue("5022 - 2910 - 0269 - 6175");
    await owner.getByLabel("گذرواژه اولیه").fill("Browser-sales-2026!");
    const created = owner.waitForResponse(
      (r) =>
        r.url().endsWith("/omnisire/members") &&
        r.request().method() === "POST",
    );
    await owner
      .getByRole("button", { name: "ایجاد حساب همکار", exact: true })
      .click();
    const member = await (await created).json();
    expect(member.totpSecret).toBeTruthy();
    await owner.getByRole("link", { name: "مشاهده پرونده همکار" }).click();
    await sales.goto("/staff");
    await sales.getByLabel("نام کاربری", { exact: true }).fill(username);
    await sales
      .getByLabel("گذرواژه", { exact: true })
      .fill("Browser-sales-2026!");
    await sales.getByLabel("کد برنامه رمزساز").fill(totp(member.totpSecret));
    await sales.getByRole("button", { name: "ورود به فضای کار" }).click();
    await expect(sales).toHaveURL(/staff\/sales/);
    await expect(sales.getByLabel("لینک معرفی")).toBeVisible();
    const referral = await sales.getByLabel("لینک معرفی").inputValue();
    expect((await sales.request.get("/api/v1/omnisire/members")).status()).toBe(
      403,
    );
    expect((await sales.request.get("/api/v1/staff/orders")).status()).toBe(
      403,
    );
    const captured = customer.waitForResponse((r) =>
      r.url().endsWith("/referral"),
    );
    await customer.goto(referral);
    await captured;
    const catalog: Product[] = await (
      await customer.request.get("/api/v1/products?available=true")
    ).json();
    const product = catalog.find((p) => !p.outOfStock && p.packages.length);
    expect(product, "an available published product is required").toBeTruthy();
    await customer.goto(`/products/${product!.slug}`);
    await customer.getByRole("button", { name: "افزودن به سبد" }).click();
    await customer
      .getByRole("link", { name: "ادامه خرید", exact: true })
      .click();
    await customer
      .getByLabel("شماره همراه", { exact: true })
      .fill("091" + String(Date.now()).slice(-8));
    const otp = customer.waitForResponse((r) =>
      r.url().endsWith("/auth/request"),
    );
    await customer.getByRole("button", { name: "دریافت کد تأیید" }).click();
    await customer
      .getByLabel("کد تأیید", { exact: true })
      .fill((await (await otp).json()).devCode);
    await customer.getByRole("button", { name: "تأیید و ادامه" }).click();
    await customer
      .getByLabel("نام گیرنده", { exact: true })
      .fill("مشتری معرفی");
    await customer.getByLabel("شماره همراه گیرنده").fill("09123456789");
    await customer.getByLabel("شهر", { exact: true }).fill("تهران");
    await customer
      .getByLabel("نشانی کامل، پلاک و واحد")
      .fill("خیابان نمونه پلاک ۱۲");
    await customer.getByLabel("کد پستی", { exact: true }).fill("1234567890");
    await customer.getByRole("button", { name: "محاسبه هزینه ارسال" }).click();
    await customer
      .getByRole("button", { name: "تأیید سفارش و پرداخت" })
      .click();
    await customer
      .getByRole("button", { name: "شبیه‌سازی پرداخت موفق" })
      .click();
    await expect(customer).toHaveURL(/account\/orders\//);
    const orderId = new URL(customer.url()).pathname.split("/").pop()!;
    await operator.goto("/staff");
    await loginStaff(operator, "operator");
    await operator.goto(
      "/staff?" + new URLSearchParams({ section: "orders", q: orderId }),
    );
    await expect(
      operator.getByRole("button", { name: "محصولات", exact: true }),
    ).toHaveCount(0);
    await operator
      .getByRole("button", {
        name: new RegExp(`جزئیات سفارش ${orderId.slice(0, 8)}`),
      })
      .click();
    await operator
      .getByRole("button", { name: "تأیید بسته‌بندی", exact: true })
      .click();
    await operator
      .getByLabel("کد رهگیری مرسوله", { exact: true })
      .fill("۱۲۳۴۵۶۷۸۹۰۱۲۳۴۵۶۷۸۹۰");
    await operator
      .getByRole("button", { name: "ثبت ارسال و اطلاع‌رسانی", exact: true })
      .click();
    await operator
      .getByRole("button", { name: "تأیید تحویل به مشتری", exact: true })
      .click();
    const events = await (
      await owner.request.get("/api/v1/omnisire/events?entity=" + orderId)
    ).json();
    for (const action of ["order.packing", "order.shipped", "order.received"]) {
      expect(
        events.items.some(
          (event: { action: string; staffId: string }) =>
            event.action === action && event.staffId,
        ),
      ).toBe(true);
    }

    await sales.reload();
    const summary = await (
      await sales.request.get("/api/v1/staff/sales")
    ).json();
    expect(summary.balanceRials).toBeGreaterThan(0);
    expect(summary.balanceRials % 10000).toBe(0);
    await expect(sales.locator("tbody")).toContainText("••••");
    await owner.reload();
    await owner
      .getByRole("button", { name: "ثبت پرداخت", exact: true })
      .click();
    await owner
      .getByLabel("مبلغ پرداختی (تومان)")
      .fill(String(summary.balanceRials / 10));
    const reference = "receipt-" + Date.now();
    await owner.getByLabel("شماره تراکنش بانکی").fill(reference);
    await owner
      .getByRole("button", { name: "ثبت تراکنش", exact: true })
      .click();
    await expect(
      owner.getByRole("status").filter({ hasText: "تراکنش ثبت شد" }),
    ).toBeVisible();
    await sales.reload();
    await sales.getByRole("button", { name: "گردش حساب و پرداخت‌ها" }).click();
    await expect(sales.locator("tbody")).toContainText(reference);
    const after = await (await sales.request.get("/api/v1/staff/sales")).json();
    expect(after.balanceRials).toBe(0);
    await owner.goto("/omnisire/analytics");
    await owner
      .getByRole("button", { name: "عملکرد محصولات", exact: true })
      .click();
    await owner.getByRole("checkbox").first().check();
    await expect(owner.locator(".omni-line-chart svg")).toBeVisible();
    await owner.getByRole("button", { name: "دریافت اکسل" }).click();
    const ready = owner.getByRole("link", {
      name: "دانلود فایل اکسل",
    });
    await expect(ready).toBeVisible({ timeout: 15000 });
    const downloaded = owner.waitForEvent("download");
    await ready.click();
    expect((await downloaded).suggestedFilename()).toBe("omnisire.xlsx");
    await owner.setViewportSize({ width: 390, height: 844 });
    await owner.goto("/omnisire/members");
    await expect(
      owner.getByRole("heading", { name: "همکاران", exact: true }),
    ).toBeVisible();
    expect(
      await owner.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await owner.screenshot({
      path: "test-results/omnisire-members-mobile.png",
      fullPage: true,
    });
    await sales.setViewportSize({ width: 390, height: 844 });
    await expect(sales.locator(".omni-sidebar")).toBeHidden();
    await sales.getByRole("button", { name: "فهرست", exact: true }).click();
    await expect(
      sales.getByRole("button", { name: "بستن فهرست" }),
    ).toBeFocused();
    await sales.keyboard.press("Escape");
    await expect(sales.locator(".omni-sidebar")).toBeHidden();
    await sales.screenshot({
      path: "test-results/sales-mobile.png",
      fullPage: true,
    });
    expect(
      await sales.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await ownerContext.close();
    await salesContext.close();
    await customerContext.close();
    await operatorContext.close();
  }
});
