import type { Page, APIRequestContext } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
// Many independent browser journeys authenticate from the same IP. Reset only
// their authentication counters in an explicitly opted-in disposable database.
// Rate-limit enforcement itself is covered by backend integration tests.
export function resetBrowserAuthLimits() {
  if (process.env.E2E_ISOLATED_DATABASE !== "true") return;
  const database = new URL(process.env.DATABASE_URL || "");
  if (
    !["localhost", "127.0.0.1"].includes(database.hostname) ||
    !database.pathname.startsWith("/bomish_browser")
  )
    throw new Error(
      "Browser auth reset requires a local bomish_browser database",
    );
  execFileSync(
    "psql",
    [
      "-X",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      "DELETE FROM rate_limits WHERE key LIKE 'staff-%' OR key LIKE 'owner-totp%'",
    ],
    {
      env: {
        ...process.env,
        PGHOST: database.hostname,
        PGPORT: database.port || "5432",
        PGUSER: decodeURIComponent(database.username),
        PGPASSWORD: decodeURIComponent(database.password),
        PGDATABASE: database.pathname.slice(1),
        PGSSLMODE: "disable",
      },
      stdio: "pipe",
    },
  );
}
export function totp(secret = "JBSWY3DPEHPK3PXP") {
  let bits = "";
  for (const c of secret)
    bits += "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
      .indexOf(c)
      .toString(2)
      .padStart(5, "0");
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const digest = createHmac("sha1", key).update(counter).digest();
  return String(
    (digest.readUInt32BE(digest[19] & 15) & 0x7fffffff) % 1000000,
  ).padStart(6, "0");
}
export async function loginStaff(
  page: Page,
  role: "owner" | "editor" | "operator",
) {
  resetBrowserAuthLimits();
  await page.getByLabel("نام کاربری", { exact: true }).fill(role);
  await page.getByLabel("گذرواژه", { exact: true }).fill("Bomish-demo-2026!");
  const signedIn = page.waitForResponse(
    (r) => r.url().endsWith("/staff/login") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "ورود به فضای کار" }).click();
  const login = await signedIn;
  if (!login.ok()) throw new Error(await login.text());
  await page.waitForURL("**/staff");
  if (role === "owner") {
    await page.goto("/omnisire");
    for (let attempt = 0; attempt < 2; attempt++) {
      await page.getByLabel("کد برنامه رمزساز", { exact: true }).fill(totp());
      const response = page.waitForResponse(
        (r) =>
          r.url().endsWith("/omnisire/unlock") &&
          r.request().method() === "POST",
      );
      await page
        .getByRole("button", { name: "ورود به امنی‌سایر", exact: true })
        .click();
      const result = await response;
      if (result.ok()) {
        await page.goto("/staff");
        return;
      }
      if (result.status() !== 401 || attempt > 0)
        throw new Error(await result.text());
      await new Promise((resolve) =>
        setTimeout(resolve, 30100 - (Date.now() % 30000)),
      );
    }
  }
}

export async function loginStaffAPI(
  request: APIRequestContext,
  origin: string,
  role: "owner" | "editor" | "operator",
) {
  resetBrowserAuthLimits();
  const session = await (
    await request.get("/api/v1/session?workspace=staff")
  ).json();
  const headers = { Origin: origin, "X-CSRF-Token": session.csrf };
  const login = await request.post("/api/v1/staff/login", {
    headers,
    data: { username: role, password: "Bomish-demo-2026!" },
  });
  if (!login.ok()) throw new Error(await login.text());
  if (role !== "owner") return headers;
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await request.post("/api/v1/omnisire/unlock", {
      headers,
      data: { code: totp() },
    });
    if (result.ok()) return headers;
    if (result.status() !== 401 || attempt > 0)
      throw new Error(await result.text());
    await new Promise((resolve) =>
      setTimeout(resolve, 30100 - (Date.now() % 30000)),
    );
  }
  throw new Error("Owner unlock failed");
}
