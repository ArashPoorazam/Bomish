import { expect, request, type APIRequestContext } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resetBrowserAuthLimits } from "./staff-login";
import type { Product, ShippingConfig } from "../src/lib/types";

export const commerceAddress = {
  recipient: "خریدار آزمایشی",
  phone: "09121234567",
  province: "البرز",
  city: "کرج",
  provinceId: "alborz-province",
  cityId: "karaj-city",
  street: "خیابان آزمایشی، پلاک ۱۲",
  postalCode: "1234567890",
};
export async function checked(
  client: APIRequestContext,
  path: string,
  method: string,
  data: unknown,
  headers: Record<string, string>,
) {
  const r = await client.fetch("/api/v1" + path, { method, data, headers });
  expect(r.ok(), await r.text()).toBeTruthy();
  return r.json();
}
// This fixture is only for the disposable simulation database used by the browser suite.
export async function prepareCommerce(baseURL: string, slug: string) {
  if (!process.env.DATABASE_URL || process.env.STORE_MODE !== "simulation")
    throw new Error(
      "Commerce browser tests require STORE_MODE=simulation and a disposable DATABASE_URL",
    );
  resetBrowserAuthLimits();
  const admin = await request.newContext({ baseURL });
  const directory = mkdtempSync(join(tmpdir(), "bomish-commerce-"));
  try {
    const session = await (
      await admin.get("/api/v1/session?workspace=staff")
    ).json();
    const headers = { Origin: baseURL, "X-CSRF-Token": session.csrf };
    await checked(
      admin,
      "/staff/login",
      "POST",
      { username: "manager", password: "Bomish-demo-2026!" },
      headers,
    );
    const product: Product = await (
      await admin.get("/api/v1/products/" + slug)
    ).json();
    product.packages = product.packages.map((p) => ({
      ...p,
      lengthMm: 80,
      widthMm: 80,
      heightMm: 100,
      shippingGrams: 1500,
      shippingVerified: true,
    }));
    await checked(
      admin,
      "/staff/products/" + product.id,
      "PUT",
      product,
      headers,
    );
    await checked(
      admin,
      "/staff/products/" + product.id + "/publish",
      "POST",
      undefined,
      headers,
    );
    const config: ShippingConfig = await (
      await admin.get("/api/v1/staff/shipping")
    ).json();
    config.origin = {
      ...commerceAddress,
      id: "",
      latitude: 35.7,
      longitude: 51.4,
      pinConfirmed: true,
    };
    config.boxes = [
      {
        id: "browser-commerce",
        name: "کارتن آزمایشی",
        inside: { lengthMm: 400, widthMm: 400, heightMm: 400 },
        outside: { lengthMm: 432, widthMm: 432, heightMm: 432 },
        emptyGrams: 100,
        fillerGrams: 0,
        insetMm: 10,
        maxGrams: 30000,
        postalSizeId: "1",
        active: true,
        verified: true,
      },
    ];
    await checked(admin, "/staff/shipping", "PUT", config, headers);
    const file = join(directory, "shipping.json");
    writeFileSync(
      file,
      JSON.stringify({
        localities: [
          {
            id: "karaj-city",
            provinceId: "alborz-province",
            province: "البرز",
            city: "کرج",
            tapinProvince: "2",
            tapinCity: "2",
            verified: true,
          },
        ],
        snapp: { ...config.snapp, enabled: false },
        tapin: {
          ...config.tapin,
          enabled: true,
          verified: true,
          service: "0",
          shopId: "sim-shop",
          currency: "rial",
          maxGrams: 30000,
          maxSize: { lengthMm: 1000, widthMm: 1000, heightMm: 1000 },
        },
        postalBoxSizes: { "browser-commerce": "1" },
      }),
    );
    execFileSync("go", ["run", "./cmd/server", "apply-shipping-config"], {
      cwd: "../backend",
      env: {
        ...process.env,
        APP_ENV: "development",
        SEED_DEMO: "false",
        SHIPPING_SIMULATED: "true",
        SHIPPING_CONFIG_FILE: file,
      },
    });
  } finally {
    await admin.dispose();
    rmSync(directory, { recursive: true, force: true });
  }
}
export async function payCart(client: APIRequestContext, origin: string) {
  const session = await (await client.get("/api/v1/session")).json();
  const headers = { Origin: origin, "X-CSRF-Token": session.csrf };
  const q = await checked(
    client,
    "/checkout/quote",
    "POST",
    { address: commerceAddress, method: "post" },
    headers,
  );
  const order = await checked(
    client,
    "/checkout",
    "POST",
    {
      address: commerceAddress,
      method: q.method,
      shippingQuoteId: q.shippingQuoteId,
      expectedTotalRials: q.totalRials,
      idempotencyKey: crypto.randomUUID(),
    },
    headers,
  );
  await checked(
    client,
    "/orders/" + order.orderId + "/simulate",
    "POST",
    { success: true },
    headers,
  );
  return order.orderId as string;
}
export async function completePostal(
  client: APIRequestContext,
  origin: string,
  id: string,
  received = true,
) {
  const session = await (
    await client.get("/api/v1/session?workspace=staff")
  ).json();
  const headers = { Origin: origin, "X-CSRF-Token": session.csrf };
  const order = await (await client.get("/api/v1/staff/orders/" + id)).json();
  for (const item of order.items)
    await checked(
      client,
      "/staff/orders/" + id + "/packing",
      "PATCH",
      { productId: item.productId, packageId: item.packageId, packed: true },
      headers,
    );
  let delivery = await (
    await client.get("/api/v1/staff/orders/" + id + "/delivery")
  ).json();
  delivery = await checked(
    client,
    "/staff/orders/" + id + "/parcels",
    "PUT",
    {
      version: delivery.version,
      parcels: delivery.parcels.map((p: { grossGrams: number }) => ({
        ...p,
        confirmed: true,
        measuredGrams: p.grossGrams,
      })),
      reason: "Verified browser fixture",
    },
    headers,
  );
  delivery = await checked(
    client,
    "/staff/orders/" + id + "/ready",
    "POST",
    { version: delivery.version },
    headers,
  );
  for (const parcel of delivery.parcels)
    delivery = await checked(
      client,
      "/staff/orders/" + id + "/parcels/" + parcel.id,
      "PATCH",
      { version: delivery.version, tracking: "123456789012345678901234" },
      headers,
    );
  await checked(
    client,
    "/staff/orders/" + id,
    "PATCH",
    { status: "shipped" },
    headers,
  );
  if (received)
    await checked(
      client,
      "/staff/orders/" + id,
      "PATCH",
      { status: "received" },
      headers,
    );
}
