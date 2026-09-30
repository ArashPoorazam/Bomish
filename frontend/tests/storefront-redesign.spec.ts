import { test, expect } from "@playwright/test";
import type { Address, Order, Product } from "../src/lib/types";
import { packagePrice } from "../src/lib/format";
import { totp } from "./staff-login";

const address: Address = {
  id: "home",
  recipient: "خریدار نمونه",
  phone: "09123334444",
  province: "تهران",
  city: "تهران",
  street: "خیابان نمونه پلاک ۱۲",
  postalCode: "1234567890",
};
const states = [
  "pending",
  "paid",
  "packing",
  "shipped",
  "received",
  "cancelled",
  "expired",
  "review",
];
const orders: Order[] = states.map((status, i) => ({
  id: `order-${i}`,
  status,
  address,
  items: [
    {
      productId: "turmeric",
      name: "زردچوبه",
      grams: 100,
      priceRials: 430000,
      totalRials: 430000,
      packageId: "small",
      packageLabel: "۱۰۰ گرم",
      quantity: 1,
    },
  ],
  subtotalRials: 430000,
  shippingRials: 50000,
  totalRials: 480000,
  discountRials: 0,
  discountCode: "",
  tracking: status === "shipped" ? "123456789012345678901234" : "",
  createdAt: `2026-09-${String(28 - i).padStart(2, "0")}T12:00:00Z`,
  events: [],
}));

test("account views, all order states, address CRUD and recoverable errors", async ({
  page,
}) => {
  let saved = [{ ...address }];
  let failSave = true,
    failOrders = true,
    authenticated = true;
  const mutations: string[] = [];
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace("/api/v1", "");
    const method = route.request().method();
    if (path === "/session")
      return route.fulfill({
        json: {
          csrf: "test",
          authenticated,
          development: true,
          permissions: [],
          role: "",
          staffId: "",
        },
      });
    if (path === "/cart")
      return route.fulfill({ json: { items: [], subtotalRials: 0 } });
    if (path === "/settings") return route.fulfill({ json: {} });
    if (path === "/orders") {
      if (failOrders) {
        failOrders = false;
        return route.fulfill({
          status: 503,
          json: { error: "دریافت سفارش‌ها ممکن نشد" },
        });
      }
      return route.fulfill({ json: orders });
    }
    if (path.startsWith("/orders/"))
      return route.fulfill({
        json: { order: orders[3], trackingUrl: "https://example.com/tracking" },
      });
    if (path === "/addresses" && method === "GET")
      return route.fulfill({ json: saved });
    if (path.startsWith("/addresses") && method !== "GET") {
      mutations.push(method);
      if (method === "DELETE") {
        saved = [];
        return route.fulfill({ json: { ok: true } });
      }
      if (failSave) {
        failSave = false;
        return route.fulfill({
          status: 503,
          json: { error: "ذخیره نشانی ممکن نشد" },
        });
      }
      const a = {
        ...route.request().postDataJSON(),
        id: method === "POST" ? "new-home" : "home",
      };
      saved = method === "POST" ? [...saved, a] : [a];
      return route.fulfill({ status: method === "POST" ? 201 : 200, json: a });
    }
    if (path === "/logout") {
      authenticated = false;
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({ json: {} });
  });
  await page.goto("/account");
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "دریافت سفارش‌ها ممکن نشد",
  );
  await page.getByRole("button", { name: "تلاش دوباره" }).click();
  await expect(page.locator(".account-stats")).toContainText("۸");
  const nav = page.getByRole("navigation", { name: "حساب کاربری" });
  await nav.getByRole("link", { name: "سفارش‌ها", exact: true }).click();
  await expect(page).toHaveURL(/section=orders/);
  for (const state of states) {
    await page.getByLabel("وضعیت سفارش").selectOption(state);
    await expect(page.locator(".order-summary")).toHaveCount(1);
    await expect(page.locator(".order-summary .badge")).toHaveAttribute(
      "data-status",
      state,
    );
  }
  await page.getByLabel("وضعیت سفارش").selectOption("shipped");
  await page.getByRole("link", { name: "جزئیات و پیگیری" }).click();
  await expect(page.locator(".order-timeline")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "پیگیری در پیشخوان ۲۴" }),
  ).toHaveAttribute("href", "https://example.com/tracking");
  await expect(page.locator(".delivery-address")).toContainText(address.street);
  await nav.getByRole("link", { name: "نشانی‌ها", exact: true }).click();
  await page.getByRole("button", { name: "ویرایش", exact: true }).click();
  await page
    .getByLabel("نشانی کامل، پلاک و واحد")
    .fill("خیابان ویرایش شده پلاک ۳");
  await page.getByRole("button", { name: "ذخیره نشانی", exact: true }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "ذخیره نشانی ممکن نشد",
  );
  await expect(page.getByLabel("نشانی کامل، پلاک و واحد")).toHaveValue(
    "خیابان ویرایش شده پلاک ۳",
  );
  await page.getByRole("button", { name: "ذخیره نشانی", exact: true }).click();
  await expect(page.locator(".address-card")).toContainText(
    "خیابان ویرایش شده پلاک ۳",
  );
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "حذف", exact: true }).click();
  await expect(page.locator(".address-card")).toHaveCount(1);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "حذف", exact: true }).click();
  await expect(page.locator(".address-card")).toHaveCount(0);
  await page.getByRole("button", { name: "نشانی جدید", exact: true }).click();
  for (const [label, value] of [
    ["نام گیرنده", "گیرنده تازه"],
    ["شماره همراه گیرنده", "۰۹۱۲۳۳۳۴۴۴۴"],
    ["استان", "تهران"],
    ["شهر", "تهران"],
    ["نشانی کامل، پلاک و واحد", "خیابان تازه پلاک ۱۰"],
    ["کد پستی", "۱۲۳۴۵۶۷۸۹۰"],
  ])
    await page.getByLabel(label, { exact: true }).fill(value);
  await page.getByRole("button", { name: "ذخیره نشانی", exact: true }).click();
  await expect(page.locator(".address-card")).toContainText("گیرنده تازه");
  expect(saved[0].phone).toBe("09123334444");
  expect(mutations).toEqual(["PUT", "PUT", "DELETE", "POST"]);
  await page.reload();
  await expect(
    nav.getByRole("link", { name: "نشانی‌ها", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await nav.getByRole("link", { name: "نمای کلی", exact: true }).click();
  await expect(page).toHaveURL(/\/account$/);
  await page.goBack();
  await expect(page).toHaveURL(/section=addresses/);
  await page.getByRole("button", { name: "خروج از حساب" }).click();
  await expect(page.getByLabel("شماره همراه", { exact: true })).toBeVisible();
});

test("catalog filters preserve query and sorting while clearing pagination", async ({
  page,
}) => {
  await page.goto("/products?q=زردچوبه&available=true&page=2");
  await page
    .getByRole("combobox", { name: "مرتب‌سازی", exact: true })
    .selectOption("price-desc");
  await expect(page).toHaveURL(/sort=price-desc/);
  let url = new URL(page.url());
  expect(url.searchParams.get("q")).toBe("زردچوبه");
  expect(url.searchParams.get("available")).toBe("true");
  expect(url.searchParams.has("page")).toBe(false);
  await page
    .getByRole("combobox", { name: "دسته‌بندی", exact: true })
    .selectOption("spices");
  await page.getByRole("button", { name: "اعمال فیلتر", exact: true }).click();
  await expect(page).toHaveURL(/category=spices/);
  await page.getByRole("link", { name: "حذف فیلتر فقط موجود" }).click();
  await expect(
    page.locator('.catalog-grid a[href="/products/turmeric"]'),
  ).toHaveCount(1);
  url = new URL(page.url());
  expect(url.searchParams.get("sort")).toBe("price-desc");
  expect(url.searchParams.has("available")).toBe(false);
});

test("homepage copy and keyboard carousel navigation", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "انتخاب‌های بومیش", exact: true }),
  ).toBeVisible();
  await expect(page.locator("main")).not.toContainText("انتخاب آزادانه وزن");
  await expect(page.locator(".principle-card").last()).toContainText(
    "جنس درجه ۱، ۲ و ۳ را قاطی نمی‌کنیم",
  );
  const track = page.locator(".rail-track").first();
  await expect(
    page.getByRole("button", { name: "قبلی در انتخاب‌های بومیش" }),
  ).toBeDisabled();
  await track.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(
    page.getByRole("button", { name: "قبلی در انتخاب‌های بومیش" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "قبلی در انتخاب‌های بومیش" }).click();
  await expect(
    page.getByRole("button", { name: "قبلی در انتخاب‌های بومیش" }),
  ).toBeDisabled();
});

test("discounted package rounds to 1000 toman in listing, purchase, cart, and checkout", async ({
  page,
  request,
  baseURL,
}) => {
  const session = await (await request.get("/api/v1/session")).json();
  const headers = {
    Origin: new URL(baseURL!).origin,
    "X-CSRF-Token": session.csrf,
  };
  const login = await request.post("/api/v1/staff/login", {
    headers,
    data: { username: "owner", password: "Bomish-demo-2026!", code: totp() },
  });
  expect(login.ok()).toBe(true);
  const id = `rounding-${Date.now()}`;
  const source = (await (
    await request.get("/api/v1/products/turmeric")
  ).json()) as Product;
  const product = {
    ...source,
    id,
    slug: id,
    name: "محصول بررسی گرد کردن",
    packages: [
      {
        id: "small",
        amount: 100,
        unit: "g",
        priceRials: 470000,
        maxQuantity: 5,
        shippingGrams: 100,
      },
    ],
  };
  try {
    expect(
      (
        await request.put(`/api/v1/staff/products/${id}`, {
          headers,
          data: product,
        })
      ).ok(),
    ).toBe(true);
    expect(
      (
        await request.post(`/api/v1/staff/products/${id}/publish`, { headers })
      ).ok(),
    ).toBe(true);
    expect(
      (
        await request.post("/api/v1/staff/product-discounts", {
          headers,
          data: {
            id,
            name: "تخفیف بررسی گرد کردن",
            percent: 10,
            productIds: [id],
          },
        })
      ).ok(),
    ).toBe(true);
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "تازه‌های بومیش", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "پیشنهادهای بومیش", exact: true }),
    ).toBeVisible();
    await page.goto(`/products?q=${id}&discounted=true`);
    await expect(page.locator(".catalog-grid")).toContainText("۴۳٬۰۰۰");
    await page.locator(".catalog-grid .product-card").click();
    await expect(page.locator(".product-price")).toContainText("۴۳٬۰۰۰");
    await page.getByLabel("تعداد بسته", { exact: true }).fill("2");
    await expect(page.locator(".purchase-bottom")).toContainText("۸۶٬۰۰۰");
    await page
      .getByRole("button", { name: "افزودن به سبد", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toContainText("۸۶٬۰۰۰");
    await page.getByRole("link", { name: "ادامه خرید", exact: true }).click();
    const phone = `091${String(Date.now()).slice(-8)}`;
    await page.getByLabel("شماره همراه", { exact: true }).fill(phone);
    const response = page.waitForResponse(
      (r) =>
        r.url().endsWith("/auth/request") && r.request().method() === "POST",
    );
    await page.getByRole("button", { name: "دریافت کد تأیید" }).click();
    const { devCode } = await (await response).json();
    await page.getByLabel("کد تأیید", { exact: true }).fill(devCode);
    await page.getByRole("button", { name: "تأیید و ادامه" }).click();
    await expect(page.locator(".checkout-summary")).toContainText("۸۶٬۰۰۰");
  } finally {
    await request.delete(`/api/v1/staff/product-discounts/${id}`, { headers });
    await request.post(`/api/v1/staff/products/${id}/archive`, { headers });
  }
});

test("frontend price helper preserves exact thousands and undiscounted prices", () => {
  const product = { discountPercent: 10 } as Product;
  const pack = { priceRials: 470000 } as Product["packages"][number];
  expect(packagePrice(product, pack)).toBe(430000);
  expect(packagePrice(product, { ...pack, priceRials: 500000 })).toBe(450000);
  expect(
    packagePrice(
      { ...product, discountPercent: 0 },
      { ...pack, priceRials: 473210 },
    ),
  ).toBe(473210);
  expect(
    packagePrice(
      { ...product, discountPercent: 1 },
      { ...pack, priceRials: 9990 },
    ),
  ).toBe(9990);
});
