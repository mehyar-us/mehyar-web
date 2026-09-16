import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";

// Run against `npm run preview` after a build. Uses the real static production
// shell and service worker; API responses are not mocked or cached.
const browser = await chromium.launch();
const output = new URL("../artifacts/", import.meta.url);
await mkdir(output, { recursive: true });
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("http://127.0.0.1:4174", { waitUntil: "networkidle" });
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await page.reload({ waitUntil: "networkidle" });
  const beforeOffline = await page.evaluate(async () => {
    const names = await caches.keys();
    const entries = await Promise.all(names.map(async (name) => ({ name, urls: (await (await caches.open(name)).keys()).map((request) => request.url) })));
    return entries;
  });
  const cachedUrls = beforeOffline.flatMap((cache) => cache.urls);
  assert.ok(cachedUrls.some((url) => /\/assets\/.+\.js$/.test(url)), "JavaScript bundle must be available offline");
  assert.ok(cachedUrls.some((url) => /\/assets\/.+\.css$/.test(url)), "Styles must be available offline");
  assert.ok(cachedUrls.every((url) => { const parsed = new URL(url); return parsed.origin === "http://127.0.0.1:4174" && !parsed.pathname.startsWith("/api") && !parsed.pathname.includes("auth") && !parsed.search; }), "Only same-origin public shell assets may be cached");
  await context.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByText("You're offline.", { exact: false }).waitFor();
  await page.getByRole("button", { name: "Continue with Google" }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Continue with Google" }).isDisabled(), true);
  await page.screenshot({ path: fileURLToPath(new URL("production-shell-offline.png", output)), fullPage: true });
  await writeFile(new URL("pwa-verification.json", output), JSON.stringify({ checkedAt: new Date().toISOString(), productionShell: true, offlineReload: "passed", privateApiCache: "absent", cachedUrls, liveProviderAuthorizationTested: false }, null, 2));
  console.log("Production PWA check passed: offline reload, JS/CSS cache, no API/auth/query data cached.");
} finally { await browser.close(); }
