import { test, expect, type Page } from "@playwright/test";
const legacy = {
  id: "legacy-demo",
  slug: "legacy-demo",
  name: "زیره آزمایشی",
  categoryId: "spices",
  status: "published",
  packages: [
    {
      id: "legacy",
      amount: 100,
      unit: "g",
      priceRials: 1800000,
      maxQuantity: 5,
      shippingGrams: 0,
    },
  ],
  sections: null,
  images: ["/images/spices.png"],
  tags: null,
  aliases: null,
  relatedIds: null,
  nutrients: null,
  summary: "خلاصه محصول نمونه",
  description: "معرفی محصول",
  uses: "",
  preparation: "",
  storage: "",
  ingredients: "",
  allergens: "",
  nutrientSource: "",
  discountPercent: 0,
  popularity: 0,
  priceRials: 0,
  minGrams: 100,
  stepGrams: 100,
  maxGrams: 25000,
  outOfStock: false,
};
async function workspace(page: Page) {
  const saved: Record<string, unknown>[] = [];
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace("/api/v1", "");
    if (
      route.request().method() === "PUT" &&
      path.startsWith("/staff/products/")
    ) {
      saved.push(route.request().postDataJSON());
      return route.fulfill({ json: { ok: true } });
    }
    const data: Record<string, unknown> = {
      "/session": {
        csrf: "test",
        role: "owner",
        omnisireVerified: true,
        staffId: "owner",
        permissions: [
          "products",
          "articles",
          "categories",
          "pricing",
          "orders",
          "shipping",
          "sales",
          "omnisire",
        ],
      },
      "/cart": { items: [], subtotalRials: 0 },
      "/staff/products": { items: [legacy], total: 1, page: 1, pageSize: 25 },
      "/staff/product-packaging": [],
      "/staff/product-options": new URL(route.request().url()).searchParams.has(
        "page",
      )
        ? { items: [legacy], total: 1, page: 1, pageSize: 25 }
        : [legacy],
      "/categories": [{ id: "spices", name: "ادویه‌ها", description: "" }],
      "/staff/articles": { items: [], total: 0, page: 1, pageSize: 25 },
      "/staff/orders": [],
      "/staff/members": [],
      "/staff/audit": [],
      "/staff/shipping": {},
    };
    const params = new URL(route.request().url()).searchParams;
    const response = data[path];
    if (
      params.has("page") &&
      response &&
      typeof response === "object" &&
      "items" in response
    ) {
      const paged = response as {
        items: Record<string, unknown>[];
        total: number;
      };
      const query = params.get("q") || "",
        status = params.get("status") || "";
      const items = paged.items.filter(
        (item) =>
          (!query || JSON.stringify(item).includes(query)) &&
          (!status || item.status === status),
      );
      return route.fulfill({ json: { ...paged, items, total: items.length } });
    }
    return route.fulfill({ json: data[path] ?? { ok: true } });
  });
  await page.goto("/staff");
  return saved;
}
async function step(page: Page, name: string) {
  await page
    .getByRole("navigation", { name: "مراحل محصول" })
    .getByRole("button", { name })
    .click();
}
test("packaging selector calculates gross weight and requires measured liquid weight", async ({
  page,
}) => {
  const saved = await workspace(page);
  await page.route("**/api/v1/staff/product-packaging", (route) =>
    route.fulfill({
      json: [
        {
          id: "jar",
          name: "شیشه",
          emptyGrams: 150,
          lengthMm: 80,
          widthMm: 80,
          heightMm: 100,
          volumeCm3: 640,
        },
      ],
    }),
  );
  await page.getByRole("button", { name: "ویرایش", exact: true }).click();
  await step(page, "بسته‌ها");
  await expect(
    page.getByRole("region", { name: "اندازه و وزن ارسال" }),
  ).toHaveCount(0);
  await expect(
    page.getByLabel("وزن بسته آماده ارسال (گرم)", { exact: true }),
  ).toHaveCount(0);
  await page.getByLabel("بسته‌بندی محصول", { exact: true }).selectOption("jar");
  await expect(page.getByText("وزن ارسال:")).toContainText("۲۵۰");
  await page.getByLabel("مقدار محتویات", { exact: true }).fill("500");
  await expect(page.getByText("وزن ارسال:")).toContainText("۶۵۰");
  await page.getByLabel("واحد", { exact: true }).selectOption("l");
  await page.getByLabel("مقدار محتویات", { exact: true }).fill("0.5");
  await page.getByLabel("وزن خالص محصول (گرم)", { exact: true }).fill("");
  await page
    .getByRole("button", { name: "ذخیره پیش‌نویس", exact: true })
    .click();
  expect(saved).toHaveLength(0);
  await page.getByLabel("وزن خالص محصول (گرم)", { exact: true }).fill("450");
  await expect(page.getByText("وزن ارسال:")).toContainText("۶۰۰");
  await page
    .getByRole("button", { name: "ذخیره پیش‌نویس", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "پیش‌نویس ذخیره شد" }),
  ).toBeVisible();
  expect(saved[0]).toMatchObject({
    packages: [
      {
        packagingId: "jar",
        netGrams: 450,
        shippingGrams: 600,
        lengthMm: 80,
        widthMm: 80,
        heightMm: 100,
      },
    ],
  });
  await page.getByRole("button", { name: "ادامه ویرایش" }).click();
  await page.getByLabel("بسته‌بندی محصول", { exact: true }).selectOption("");
  await expect(page.getByText("وزن ارسال:")).toHaveCount(0);
  await page
    .getByRole("button", { name: "ذخیره پیش‌نویس", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "پیش‌نویس ذخیره شد" }),
  ).toBeVisible();
  expect(saved[1]).toMatchObject({
    packages: [
      {
        packagingId: "",
        shippingGrams: 0,
        lengthMm: 0,
        widthMm: 0,
        heightMm: 0,
        shippingVerified: false,
      },
    ],
  });
  expect(
    (saved[1].packages as Record<string, unknown>[])[0],
  ).not.toHaveProperty("packaging");
  expect(
    (saved[1].packages as Record<string, unknown>[])[0],
  ).not.toHaveProperty("netGrams");
});

test("staff define and edit reusable packaging under store management", async ({
  page,
}) => {
  await workspace(page);
  let items: Record<string, unknown>[] = [];
  await page.route("**/api/v1/staff/product-packaging**", async (route) => {
    if (route.request().method() === "PUT") {
      const item = route.request().postDataJSON();
      items = [...items.filter((previous) => previous.id !== item.id), item];
      return route.fulfill({ json: item });
    }
    return route.fulfill({ json: items });
  });
  await page
    .getByRole("navigation", { name: "ناوبری فضای کار" })
    .getByRole("button", { name: "بسته‌بندی‌ها", exact: true })
    .click();
  await page
    .getByRole("button", { name: "افزودن بسته‌بندی", exact: true })
    .click();
  await page.getByLabel("نام بسته‌بندی", { exact: true }).fill("شیشه عسل");
  await page.getByLabel("وزن بسته‌بندی خالی (گرم)").fill("150");
  await page.getByLabel("طول بیرونی (سانتی‌متر)").fill("8");
  await page.getByLabel("عرض بیرونی (سانتی‌متر)").fill("8");
  await page.getByLabel("ارتفاع بیرونی (سانتی‌متر)").fill("10");
  await page.getByRole("button", { name: "محاسبه حجم از ابعاد" }).click();
  await expect(page.getByLabel("حجم (سانتی‌متر مکعب)")).toHaveValue("640");
  await page
    .getByRole("button", { name: "ذخیره بسته‌بندی", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("بسته‌بندی ذخیره شد.");
  expect(items).toHaveLength(1);
  expect(items[0]).toMatchObject({
    name: "شیشه عسل",
    emptyGrams: 150,
    lengthMm: 80,
    widthMm: 80,
    heightMm: 100,
    volumeCm3: 640,
  });
  await page.getByRole("button", { name: "ویرایش شیشه عسل" }).click();
  await page.getByLabel("وزن بسته‌بندی خالی (گرم)").fill("200");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/packaging-mobile.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "ذخیره بسته‌بندی", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("بسته‌بندی ذخیره شد.");
  expect(items).toHaveLength(1);
  expect(items[0].emptyGrams).toBe(200);
});
test("packaging filters, impact preview, failed saves and keyboard dismissal preserve edits", async ({
  page,
}) => {
  await workspace(page);
  const items = [
    {
      id: "jar",
      name: "شیشه عسل",
      emptyGrams: 150,
      lengthMm: 80,
      widthMm: 80,
      heightMm: 100,
      volumeCm3: 640,
      usedByProducts: 2,
    },
    {
      id: "pouch",
      name: "پاکت ادویه",
      emptyGrams: 10,
      lengthMm: 100,
      widthMm: 30,
      heightMm: 150,
      volumeCm3: 450,
      usedByProducts: 0,
    },
  ];
  await page.route("**/api/v1/staff/product-packaging**", async (route) => {
    if (route.request().method() === "PUT")
      return route.fulfill({
        status: 422,
        json: { error: "وزن یکی از محصولات بیش از حد مجاز است" },
      });
    return route.fulfill({ json: items });
  });
  await page
    .getByRole("navigation", { name: "ناوبری فضای کار" })
    .getByRole("button", { name: "بسته‌بندی‌ها", exact: true })
    .click();
  await expect(page.locator(".packaging-card")).toHaveCount(2);
  await page.getByLabel("جستجوی بسته‌بندی", { exact: true }).fill("پاکت");
  await expect(page.locator(".packaging-card")).toHaveCount(1);
  await expect(page.locator(".packaging-card")).toContainText("پاکت ادویه");
  await page.getByLabel("جستجوی بسته‌بندی", { exact: true }).fill("");
  await page.getByRole("button", { name: "در حال استفاده" }).click();
  await expect(page.locator(".packaging-card")).toHaveCount(1);
  await page.getByRole("button", { name: "ویرایش شیشه عسل" }).click();
  const editor = page.getByRole("dialog", {
    name: "ویرایش بسته‌بندی",
    exact: true,
  });
  await expect(page.getByLabel("نام بسته‌بندی", { exact: true })).toBeFocused();
  await expect(editor).toContainText("۲ محصول به‌روز می‌شود");
  await expect(
    editor.getByRole("button", { name: "ذخیره بسته‌بندی", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("وزن بسته‌بندی خالی (گرم)").fill("200");
  await editor
    .getByRole("button", { name: "ذخیره بسته‌بندی", exact: true })
    .click();
  await expect(editor.getByRole("alert")).toBeFocused();
  await expect(editor.getByRole("alert")).toContainText("وزن یکی از محصولات");
  await expect(page.getByLabel("وزن بسته‌بندی خالی (گرم)")).toHaveValue("200");
  await page.keyboard.press("Tab");
  expect(
    await editor.evaluate((element) =>
      element.contains(document.activeElement),
    ),
  ).toBe(true);
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.keyboard.press("Escape");
  await expect(editor).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.keyboard.press("Escape");
  await expect(editor).not.toBeVisible();
  await expect(page.locator(".packaging-card")).toContainText("۱۵۰");
});

test("legacy null lists open, step state persists, drafts save, and mobile layout fits", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const saved = await workspace(page);
  await page.getByRole("button", { name: "ویرایش", exact: true }).click();
  await expect(page.getByLabel("نام محصول", { exact: true })).toHaveValue(
    legacy.name,
  );
  await page.getByLabel("نام محصول", { exact: true }).fill("زیره ویرایش‌شده");
  await step(page, "اطلاعات تکمیلی");
  await page.getByText("برچسب‌ها و نام‌های جستجو", { exact: true }).click();
  await page
    .getByLabel("برچسب‌ها (با ویرگول جدا کنید)")
    .pressSequentially("ادویه، آشپزی");
  await step(page, "بسته‌ها");
  const price = page.getByLabel("قیمت بسته (تومان)", { exact: true });
  await price.fill("۱٬۲۳۴٬۵۶۷");
  await expect(price).toHaveValue("1,234,567");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("button", { name: "حذف بسته", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/product-packages-mobile.png",
    fullPage: true,
  });
  await step(page, "اطلاعات اصلی");
  await expect(page.getByLabel("نام محصول", { exact: true })).toHaveValue(
    "زیره ویرایش‌شده",
  );
  await page
    .getByRole("button", { name: "ذخیره پیش‌نویس", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "پیش‌نویس ذخیره شد" }),
  ).toBeVisible();
  expect(saved[0]).toMatchObject({
    name: "زیره ویرایش‌شده",
    tags: ["ادویه", "آشپزی"],
    packages: [{ ...legacy.packages[0], priceRials: 12345670 }],
  });
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "ذخیره پیش‌نویس", exact: true }),
  ).toBeFocused();
  expect(errors).toEqual([]);
});
test("new drafts can be incomplete; publishing leads to the missing step", async ({
  page,
}) => {
  const saved = await workspace(page);
  await page.getByRole("button", { name: "افزودن محصول", exact: true }).click();
  await page.getByLabel("نام محصول", { exact: true }).fill("محصول جدید");
  await page.getByLabel("نشانی صفحه", { exact: true }).fill("new-product");
  await page.getByLabel("دسته‌بندی", { exact: true }).selectOption("spices");
  await page
    .getByRole("button", { name: "ذخیره پیش‌نویس", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "پیش‌نویس ذخیره شد" }),
  ).toBeVisible();
  expect(saved[0]).toMatchObject({ summary: "", packages: [], images: [] });
  await page.getByRole("button", { name: "ادامه ویرایش" }).click();
  await expect(
    page.getByRole("button", { name: "پیش‌نمایش", exact: true }),
  ).toHaveCount(0);
  await step(page, "بررسی و انتشار");
  await page.getByRole("button", { name: "پیش‌نمایش", exact: true }).click();
  await expect(page.locator("#product-preview")).toContainText("محصول جدید");
  await page
    .getByRole("button", { name: "ذخیره و انتشار", exact: true })
    .click();
  await expect(
    page.locator(".product-wizard").getByRole("alert"),
  ).toContainText("خلاصه محصول");
  await expect(page.getByLabel("خلاصه محصول · برای انتشار")).toBeVisible();
  expect(saved).toHaveLength(1);
});
test("batch upload preserves successful images and retries only failures", async ({
  page,
}) => {
  await workspace(page);
  let uploads = 0;
  await page.route("**/api/v1/staff/uploads", async (route) => {
    uploads++;
    await route.fulfill(
      uploads === 2
        ? { status: 500, json: { error: "بارگذاری ناموفق" } }
        : { json: { url: "/images/spices.png" } },
    );
  });
  await page.getByRole("button", { name: "ویرایش", exact: true }).click();
  await step(page, "تصاویر");
  await page
    .getByLabel("بارگذاری تصاویر")
    .setInputFiles(["public/images/spices.png", "public/images/spices.png"]);
  await expect(
    page.locator(".product-wizard").getByRole("alert"),
  ).toContainText("تصاویر موفق حفظ شدند");
  await expect(page.locator(".product-image")).toHaveCount(2);
  await page
    .getByRole("button", { name: "تلاش دوباره برای تصاویر ناموفق" })
    .click();
  await expect(page.locator(".product-image")).toHaveCount(3);
  expect(uploads).toBe(3);
  await expect(page.locator(".product-wizard").getByRole("alert")).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "حذف تصویر 2", exact: true }).click();
  await expect(page.locator(".product-image")).toHaveCount(2);
});
test("publication failure reports the saved draft and preserves edits", async ({
  page,
}) => {
  const saved = await workspace(page);
  await page.route("**/api/v1/staff/product-packaging", (route) =>
    route.fulfill({
      json: [
        {
          id: "jar",
          name: "شیشه",
          emptyGrams: 150,
          lengthMm: 80,
          widthMm: 80,
          heightMm: 100,
          volumeCm3: 640,
        },
      ],
    }),
  );
  await page.route("**/api/v1/staff/products/*/publish", (route) =>
    route.fulfill({ status: 500, json: { error: "انتشار ناموفق" } }),
  );
  await page.getByRole("button", { name: "ویرایش", exact: true }).click();
  await step(page, "بسته‌ها");
  await page.getByLabel("بسته‌بندی محصول", { exact: true }).selectOption("jar");
  await step(page, "بررسی و انتشار");
  await page
    .getByRole("button", { name: "ذخیره و انتشار", exact: true })
    .click();
  await expect(
    page.locator(".product-wizard").getByRole("alert"),
  ).toContainText("پیش‌نویس ذخیره شد، اما انتشار انجام نشد");
  expect(saved).toHaveLength(1);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("filters reset and unsaved work is protected when leaving products", async ({
  page,
}) => {
  await workspace(page);
  const reset = page.getByRole("button", { name: "پاک کردن فیلترها" });
  await expect(reset).toBeDisabled();
  await page.getByLabel("جستجوی محصول", { exact: true }).fill("نام ناموجود");
  await expect(page.getByText("محصولی با این فیلترها پیدا نشد.")).toBeVisible();
  await reset.click();
  await page.getByRole("button", { name: "ویرایش", exact: true }).click();
  await page.getByLabel("نام محصول", { exact: true }).fill("تغییر ذخیره‌نشده");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "مجله", exact: true }).click();
  await expect(page.getByLabel("نام محصول", { exact: true })).toHaveValue(
    "تغییر ذخیره‌نشده",
  );
  await step(page, "بررسی و انتشار");
  await page.getByRole("button", { name: "پیش‌نمایش", exact: true }).click();
  await page
    .locator(".product-wizard")
    .screenshot({ path: "test-results/product-review-desktop.png" });
});

test("manual availability is independent of editor drafts and stock fields are gone", async ({
  page,
}) => {
  await workspace(page);
  const availability: unknown[] = [];
  await page.route("**/api/v1/staff/products/*/availability", async (route) => {
    availability.push(route.request().postDataJSON());
    await route.fulfill({ json: route.request().postDataJSON() });
  });
  await page.getByRole("button", { name: "ویرایش", exact: true }).click();
  await page.getByLabel("نام محصول", { exact: true }).fill("تغییر ذخیره‌نشده");
  await page.getByRole("button", { name: "ناموجود", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "ناموجود", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("نام محصول", { exact: true })).toHaveValue(
    "تغییر ذخیره‌نشده",
  );
  await expect(page.getByText("موجودی و انبار", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: "بایگانی محصول", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "موجود", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "موجود", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  expect(availability).toEqual([{ outOfStock: true }, { outOfStock: false }]);
});

test("legacy manual data is cleared and packaging is required before publication", async ({
  page,
}) => {
  const saved = await workspace(page);
  await page.route("**/api/v1/staff/products?**", (route) =>
    route.fulfill({
      json: {
        items: [
          {
            ...legacy,
            packages: [
              {
                ...legacy.packages[0],
                shippingGrams: 150,
                lengthMm: 80,
                widthMm: 80,
                heightMm: 100,
                shippingVerified: true,
              },
            ],
          },
        ],
        total: 1,
        page: 1,
        pageSize: 25,
      },
    }),
  );
  await page.reload();
  await page.getByRole("button", { name: "ویرایش", exact: true }).click();
  await step(page, "بسته‌ها");
  await expect(page.getByLabel("طول (سانتی‌متر)", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.getByText("اندازه و وزن ارسال", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("ابتدا در مدیریت فروشگاه", { exact: false }),
  ).toBeVisible();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const selling = await page.locator(".package-selling-fields").boundingBox();
    const packaging = await page
      .getByRole("region", { name: "انتخاب بسته‌بندی" })
      .boundingBox();
    const footer = await page.locator(".package-footer").boundingBox();
    expect(packaging!.y - selling!.y - selling!.height).toBeGreaterThanOrEqual(
      23,
    );
    expect(footer!.y - packaging!.y - packaging!.height).toBeGreaterThanOrEqual(
      23,
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: "test-results/packaging-only-" + width + ".png",
      fullPage: true,
    });
  }
  await page
    .getByRole("button", { name: "ذخیره پیش‌نویس", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "پیش‌نویس ذخیره شد" }),
  ).toBeVisible();
  expect(saved[0]).toMatchObject({
    packages: [
      {
        ...legacy.packages[0],
        shippingGrams: 0,
        lengthMm: 0,
        widthMm: 0,
        heightMm: 0,
        shippingVerified: false,
      },
    ],
  });
  expect(saved[0]).not.toHaveProperty("confirmMeasurements");
  await page.getByRole("button", { name: "ادامه ویرایش" }).click();
  await step(page, "بررسی و انتشار");
  await page
    .getByRole("button", { name: "ذخیره و انتشار", exact: true })
    .click();
  await expect(
    page.locator(".product-wizard").getByRole("alert"),
  ).toContainText("بسته‌بندی محصول را برای بسته 1 انتخاب کنید.");
  expect(saved).toHaveLength(1);
});

test("removing a middle variant preserves content amounts and numeric drafts", async ({
  page,
}) => {
  const saved = await workspace(page);
  await page.getByRole("button", { name: "ویرایش", exact: true }).click();
  await step(page, "بسته‌ها");
  await page.getByRole("button", { name: "افزودن بسته", exact: true }).click();
  await page.getByRole("button", { name: "افزودن بسته", exact: true }).click();
  const amounts = page.getByLabel("مقدار محتویات", { exact: true });
  await amounts.nth(0).fill("١٢٫٥");
  await amounts.nth(1).fill("۲۰");
  await amounts.nth(2).fill("۳۰");
  await page
    .getByRole("button", { name: "حذف بسته", exact: true })
    .nth(1)
    .click();
  await expect(amounts).toHaveCount(2);
  await expect(amounts.nth(0)).toHaveValue("12.5");
  await expect(amounts.nth(1)).toHaveValue("30");
  await page
    .getByRole("button", { name: "ذخیره پیش‌نویس", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  const packages = saved.at(-1)!.packages as { id: string; amount: number }[];
  expect(packages.map((pack) => pack.amount)).toEqual([12.5, 30]);
  expect(packages[0].id).toBe("legacy");
});

test("supplementary content previews only in the final step and reflects edits", async ({
  page,
}) => {
  await workspace(page);
  await page.getByRole("button", { name: "ویرایش", exact: true }).click();
  await step(page, "اطلاعات تکمیلی");
  await page
    .getByRole("button", { name: "+ افزودن بخش توضیحات", exact: true })
    .click();
  await page
    .getByLabel("عنوان بخش · انتخاب یا عنوان دلخواه")
    .fill("راهنمای دم کردن");
  await page
    .getByRole("textbox", { name: "متن بخش", exact: true })
    .fill("**آب گرم**\n\n- پنج دقیقه صبر کنید");
  await expect(page.locator(".product-step-fields .prose")).toHaveCount(0);
  await page
    .getByRole("button", { name: "+ افزودن بخش توضیحات", exact: true })
    .click();
  await page
    .getByLabel("عنوان بخش · انتخاب یا عنوان دلخواه")
    .nth(1)
    .fill("بخش خالی");
  await page
    .getByRole("navigation", { name: "مراحل محصول" })
    .getByRole("button")
    .last()
    .click();
  await page.getByRole("button", { name: "پیش‌نمایش", exact: true }).click();
  const preview = page.locator("#product-preview");
  await expect(
    preview.getByRole("heading", { name: "داستان این طعم", exact: true }),
  ).toBeVisible();
  const section = preview.locator("section").filter({
    has: page.getByRole("heading", { name: "راهنمای دم کردن", exact: true }),
  });
  await expect(section.locator("strong")).toHaveText("آب گرم");
  await expect(section.getByRole("listitem")).toHaveText("پنج دقیقه صبر کنید");
  await expect(
    preview.getByRole("heading", { name: "بخش خالی", exact: true }),
  ).toHaveCount(0);
  await step(page, "اطلاعات تکمیلی");
  await page
    .getByRole("textbox", { name: "متن بخش", exact: true })
    .first()
    .fill("متن تازه");
  await page
    .getByRole("textbox", { name: "متن بخش", exact: true })
    .first()
    .press("Tab");
  await expect(
    page.getByRole("textbox", { name: "متن بخش", exact: true }).first(),
  ).toHaveValue("متن تازه");
  await page
    .getByRole("navigation", { name: "مراحل محصول" })
    .getByRole("button")
    .last()
    .click();
  await expect(section).toContainText("متن تازه");
  await expect(
    preview.locator("strong").filter({ hasText: "آب گرم" }),
  ).toHaveCount(0);
});
