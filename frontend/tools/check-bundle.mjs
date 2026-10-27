import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { gzipSync } from "node:zlib";

// Initial HTML assets only: optional chunks are covered by browser journeys.
// Run against `npm run build && npm run start`, never the dev server.
const origin = process.env.BASE_URL || "http://localhost:3000";
const output = resolve(process.env.BOMISH_DIST_DIR || ".next");
await readFile(resolve(output, "BUILD_ID"));
const budgets = {
  "/about": { js: 212_000, css: 19_000 },
  "/account": { js: 225_000, css: 22_000 },
  "/staff": { js: 225_000, css: 23_000 },
};
let failed = false;
for (const [route, limits] of Object.entries(budgets)) {
  const response = await fetch(new URL(route, origin), {
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`${route}: HTTP ${response.status}`);
  const html = await response.text();
  const assets = [
    ...new Set(
      [...html.matchAll(/(?:src|href)="([^"?]+\.(?:js|css))(?:\?[^" ]*)?"/g)]
        .map((match) => match[1])
        .filter((asset) => asset.startsWith("/_next/")),
    ),
  ];
  const totals = { js: 0, css: 0 };
  for (const asset of assets) {
    const file = resolve(output, asset.slice("/_next/".length));
    if (!file.startsWith(output + sep)) throw new Error("Invalid asset path");
    const type = asset.endsWith(".js") ? "js" : "css";
    totals[type] += gzipSync(await readFile(file)).length;
  }
  for (const type of ["js", "css"]) {
    const pass = totals[type] > 0 && totals[type] <= limits[type];
    failed ||= !pass;
    console.log(
      `${pass ? "PASS" : "FAIL"} ${route} ${type}: ${totals[type]} gzip bytes (budget ${limits[type]})`,
    );
  }
}
if (failed) process.exitCode = 1;
