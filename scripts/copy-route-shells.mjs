import { mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

const distDir = 'dist/public';
const indexHtml = join(distDir, 'index.html');

if (!existsSync(indexHtml)) {
  throw new Error(`Missing build shell: ${indexHtml}`);
}

const directRoutes = [
  'services',
  'portfolio',
  'blog',
  'about',
  'contact',
  'admin',
  'unsubscribe',
  'privacy-policy',
  'terms',
  'sitemap',
];

for (const route of directRoutes) {
  const target = join(distDir, route, 'index.html');
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(indexHtml, target);
}

// Static hosts return /404.html for unknown routes; make it the app shell so
// the client router can render the branded noindex 404 page instead of a
// dead static error page. The HTTP status may still be host-controlled.
copyFileSync(indexHtml, join(distDir, '404.html'));

console.log(`Copied app shell for ${directRoutes.length} clean direct routes plus 404 fallback.`);
