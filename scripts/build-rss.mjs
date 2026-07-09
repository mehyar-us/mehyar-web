// Build dist/public/rss.xml from the canonical blog post list.
//
// Why this script exists:
// - The SPA at mehyar.us has 3 published blog posts but no RSS feed at
//   /rss.xml, /feed.xml, or /atom.xml (verified live curl turn-015).
// - An RSS feed is a pure-additive SEO + re-engagement lever:
//     1. RSS subscribers get notified on new posts (revisit → booking path)
//     2. Feed aggregators and AI search surfaces re-crawl on submit
//     3. Feeds are an explicit Google Search "follow this site" signal
// - Same data shape is mirrored from client/src/data/blog-posts.ts so the
//   runtime /blog index and the RSS surface stay in lock-step. Keep both
//   in sync when adding posts (the next entry is the comment block below).
//
// Data sourcing:
// - Hardcoded list here for build-time purity (matches route-jsonld.json
//   pattern — pure JSON-shaped data, no TS import in a .mjs script).
// - New posts: append a row, keep newest-first, regenerate.
//
// Output:
// - dist/public/rss.xml — RSS 2.0 spec compliant
// - dist/public/index.html and dist/public/404.html get the
//   <link rel="alternate" type="application/rss+xml"> auto-discovery tag
//   so feed readers, aggregators, and AI search surfaces find the blog from
//   the home + 404 shells (sub-route shells are handled by copy-route-shells.mjs).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const SITE_ORIGIN = 'https://mehyar.us';
const SITE_TITLE = 'MehyarSoft LLC';
const SITE_DESCRIPTION =
  'Founder-led software, systems, and AI automation consulting for local businesses and regulated teams.';
const SITE_LANGUAGE = 'en-US';
const FEED_PATH = '/rss.xml';

// KEEP IN SYNC with client/src/data/blog-posts.ts.
// Newest first. Only the fields below are needed for the feed.
const posts = [
  {
    title: 'The Small Business Tech Audit: Find Revenue Leaks Before Buying More Software',
    slug: 'small-business-tech-audit-revenue-leaks',
    date: '2026-05-11',
    author: 'Mehyar Swelim',
    category: 'Operations',
    excerpt:
      'A practical framework for finding missed calls, weak CTAs, booking friction, CRM gaps, and manual work before committing to a bigger build.',
  },
  {
    title: 'Missed Calls Are a CRM Problem, Not Just a Phone Problem',
    slug: 'missed-calls-crm-follow-up',
    date: '2026-05-11',
    author: 'Mehyar Swelim',
    category: 'Automation',
    excerpt:
      'If a prospect calls and nobody follows up, the business needs an intake and response system: consent-safe SMS, email, routing, and owner visibility.',
  },
  {
    title: 'When to Build Custom Software Instead of Forcing Another SaaS Tool',
    slug: 'when-to-build-custom-software',
    date: '2026-05-11',
    author: 'Mehyar Swelim',
    category: 'Strategy',
    excerpt:
      'Custom software makes sense when the workflow is proven, the handoffs are clear, and off-the-shelf tools create more manual work than they remove.',
  },
];

const escapeXml = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const toRfc822 = (yyyyMmDd) => {
  // 2026-05-11 → Mon, 11 May 2026 00:00:00 GMT
  const [y, m, d] = yyyyMmDd.split('-').map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
  return utc.toUTCString();
};

const sorted = [...posts].sort((a, b) => (a.date < b.date ? 1 : -1));
const buildDate = toRfc822(
  new Date().toISOString().slice(0, 10) || sorted[0].date
);
const lastBuildDate = sorted.length ? toRfc822(sorted[0].date) : buildDate;

const items = sorted
  .map((post) => {
    const link = `${SITE_ORIGIN}/blog/${post.slug}`;
    return `    <item>
      <title>${escapeXml(post.title)}</title>
      <link>${link}</link>
      <guid isPermaLink="true">${link}</guid>
      <description>${escapeXml(post.excerpt)}</description>
      <author>${escapeXml(post.author)}</author>
      <category>${escapeXml(post.category)}</category>
      <pubDate>${toRfc822(post.date)}</pubDate>
    </item>`;
  })
  .join('\n');

const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(SITE_TITLE)}</title>
    <link>${SITE_ORIGIN}</link>
    <description>${escapeXml(SITE_DESCRIPTION)}</description>
    <language>${SITE_LANGUAGE}</language>
    <lastBuildDate>${lastBuildDate}</lastBuildDate>
    <pubDate>${lastBuildDate}</pubDate>
    <generator>mehyar-us build pipeline</generator>
    <atom:link href="${SITE_ORIGIN}${FEED_PATH}" rel="self" type="application/rss+xml" />
${items}
  </channel>
</rss>
`;

const out = join('dist/public', FEED_PATH.replace(/^\//, ''));
if (!existsSync(dirname(out))) {
  mkdirSync(dirname(out), { recursive: true });
}
writeFileSync(out, rss, 'utf8');

// Inject RSS auto-discovery <link rel="alternate" ...> into the home shell
// and the static 404.html. Sub-route shells are handled by copy-route-shells.mjs.
// Idempotent: skip if already present so re-runs are no-ops.
const ALT_TAG = `<link rel="alternate" type="application/rss+xml" title="${SITE_TITLE}" href="${SITE_ORIGIN}${FEED_PATH}" />`;
const patchShell = (path) => {
  if (!existsSync(path)) return false;
  const html = readFileSync(path, 'utf8');
  if (html.includes('rel="alternate" type="application/rss+xml"')) return false;
  const next = html.replace(
    /<link rel="manifest" href="[^"]*" \/>/,
    `<link rel="manifest" href="/manifest.webmanifest" />\n    ${ALT_TAG}`,
  );
  if (next === html) return false;
  writeFileSync(path, next, 'utf8');
  return true;
};

let patched = 0;
if (patchShell(join('dist/public', 'index.html'))) patched += 1;
if (patchShell(join('dist/public', '404.html'))) patched += 1;

console.log(`Wrote ${out} (${sorted.length} items, ${rss.length} bytes). Patched ${patched} home/404 shell(s) with RSS auto-discovery.`);