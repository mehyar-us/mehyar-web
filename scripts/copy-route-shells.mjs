import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const distDir = 'dist/public';
const indexHtml = join(distDir, 'index.html');

if (!existsSync(indexHtml)) {
  throw new Error(`Missing build shell: ${indexHtml}`);
}

const appShell = readFileSync(indexHtml, 'utf8');

const portfolioRoutes = ['1', '2', '3', '4', '5', '6'].map((id) => `portfolio/${id}`);
const blogRoutes = [
  'small-business-tech-audit-revenue-leaks',
  'missed-calls-crm-follow-up',
  'when-to-build-custom-software',
].map((slug) => `blog/${slug}`);

const directRoutes = [
  'services',
  'portfolio',
  ...portfolioRoutes,
  'blog',
  ...blogRoutes,
  'newsletter',
  'free-checklist',
  'about',
  '330',
  'micro-offer',
  'booking',
  'book',
  'contact',
  'billing/checkout',
  'billing/success',
  'billing/cancel',
  'admin',
  'admin/newsletter',
  'admin/government',
  'admin/opportunity-scout',
  'admin/email',
  'admin/email/thread',
  'admin/analytics',
  'unsubscribe',
  'privacy-policy',
  'terms',
  'sitemap',
];

function routeShell(route) {
  if (!route.startsWith('admin')) return appShell;
  const title = route.startsWith('admin/email')
    ? 'Email Command Center | MehyarSoft'
    : route.startsWith('admin/newsletter')
      ? 'Newsletter Money Cockpit | MehyarSoft'
      : route.startsWith('admin/analytics')
        ? 'Analytics Dashboard | MehyarSoft'
        : route.startsWith('admin/government')
          ? 'Government Opportunities | MehyarSoft'
          : route.startsWith('admin/opportunity-scout')
            ? 'Opportunity Scout | MehyarSoft'
            : 'Admin Metrics | MehyarSoft';
  return appShell
    .replace(/<title>.*?<\/title>/, `<title>${title}</title>`)
    .replace(/<meta name="description" content="[^"]*" \/>/, '<meta name="description" content="Owner-only MehyarSoft admin area." />')
    .replace(/<meta name="robots" content="[^"]*" \/>/, '<meta name="robots" content="noindex,nofollow,noarchive" />')
    .replace(/<meta property="og:title" content="[^"]*" \/>/, `<meta property="og:title" content="${title}" />`)
    .replace(/<meta property="og:description" content="[^"]*" \/>/, '<meta property="og:description" content="Owner-only MehyarSoft admin area." />')
    .replace(/<meta property="og:url" content="[^"]*" \/>/, `<meta property="og:url" content="https://mehyar.us/${route}" />`)
    .replace(/<meta name="twitter:title" content="[^"]*" \/>/, `<meta name="twitter:title" content="${title}" />`)
    .replace(/<meta name="twitter:description" content="[^"]*" \/>/, '<meta name="twitter:description" content="Owner-only MehyarSoft admin area." />')
    .replace(/<link rel="canonical" href="[^"]*" \/>/, `<link rel="canonical" href="https://mehyar.us/${route}" />`);
}

for (const route of directRoutes) {
  const target = join(distDir, route, 'index.html');
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, routeShell(route));
}

// Static hosts return /404.html for unknown routes; make it a noindex app shell so
// the client router can still render the matching private route or branded 404
// without exposing indexable home-page metadata on unknown/admin deep links.
writeFileSync(join(distDir, '404.html'), routeShell('admin/email/thread'));

console.log(`Copied app shell for ${directRoutes.length} clean direct routes plus 404 fallback.`);
