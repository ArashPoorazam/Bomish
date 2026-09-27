import type { Page } from "@playwright/test";
import { createHmac } from "node:crypto";
function totp() {
  let bits = "";
  for (const c of "JBSWY3DPEHPK3PXP")
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
export async function loginStaff(page: Page, role: "owner" | "editor") {
  await page.getByLabel("نام کاربری", { exact: true }).fill(role);
  await page.getByLabel("گذرواژه", { exact: true }).fill("Bomish-demo-2026!");
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.getByLabel("کد برنامه رمزساز", { exact: true }).fill(totp());
    const response = page.waitForResponse(
      (r) =>
        r.url().endsWith("/staff/login") && r.request().method() === "POST",
    );
    await page.getByRole("button", { name: "ورود به فضای کار" }).click();
    const result = await response;
    if (result.ok()) return;
    const body = await result.json();
    if (
      result.status() !== 401 ||
      !String(body.error).includes("قبلاً") ||
      attempt > 0
    )
      throw new Error(body.error || "Staff login failed");
    // Fixture accounts reject reuse of a TOTP across tests. Wait for a fresh code.
    await new Promise((resolve) =>
      setTimeout(resolve, 30100 - (Date.now() % 30000)),
    );
  }
}
