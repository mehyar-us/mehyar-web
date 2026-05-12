import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';

const base = process.env.QA_BASE || 'http://127.0.0.1:4176';
const outDir = process.env.QA_OUT || path.resolve('qa-artifacts/hot-zero-' + new Date().toISOString().replace(/[:.]/g, '-'));
const routes = ['/', '/services', '/portfolio', '/blog', '/about', '/contact', '/admin', '/unsubscribe', '/privacy-policy', '/terms', '/sitemap', '/does-not-exist-hot-zero'];
const contexts = [
  { name: 'desktop-light', width: 1440, height: 1000, dark: false },
  { name: 'desktop-dark', width: 1440, height: 1000, dark: true },
  { name: 'mobile-light', width: 390, height: 844, dark: false },
  { name: 'mobile-dark', width: 390, height: 844, dark: true },
  { name: 'tablet-light', width: 820, height: 1180, dark: false },
];

await fs.mkdir(outDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];
const assetChecks = [];

for (const ctx of contexts) {
  const context = await browser.newContext({ viewport: { width: ctx.width, height: ctx.height }, deviceScaleFactor: 1, colorScheme: ctx.dark ? 'dark' : 'light' });
  await context.addInitScript((dark) => {
    localStorage.setItem('darkMode', dark ? 'true' : 'false');
    const applyTheme = () => document.documentElement?.classList.toggle('dark', dark);
    if (document.documentElement) applyTheme();
    else document.addEventListener('DOMContentLoaded', applyTheme, { once: true });
  }, ctx.dark);
  const page = await context.newPage();
  const events = [];
  page.on('console', msg => {
    if (['error', 'warning'].includes(msg.type())) events.push({ type: msg.type(), text: msg.text().slice(0, 500) });
  });
  page.on('pageerror', err => events.push({ type: 'pageerror', text: err.message.slice(0, 500) }));
  page.on('response', async (response) => {
    const url = response.url();
    if (url.startsWith(base) && /\.(js|css|svg|png|jpg|webp|ico)($|\?)/.test(url)) {
      assetChecks.push({ url: url.replace(base, ''), status: response.status(), type: response.headers()['content-type'] || '' });
    }
  });
  for (const route of routes) {
    events.length = 0;
    const res = await page.goto(base + route, { waitUntil: 'networkidle', timeout: 30000 }).catch(e => ({ status: () => 0, error: e.message }));
    await page.waitForTimeout(400);
    const title = await page.title().catch(() => '');
    const h1 = await page.locator('h1').first().innerText({ timeout: 3000 }).catch(() => 'NO_H1');
    const bodyText = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '');
    const htmlClasses = await page.evaluate(() => document.documentElement.className).catch(() => '');
    const metaRobots = await page.locator('meta[name="robots"]').getAttribute('content').catch(() => null);
    const filename = `${ctx.name}__${route === '/' ? 'home' : route.replaceAll('/', '_').replace(/^_/, '')}.png`;
    await page.screenshot({ path: path.join(outDir, filename), fullPage: true });
    results.push({ context: ctx.name, route, status: typeof res.status === 'function' ? res.status() : 0, title, h1, htmlClasses, metaRobots, textSample: bodyText.slice(0, 300), console: [...events], screenshot: filename });
  }
  await context.close();
}
await browser.close();

const uniqueAssets = Array.from(new Map(assetChecks.map(a => [a.url, a])).values()).sort((a,b)=>a.url.localeCompare(b.url));
await fs.writeFile(path.join(outDir, 'report.json'), JSON.stringify({ base, outDir, results, assets: uniqueAssets }, null, 2));
console.log(JSON.stringify({ outDir, count: results.length, failingConsole: results.filter(r=>r.console.length), badAssets: uniqueAssets.filter(a => a.status >= 400 || (a.status !== 304 && !/javascript|css|svg|png|jpeg|webp|icon|html/.test(a.type))) }, null, 2));
