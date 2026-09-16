import { readFile } from "node:fs/promises";
import { chromium } from "@playwright/test";

// Rasterize our own vector brand mark into installable PWA icon sizes.
const svg = await readFile(
  new URL("../public/icon.svg", import.meta.url),
  "utf8",
);
const browser = await chromium.launch();
try {
  for (const size of [192, 512]) {
    const page = await browser.newPage({
      viewport: { width: size, height: size },
      deviceScaleFactor: 1,
    });
    await page.setContent(
      `<style>html,body{margin:0;width:100%;height:100%;background:#1d4336}svg{width:100%;height:100%}</style>${svg}`,
    );
    await page.screenshot({
      path: new URL(
        `../public/icon-${size}.png`,
        import.meta.url,
      ).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
    });
    await page.close();
  }
} finally {
  await browser.close();
}
