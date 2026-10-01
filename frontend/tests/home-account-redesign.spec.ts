import { test, expect, type Page } from "@playwright/test";
import { loginStaffAPI } from "./staff-login";

async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}

test("staff homepage images upload, reorder, save, reload, rotate and remove end to end", async ({
  page,
  context,
  baseURL,
}) => {
  test.setTimeout(90000);
  const headers = await loginStaffAPI(context.request, baseURL!, "editor");
  const original = await (
    await context.request.get("/api/v1/staff/home/slides")
  ).json();
  const save = async (data: unknown) =>
    expect(
      (
        await context.request.put("/api/v1/staff/home/slides", {
          headers,
          data,
        })
      ).ok(),
    ).toBe(true);
  try {
    await save([]);
    await page.goto("/staff?section=suggestions");
    await expect(
      page.getByRole("heading", { name: "تصاویر صفحه اصلی", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "ذخیره تصاویر", exact: true }),
    ).toBeDisabled();
    await page
      .getByLabel("بارگذاری تصاویر صفحه اصلی", { exact: true })
      .setInputFiles([
        "public/images/login-customer.webp",
        "public/images/login-staff.webp",
      ]);
    await expect(page.locator(".home-slide-list li")).toHaveCount(2);
    await page
      .getByLabel("توضیح تصویر ۱", { exact: true })
      .fill("تصویر اول آزمایشی");
    await page
      .getByLabel("توضیح تصویر ۲", { exact: true })
      .fill("تصویر دوم آزمایشی");
    await page
      .getByRole("button", { name: "تصویر ۲ بالاتر", exact: true })
      .click();
    await page
      .getByRole("button", { name: "ذخیره تصاویر", exact: true })
      .click();
    await expect(
      page.getByText("تصاویر صفحه اصلی ذخیره شدند.", { exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(page.getByLabel("توضیح تصویر ۱", { exact: true })).toHaveValue(
      "تصویر دوم آزمایشی",
    );
    const saved = await (
      await context.request.get("/api/v1/home/slides")
    ).json();
    expect(saved).toHaveLength(2);
    expect(saved[0].image).toMatch(/^\/uploads\//);
    expect((await context.request.get(saved[0].image)).ok()).toBe(true);
    await page.screenshot({
      path: "/tmp/bomish-home-management-desktop.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await noOverflow(page);
    await page.screenshot({
      path: "/tmp/bomish-home-management-mobile.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.clock.install();
    await page.goto("/");
    const region = page.getByRole("region", { name: "تصاویر بومیش" });
    const dots = region.locator(".hero-slide-dots button");
    await expect(region.getByRole("img")).toHaveAttribute(
      "alt",
      "تصویر دوم آزمایشی",
    );
    await expect(region.locator(".hero-slide-viewport")).toHaveAttribute(
      "aria-live",
      "off",
    );
    await page.clock.runFor(5100);
    await expect(dots.nth(1)).toHaveAttribute("aria-pressed", "true");
    const keyframes = await region
      .locator(".is-incoming")
      .evaluate((el) =>
        (el.getAnimations()[0]?.effect as KeyframeEffect | null)
          ?.getKeyframes()
          .map((k) => k.transform),
      );
    expect(keyframes).toEqual(["translateX(-100%)", "translateX(0px)"]);
    await page.clock.runFor(5100);
    await expect(dots.nth(0)).toHaveAttribute("aria-pressed", "true");
    await region.hover();
    await page.clock.runFor(10000);
    await expect(dots.nth(0)).toHaveAttribute("aria-pressed", "true");
    await page.mouse.move(0, 0);
    await dots.nth(1).focus();
    await page.clock.runFor(10000);
    await expect(dots.nth(0)).toHaveAttribute("aria-pressed", "true");
    await page.locator("h1").click();
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "hidden",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.clock.runFor(10000);
    await expect(dots.nth(0)).toHaveAttribute("aria-pressed", "true");
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "visible",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.clock.runFor(5100);
    await expect(dots.nth(1)).toHaveAttribute("aria-pressed", "true");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.clock.runFor(15000);
    await expect(dots.nth(1)).toHaveAttribute("aria-pressed", "true");
    await expect(region.getByRole("button")).toHaveCount(2);
    await dots.nth(0).click();
    await expect(dots.nth(0)).toHaveAttribute("aria-pressed", "true");
    await expect(region.locator(".is-incoming")).toHaveCSS(
      "animation-name",
      "none",
    );
    const viewport = region.locator(".hero-slide-viewport");
    const box = (await viewport.boundingBox())!;
    const drag = async (distance: number, vertical = 0) => {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(
        box.x + box.width / 2 + distance,
        box.y + box.height / 2 + vertical,
        { steps: 8 },
      );
      await page.mouse.up();
    };
    await drag(120);
    await expect(dots.nth(1)).toHaveAttribute("aria-pressed", "true");
    await expect(region).toHaveAttribute("data-direction", "1");
    await drag(-120);
    await expect(dots.nth(0)).toHaveAttribute("aria-pressed", "true");
    await expect(region).toHaveAttribute("data-direction", "-1");
    await drag(15);
    await drag(20, 80);
    await expect(dots.nth(0)).toHaveAttribute("aria-pressed", "true");
    await dots.nth(0).focus();
    await page.keyboard.press("ArrowRight");
    await expect(dots.nth(1)).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("ArrowLeft");
    await expect(dots.nth(0)).toHaveAttribute("aria-pressed", "true");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.locator("h1").click();
    await page.mouse.move(0, 0);
    await page.clock.runFor(10000);
    await expect(dots.nth(0)).toHaveAttribute("aria-pressed", "true");
    await page.setViewportSize({ width: 390, height: 844 });
    await viewport.scrollIntoViewIfNeeded();
    const mobileBox = (await viewport.boundingBox())!;
    const cdp = await context.newCDPSession(page);
    const point = {
      x: mobileBox.x + mobileBox.width / 2,
      y: mobileBox.y + mobileBox.height / 2,
    };
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [point],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ ...point, x: point.x + 100 }],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await expect(dots.nth(1)).toHaveAttribute("aria-pressed", "true");
    await noOverflow(page);
    await page.screenshot({
      path: "/tmp/bomish-updated-home-mobile.png",
      fullPage: true,
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({
      path: "/tmp/bomish-home-slideshow-desktop.png",
      fullPage: true,
    });
    await page.goto("/staff?section=suggestions");
    await page
      .getByRole("button", { name: "حذف تصویر ۲", exact: true })
      .click();
    await page
      .getByRole("button", { name: "ذخیره تصاویر", exact: true })
      .click();
    await expect(
      page.getByText("تصاویر صفحه اصلی ذخیره شدند.", { exact: true }),
    ).toBeVisible();
    await page.goto("/");
    await expect(region.locator(".hero-slide-controls")).toHaveCount(0);
    await expect(region.getByRole("img")).toHaveAttribute(
      "alt",
      "تصویر دوم آزمایشی",
    );
    await save([]);
    await page.reload();
    await expect(region.getByRole("img")).toHaveAttribute(
      "alt",
      /چیدمان ادویه/,
    );
    expect((await context.request.get(saved[1].image)).ok()).toBe(true);
  } finally {
    await save(original);
  }
});

test("homepage image editor retains successful uploads, retries failures, and preserves unsaved edits", async ({
  page,
}) => {
  let uploads = 0,
    failSave = true;
  let slides = [{ image: "/images/spices.png", alt: "تصویر اولیه" }];
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace("/api/v1", "");
    if (path === "/session")
      return route.fulfill({
        json: {
          csrf: "test",
          role: "editor",
          staffId: "editor",
          permissions: ["products"],
          authenticated: false,
        },
      });
    if (path === "/staff/home/slides") {
      if (route.request().method() === "PUT") {
        if (failSave) {
          failSave = false;
          return route.fulfill({
            status: 503,
            json: { error: "ذخیره موقتاً ممکن نیست" },
          });
        }
        slides = route.request().postDataJSON();
      }
      return route.fulfill({
        json: route.request().method() === "PUT" ? { ok: true } : slides,
      });
    }
    if (path === "/staff/uploads") {
      uploads++;
      return uploads === 2
        ? route.fulfill({ status: 503, json: { error: "بارگذاری ناموفق" } })
        : route.fulfill({
            status: 201,
            json: {
              url: `/images/${uploads === 1 ? "spices.png" : "login-staff.webp"}`,
            },
          });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto("/staff?section=suggestions");
  await page
    .getByLabel("بارگذاری تصاویر صفحه اصلی", { exact: true })
    .setInputFiles([
      { name: "one.png", mimeType: "image/png", buffer: Buffer.from("one") },
      { name: "two.webp", mimeType: "image/webp", buffer: Buffer.from("two") },
    ]);
  await expect(page.locator(".home-slide-list li")).toHaveCount(2);
  await page
    .getByRole("button", { name: "تلاش دوباره برای تصاویر ناموفق" })
    .click();
  await expect(page.locator(".home-slide-list li")).toHaveCount(3);
  expect(uploads).toBe(3);
  await page.getByLabel("توضیح تصویر ۲", { exact: true }).fill("ادویه تازه");
  await page.getByLabel("توضیح تصویر ۳", { exact: true }).fill("سبزی تازه");
  const save = page.getByRole("button", { name: "ذخیره تصاویر", exact: true });
  await save.click();
  await expect(page.getByText("ذخیره موقتاً ممکن نیست")).toBeVisible();
  await expect(page.getByLabel("توضیح تصویر ۲", { exact: true })).toHaveValue(
    "ادویه تازه",
  );
  await save.click();
  await expect(save).toBeDisabled();
  expect(slides.map((s) => s.alt)).toEqual([
    "تصویر اولیه",
    "ادویه تازه",
    "سبزی تازه",
  ]);
});

test("personalized form retains values and reuses its request key after a lost response", async ({
  page,
}) => {
  const keys: string[] = [];
  let created = false;
  const request = (i: number) => ({
    id: `custom-${i}`,
    kind: "custom",
    description: "ترکیب ادویه بدون نمک برای آشپزخانه. ".repeat(12),
    quantity: "۵ کیلوگرم",
    budgetRials: 10000000,
    status: "follow_up",
    response: "برای هماهنگی با شما تماس می‌گیریم.",
    createdAt: "2026-10-01T10:00:00Z",
  });
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace("/api/v1", "");
    if (path === "/session")
      return route.fulfill({
        json: { csrf: "test", authenticated: true, permissions: [] },
      });
    if (path === "/requests" && route.request().method() === "POST") {
      const body = route.request().postDataJSON();
      keys.push(body.idempotencyKey);
      expect(body.budgetRials).toBe(10000000);
      created = true;
      return keys.length === 1
        ? route.fulfill({ status: 503, json: { error: "پاسخ ثبت دریافت نشد" } })
        : route.fulfill({ status: 201, json: { id: "created" } });
    }
    if (path === "/requests" && url.searchParams.get("kind") === "custom") {
      const pageNumber = Number(url.searchParams.get("page"));
      return route.fulfill({
        json: {
          items:
            pageNumber === 2
              ? [request(10)]
              : Array.from({ length: 10 }, (_, i) =>
                  i === 0 && created
                    ? {
                        ...request(i),
                        id: "created",
                        status: "new",
                        response: "",
                      }
                    : request(i),
                ),
          total: 11,
          page: pageNumber,
          pageSize: 10,
        },
      });
    }
    if (path === "/cart")
      return route.fulfill({ json: { items: [], subtotalRials: 0 } });
    return route.fulfill({ json: [] });
  });
  await page.goto("/account?section=custom");
  await expect(page.getByLabel("شرح محصول", { exact: true })).toHaveCount(0);
  await page
    .getByRole("link", { name: "سفارش اختصاصی جدید", exact: true })
    .click();
  await expect(page).toHaveURL(/\/account\/custom\/new$/);
  await page
    .getByLabel("شرح محصول", { exact: true })
    .fill("ترکیب ادویه بدون نمک");
  await page.getByLabel("مقدار و واحد", { exact: true }).fill("۵ کیلوگرم");
  await page
    .getByLabel("بودجه کل پیشنهادی (تومان)", { exact: true })
    .fill("1000000");
  await page.screenshot({
    path: "/tmp/bomish-custom-form-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "ثبت درخواست", exact: true }).click();
  await expect(page.locator("main").getByRole("alert")).toContainText(
    "پاسخ ثبت دریافت نشد",
  );
  await expect(page.getByLabel("شرح محصول", { exact: true })).toHaveValue(
    "ترکیب ادویه بدون نمک",
  );
  await page.getByRole("button", { name: "ثبت درخواست", exact: true }).click();
  await expect(page).toHaveURL(/section=custom&created=1/);
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
  await expect(page.locator(".request-card").first()).toContainText(
    "در انتظار بررسی",
  );
  await page
    .getByRole("button", { name: "نمایش شرح کامل", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("button", { name: "نمایش کمتر", exact: true }),
  ).toHaveAttribute("aria-expanded", "true");
  await page.screenshot({
    path: "/tmp/bomish-custom-list-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "بعدی", exact: true }).click();
  await expect(page.locator(".request-card")).toHaveCount(1);
  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow(page);
  await page.screenshot({
    path: "/tmp/bomish-custom-list-mobile.png",
    fullPage: true,
  });
  await page
    .getByRole("link", { name: "سفارش اختصاصی جدید", exact: true })
    .click();
  await noOverflow(page);
  await page.screenshot({
    path: "/tmp/bomish-custom-form-mobile.png",
    fullPage: true,
  });
});

test("product gallery aligns right on desktop, stacks on mobile, and information shares one panel", async ({
  page,
}) => {
  await page.goto("/products/turmeric");
  await expect(page.locator(".product-gallery")).toBeVisible();
  await expect(page.getByText("عطری برای آشپزخانه شما")).toHaveCount(0);
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await noOverflow(page);
    const gallery = (await page.locator(".product-gallery").boundingBox())!;
    const intro = (await page.locator(".product-intro").boundingBox())!;
    const purchase = (await page.locator(".purchase-panel").boundingBox())!;
    if (width > 760) {
      expect(gallery.x).toBeGreaterThan(intro.x);
      expect(Math.abs(gallery.y - intro.y)).toBeLessThan(2);
    } else {
      expect(gallery.y).toBeGreaterThan(intro.y);
      expect(purchase.y).toBeGreaterThan(gallery.y);
    }
    await expect(page.locator(".detail-image img")).toHaveCSS(
      "object-fit",
      "contain",
    );
    await expect(page.locator(".product-story > div")).toHaveCSS(
      "border-top-width",
      "1px",
    );
    await expect(
      page.locator(".product-story > div > section").first(),
    ).toHaveCSS("border-top-width", "0px");
    await page.screenshot({
      path: `/tmp/bomish-product-${width}.png`,
      fullPage: true,
    });
  }
});

test("home product selection limits the showcase to twelve and persists display order", async ({
  page,
}) => {
  const products = Array.from({ length: 13 }, (_, i) => ({
    id: `p${i}`,
    name: `محصول ${i}`,
    status: "published",
    images: ["/images/spices.png"],
    outOfStock: i === 0,
  }));
  let ids: string[] = [];
  await page.route("**/api/v1/**", (route) => {
    const path = new URL(route.request().url()).pathname.replace("/api/v1", "");
    if (path === "/session")
      return route.fulfill({
        json: {
          csrf: "test",
          role: "editor",
          staffId: "editor",
          permissions: ["products"],
          authenticated: false,
        },
      });
    if (path === "/products") return route.fulfill({ json: products });
    if (path === "/staff/suggestions") {
      if (route.request().method() === "PUT")
        ids = route.request().postDataJSON().productIds;
      return route.fulfill({
        json:
          route.request().method() === "PUT"
            ? { ok: true }
            : ids.map((id) => products.find((p) => p.id === id)),
      });
    }
    return route.fulfill({ json: [] });
  });
  await page.goto("/staff?section=suggestions");
  for (let i = 0; i < 12; i++)
    await page.locator(".suggestion-results button").first().click();
  await expect(page.locator(".suggestion-list li")).toHaveCount(12);
  await expect(page.locator(".suggestion-results button")).toBeDisabled();
  await expect(page.locator(".suggestion-list")).toContainText("ناموجود");
  await page
    .getByRole("button", { name: "محصول 1 بالاتر", exact: true })
    .click();
  await page
    .getByRole("button", { name: "ذخیره پیشنهادها", exact: true })
    .click();
  await expect(
    page.getByText("پیشنهادها ذخیره شدند.", { exact: true }),
  ).toBeVisible();
  expect(ids[0]).toBe("p1");
  await page.getByRole("button", { name: "حذف محصول 0", exact: true }).click();
  await expect(
    page.locator(".suggestion-results button").first(),
  ).toBeEnabled();
  await page.locator(".suggestion-results button").last().click();
  await page
    .getByRole("button", { name: "ذخیره پیشنهادها", exact: true })
    .click();
  await page.reload();
  await expect(page.locator(".suggestion-list li")).toHaveCount(12);
  await expect(page.locator(".suggestion-list li").first()).toContainText(
    "محصول 1",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow(page);
});
