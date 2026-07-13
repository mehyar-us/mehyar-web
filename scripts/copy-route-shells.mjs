import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const distDir = 'dist/public';
const indexHtml = join(distDir, 'index.html');

if (!existsSync(indexHtml)) {
  throw new Error(`Missing build shell: ${distDir}/index.html`);
}

const appShell = readFileSync(indexHtml, 'utf8');

// Per-route metadata — mirrored from client/src/components/SeoManager.tsx
// (staticMeta). Keep these two files in sync when adding new routes.
// Why this exists: the Vite SPA serves the same index.html for every path,
// so search crawlers, social-card unfurlers, and link-preview tools that
// don't execute JS see the home page's <title>/<meta description>/canonical
// on every URL. This map rewrites those tags on the pre-rendered route
// shells emitted to dist/public/<route>/index.html so each deep link ships
// its own meta.
const routeMeta = {
  '/': {
    title: 'MehyarSoft LLC | NYC Software & AI Automation Consultant',
    description:
      'Founder-led software, systems, and AI automation consulting for local businesses and regulated teams losing leads to missed calls, weak websites, manual follow-up, and disconnected tools.',
  },
  '/services': {
    title: 'Services & Pricing | MehyarSoft Software Automation Consulting',
    description:
      'Explore MehyarSoft consulting offers: local business tech audits, website and booking cleanup, missed-call follow-up flows, internal automation sprints, systems integration, retainers, and custom software builds.',
    path: '/services',
  },
  '/portfolio': {
    title: 'Engagement Patterns | MehyarSoft Consulting Work Examples',
    description:
      'Review MehyarSoft engagement patterns for lead leak audits, missed-call follow-up, internal automation, regulated systems integration, website cleanup, and support retainers.',
    path: '/portfolio',
  },
  '/portfolio/1': {
    title: 'Local Business Lead Leak Audit | MehyarSoft Engagement Pattern',
    description:
      'A practical MehyarSoft audit pattern for finding website, phone, booking, and follow-up gaps in a local business before buying more software.',
    path: '/portfolio/1',
  },
  '/portfolio/2': {
    title: 'Missed-Call Follow-Up Flow | MehyarSoft Engagement Pattern',
    description:
      'A consent-safe MehyarSoft response workflow for prospects who call, submit a form, or need booking follow-up without losing the lead.',
    path: '/portfolio/2',
  },
  '/portfolio/3': {
    title: 'Internal Automation Sprint | MehyarSoft Engagement Pattern',
    description:
      'A focused MehyarSoft sprint to replace repetitive spreadsheet, inbox, and reporting work with a clean internal workflow.',
    path: '/portfolio/3',
  },
  '/portfolio/4': {
    title: 'Regulated Systems Integration Review | MehyarSoft Engagement Pattern',
    description:
      'Senior MehyarSoft systems review for teams that need safer architecture, cleaner integrations, and better operational control.',
    path: '/portfolio/4',
  },
  '/portfolio/5': {
    title: 'Website and Booking Cleanup | MehyarSoft Engagement Pattern',
    description:
      'A conversion-focused MehyarSoft cleanup for businesses whose referrals, ads, or search traffic land on unclear pages.',
    path: '/portfolio/5',
  },
  '/portfolio/6': {
    title: 'Owner Dashboard and Support Retainer | MehyarSoft Engagement Pattern',
    description:
      'A monthly MehyarSoft support pattern for keeping lead flow, CRM hygiene, small fixes, and operational dashboards moving.',
    path: '/portfolio/6',
  },
  '/blog': {
    title: 'Blog & Insights | MehyarSoft Tech Audit & Automation Notes',
    description:
      'Practical MehyarSoft notes on local business tech audits, missed-call CRM follow-up, internal automation, and when custom software is worth building.',
    path: '/blog',
  },
  '/blog/small-business-tech-audit-revenue-leaks': {
    title: 'The Small Business Tech Audit: Find Revenue Leaks Before Buying More Software | MehyarSoft',
    description:
      'A practical MehyarSoft framework for finding missed calls, weak CTAs, booking friction, CRM gaps, and manual work before committing to a bigger build.',
    path: '/blog/small-business-tech-audit-revenue-leaks',
  },
  '/blog/missed-calls-crm-follow-up': {
    title: 'Missed Calls Are a CRM Problem, Not Just a Phone Problem | MehyarSoft',
    description:
      'Why a missed call becomes a CRM problem when intake, follow-up, consent, and owner visibility are not part of the response workflow.',
    path: '/blog/missed-calls-crm-follow-up',
  },
  '/blog/when-to-build-custom-software': {
    title: 'When to Build Custom Software Instead of Forcing Another SaaS Tool | MehyarSoft',
    description:
      'A MehyarSoft checklist for when custom software is justified versus when a small SaaS fix or process change is the right answer.',
    path: '/blog/when-to-build-custom-software',
  },
  '/newsletter': {
    title: 'Free AI Automation Checklist | MehyarSoft',
    description:
      'Get the free MehyarSoft AI automation checklist for finding missed calls, website leaks, poor follow-up, disconnected systems, and manual work before buying more tools.',
    path: '/newsletter',
  },
  '/free-checklist': {
    title: 'Free AI Automation Checklist | MehyarSoft',
    description:
      'Get the free MehyarSoft checklist for finding missed-call, website, follow-up, systems, and manual-work leaks before buying more tools.',
    path: '/newsletter',
  },
  '/about': {
    title: 'Founder Story | MehyarSoft LLC NYC Software Consultant',
    description:
      'Meet Mehyar Swelim, Syrian founder of MehyarSoft LLC in NYC, providing senior software, systems, and AI automation consulting for businesses with practical operational problems.',
    path: '/about',
  },
  '/330': {
    title: '$330 Website + Booking Leak Audit | MehyarSoft',
    description:
      'A focused $330 MehyarSoft audit for local businesses that need a clear diagnosis of website, booking, missed-call, and follow-up leaks before buying more software.',
    path: '/micro-offer',
  },
  '/micro-offer': {
    title: '$330 Website + Booking Leak Audit | MehyarSoft',
    description:
      'A focused $330 MehyarSoft audit for local businesses that need a clear diagnosis of website, booking, missed-call, and follow-up leaks before buying more software.',
    path: '/micro-offer',
  },
  '/contact': {
    title: 'Contact MehyarSoft | Request a Tech Audit or Consulting Call',
    description:
      'Contact MehyarSoft LLC to request a tech audit, consulting call, website cleanup, CRM follow-up flow, automation sprint, or systems integration review.',
    path: '/contact',
  },
  '/booking': {
    title: 'Book a Consulting Call | MehyarSoft',
    description:
      'Request a MehyarSoft consulting call for tech audits, the $330 rescue offer, website cleanup, AI follow-up, automation sprints, systems consulting, retainers, or general help.',
    path: '/booking',
  },
  '/book': {
    title: 'Book a Consulting Call | MehyarSoft',
    description:
      'Request a MehyarSoft consulting call with service-specific routing and manual scheduling fallback when calendar auth is unavailable.',
    path: '/booking',
  },
  '/billing/checkout': {
    title: 'Stripe Test Checkout | MehyarSoft Sandbox Billing',
    description:
      'Start a MehyarSoft service checkout in Stripe test mode. Live charges stay blocked unless Boss explicitly enables owner-approved production billing.',
    path: '/billing/checkout',
    robots: 'noindex,follow',
  },
  '/billing/success': {
    title: 'Billing Result | MehyarSoft',
    description: 'MehyarSoft billing confirmation page shown after a Stripe checkout completes.',
    path: '/billing/success',
    robots: 'noindex,follow',
  },
  '/billing/cancel': {
    title: 'Billing Cancelled | MehyarSoft',
    description: 'MehyarSoft billing cancellation page shown when a Stripe checkout is cancelled.',
    path: '/billing/cancel',
    robots: 'noindex,follow',
  },
  '/privacy-policy': {
    title: 'Privacy Policy | MehyarSoft LLC',
    description:
      'Read how MehyarSoft LLC handles consulting contact submissions, business context, follow-up, analytics, privacy requests, and sensitive-data cautions.',
    path: '/privacy-policy',
  },
  '/terms': {
    title: 'Terms of Service | MehyarSoft LLC',
    description:
      'Review MehyarSoft LLC website terms covering informational content, consulting engagements, sensitive submissions, and contact instructions.',
    path: '/terms',
  },
  '/sitemap': {
    title: 'Sitemap | MehyarSoft LLC',
    description:
      'Browse MehyarSoft public pages including services, engagement patterns, blog insights, founder story, contact, privacy policy, and terms.',
    path: '/sitemap',
  },
  '/unsubscribe': {
    title: 'Unsubscribe | MehyarSoft LLC',
    description: 'Unsubscribe from MehyarSoft communications.',
    path: '/unsubscribe',
    robots: 'noindex,follow',
  },
  '/admin/prospects': {
    title: 'Prospect Pipeline | MehyarSoft Owner Dashboard',
    description: 'Owner-gated prospect pipeline: scan local-services businesses for site leaks, draft cold emails, approve and send via CF Email Service with CAN-SPAM + RFC 8058 compliance.',
    path: '/admin/prospects',
    robots: 'noindex,noarchive',
  },
};

const SITE_ORIGIN = 'https://mehyar.us';

function escapeAttr(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function applyRouteMeta(html, route) {
  const meta = routeMeta[route];
  if (!meta) return html;

  const canonicalPath = meta.path || route;
  const canonicalUrl = `${SITE_ORIGIN}${canonicalPath}`;
  const title = meta.title;
  const description = meta.description;
  const robots = meta.robots || 'index,follow';

  let out = html;
  out = out.replace(/<title>[^<]*<\/title>/, `<title>${escapeAttr(title)}</title>`);
  out = out.replace(
    /<meta name="description" content="[^"]*" \/>/,
    `<meta name="description" content="${escapeAttr(description)}" />`,
  );
  out = out.replace(
    /<meta name="robots" content="[^"]*" \/>/,
    `<meta name="robots" content="${escapeAttr(robots)}" />`,
  );
  out = out.replace(
    /<meta property="og:title" content="[^"]*" \/>/,
    `<meta property="og:title" content="${escapeAttr(title)}" />`,
  );
  out = out.replace(
    /<meta property="og:description" content="[^"]*" \/>/,
    `<meta property="og:description" content="${escapeAttr(description)}" />`,
  );
  out = out.replace(
    /<meta property="og:url" content="[^"]*" \/>/,
    `<meta property="og:url" content="${escapeAttr(canonicalUrl)}" />`,
  );
  out = out.replace(
    /<meta name="twitter:title" content="[^"]*" \/>/,
    `<meta name="twitter:title" content="${escapeAttr(title)}" />`,
  );
  out = out.replace(
    /<meta name="twitter:description" content="[^"]*" \/>/,
    `<meta name="twitter:description" content="${escapeAttr(description)}" />`,
  );
  out = out.replace(
      /<link rel="canonical" href="[^"]*" \/>/,
      `<link rel="canonical" href="${escapeAttr(canonicalUrl)}" />`,
    );
    // RSS feed auto-discovery — every public MehyarSoft shell should advertise
    // /rss.xml so feed readers, aggregators, and AI search surfaces find the
    // blog without a manual submit. Idempotent: skip if already present so
    // re-runs are no-ops.
    if (!out.includes('rel="alternate" type="application/rss+xml"')) {
      out = out.replace(
        /<link rel="manifest" href="[^"]*" \/>/,
        `<link rel="manifest" href="/manifest.webmanifest" />\n    <link rel="alternate" type="application/rss+xml" title="MehyarSoft LLC" href="https://mehyar.us/rss.xml" />`,
      );
    }
    return out;
  }

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
  'admin/prospects',
  'admin/today',
  'unsubscribe',
  'privacy-policy',
  'terms',
  'sitemap',
];

const adminTitles = {
  'admin/email': 'Email Command Center | MehyarSoft',
  'admin/email/thread': 'Email Command Center | MehyarSoft',
  'admin/newsletter': 'Newsletter Money Cockpit | MehyarSoft',
  'admin/government': 'Government Opportunities | MehyarSoft',
  'admin/opportunity-scout': 'Opportunity Scout | MehyarSoft',
  'admin/analytics': 'Analytics Dashboard | MehyarSoft',
  'admin/prospects': 'Prospect Pipeline | MehyarSoft',
  'admin/today': 'Today | MehyarSoft',
};

function routeShell(route) {
  if (!route.startsWith('admin')) {
    return applyRouteMeta(appShell, `/${route}`);
  }
  return adminShell(route);
}

// Build an admin-themed noindex app shell so /admin/* pre-rendered shells don't
// leak 'index,follow' robots to crawlers and social unfurlers. The previous
// inline shape ran the noindex robots replace and then handed the result to
// applyRouteMeta(appShell, '/'), which re-overwrote robots back to 'index,follow'
// from routeMeta['/']. This standalone builder avoids applyRouteMeta entirely
// so the noindex tag survives. The client SPA still mounts the Admin component
// on /admin/*; this shell only matters for the static-HTML pre-render that
// no-JS crawlers, link unfurlers, and curl debuggers see.
function adminShell(route) {
  const title = adminTitles[route] || 'Admin Metrics | MehyarSoft';
  return appShell
    .replace(/<meta name="robots" content="[^"]*" \/>/, '<meta name="robots" content="noindex,nofollow,noarchive" />')
    .replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`)
    .replace(/<meta name="description" content="[^"]*" \/>/, '<meta name="description" content="Owner-only MehyarSoft admin area." />')
    .replace(/<meta property="og:title" content="[^"]*" \/>/, `<meta property="og:title" content="${title}" />`)
    .replace(/<meta property="og:description" content="[^"]*" \/>/, '<meta property="og:description" content="Owner-only MehyarSoft admin area." />')
    .replace(/<meta property="og:url" content="[^"]*" \/>/, `<meta property="og:url" content="${SITE_ORIGIN}/${route}" />`)
    .replace(/<meta name="twitter:title" content="[^"]*" \/>/, `<meta name="twitter:title" content="${title}" />`)
    .replace(/<meta name="twitter:description" content="[^"]*" \/>/, '<meta name="twitter:description" content="Owner-only MehyarSoft admin area." />')
    .replace(/<link rel="canonical" href="[^"]*" \/>/, `<link rel="canonical" href="${SITE_ORIGIN}/${route}" />`);
}

// Build a 404-themed noindex app shell so static hosts (Cloudflare Pages) that
// serve /404.html for any unknown path return a route-appropriate title and
// description instead of an admin page's metadata. The client SPA's
// <Route component={NotFound} /> takes over once the bundle boots and shows
// the branded 404 screen — this shell just keeps the HTML/JS-curl view honest
// (search bots unfurling miss URLs, social previews of dead links, browser
// tab titles for hand-typed URLs).
function notFoundShell() {
  const title = 'Route not found | MehyarSoft';
  const description = 'That MehyarSoft route does not exist. Return to the homepage or browse the public sitemap.';
  const path = '/404';
  return applyRouteMeta(
    appShell
      .replace(/<meta name="robots" content="[^"]*" \/>/, '<meta name="robots" content="noindex,nofollow,noarchive" />'),
    path,
  )
    .replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`)
    .replace(/<meta name="description" content="[^"]*" \/>/, `<meta name="description" content="${description}" />`)
    .replace(/<meta property="og:title" content="[^"]*" \/>/, `<meta property="og:title" content="${title}" />`)
    .replace(/<meta property="og:description" content="[^"]*" \/>/, `<meta property="og:description" content="${description}" />`)
    .replace(/<meta property="og:url" content="[^"]*" \/>/, `<meta property="og:url" content="${SITE_ORIGIN}${path}" />`)
    .replace(/<meta name="twitter:title" content="[^"]*" \/>/, `<meta name="twitter:title" content="${title}" />`)
    .replace(/<meta name="twitter:description" content="[^"]*" \/>/, `<meta name="twitter:description" content="${description}" />`);
}

for (const route of directRoutes) {
  const target = join(distDir, route, 'index.html');
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, routeShell(route));
}

// Static hosts return /404.html for unknown routes; serve a 404-themed noindex
// shell so misses show honest "Route not found" metadata instead of inheriting
// the admin Email Command Center page title/canonical.
writeFileSync(join(distDir, '404.html'), notFoundShell());

console.log(`Wrote per-route meta for ${directRoutes.length} routes plus 404 fallback.`);