import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const output = new URL("../artifacts/", import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  await page.goto("http://127.0.0.1:5174", { waitUntil: "networkidle" });
  const session = await page.request.get("http://127.0.0.1:5174/api/session");
  const capabilities = await page.request.get(
    "http://127.0.0.1:5174/api/auth/capabilities",
  );
  const sessionData = await session.json();
  if (sessionData.user !== null)
    throw new Error(
      "Capture intentionally limited to unauthenticated local screen.",
    );
  const providerData = await capabilities.json();
  await page.getByRole("button", { name: "Continue with Google" }).waitFor();
  await page.screenshot({
    path: fileURLToPath(new URL("local-sign-in-desktop.png", output)),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: fileURLToPath(new URL("local-sign-in-mobile.png", output)),
    fullPage: true,
  });
  await writeFile(
    new URL("local-capture.json", output),
    JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        kind: "actual local app and local Worker, no API interception",
        sessionStatus: session.status(),
        authenticated: false,
        providers: Object.fromEntries(
          Object.entries(providerData.providers).map(([name, value]) => [
            name,
            { configured: value.configured },
          ]),
        ),
        providerAuthorizationTested: false,
      },
      null,
      2,
    ),
  );
  console.log(
    "Captured actual local unauthenticated app; no fixture API or provider authorization used.",
  );
} finally {
  await browser.close();
}
