// Inject per-route JSON-LD into pre-rendered route shells so no-JS crawlers,
// social-card unfurlers, and link-preview tools that don't execute the SPA
// bundle see structured data immediately on first byte.
//
// Why this exists as a separate script:
// - copy-route-shells.mjs rewrites <title>/<meta>/<canonical> on each shell
//   but does NOT inject JSON-LD. The runtime SeoManager fires on hydration,
//   so without this post-processor, FAQPage/BreadcrumbList only appear after
//   React boots — too late for crawlers that don't run JS.
// - Mirrors the same Q&A and structured-data shape as the runtime
//   client/src/components/SeoManager.tsx entry for /micro-offer so the two
//   surfaces stay in lock-step.
// - Future route additions: add a key to scripts/route-jsonld.json; the
//   script will inject the same <script type="application/ld+json"> block
//   into the matching dist/public/<route>/index.html file before </head>.
//
// Touches nothing unless the target shell exists.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const distDir = 'dist/public';
const dataPath = 'scripts/route-jsonld.json';

if (!existsSync(dataPath)) {
  console.log(`No ${dataPath}; skipping JSON-LD injection.`);
  process.exit(0);
}

const routeJsonld = JSON.parse(readFileSync(dataPath, 'utf8'));

// Audit pause keying (rot605, 2026-10-23): while paid Audit generation is
// paused, the JSON-LD Offers for the two paused SKUs must not read as
// purchasable. The pause's source of truth is the audit_paused literal in
// functions/api/pay/availability.js — the same flag the /audit/ page folds
// into its blocked state and the unpause commit flips. While it holds, the
// injected Offers for those SKUs gain availability OutOfStock; the moment
// it flips, the next build emits the Offers bare again — self-clearing,
// per the point-of-ask disclosure-expiry pattern. route-jsonld.json itself
// stays the unpaused truth and is never edited here. Keyed by Offer URL
// (the SKU's canonical page), never by price: the founder-led $330 tech
// audit at /micro-offer is a different, unpaused product.
const availabilityPath = 'functions/api/pay/availability.js';
const auditPaused = existsSync(availabilityPath)
  ? /audit_paused:\s*true/.test(readFileSync(availabilityPath, 'utf8'))
  : false;
const PAUSED_OFFER_URLS = new Set([
  'https://mehyar.us/audit/',
  'https://mehyar.us/audit/report/',
]);
function keyOfferAvailability(node) {
  if (Array.isArray(node)) return node.map(keyOfferAvailability);
  if (node && typeof node === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(node)) out[k] = keyOfferAvailability(v);
    if (auditPaused && out['@type'] === 'Offer' && PAUSED_OFFER_URLS.has(out.url)) {
      out.availability = 'https://schema.org/OutOfStock';
    }
    return out;
  }
  return node;
}
if (auditPaused) {
  console.log('  audit_paused holds: paused-SKU Offers keyed with availability OutOfStock.');
}

let injectedCount = 0;

for (const [route, graph] of Object.entries(routeJsonld)) {
  const target = join(distDir, route.replace(/^\//, ''), 'index.html');
  if (!existsSync(target)) {
    // /404 fallback (turn-026): the 404 page is a single file, not a directory.
    if (route === '/404') {
      const fallback = join(distDir, '404.html');
      if (existsSync(fallback)) {
        const altMarker = `data-route-jsonld="${route}"`;
        const altHtml = readFileSync(fallback, 'utf8');
        if (!altHtml.includes(altMarker)) {
          const altPayload = JSON.stringify({ '@context': 'https://schema.org', '@graph': keyOfferAvailability(graph) }, null, 2);
          const altScript = `<script type="application/ld+json" ${altMarker}>\n    ${altPayload}\n    </script>`;
          const altNext = altHtml.includes('</head>')
            ? altHtml.replace('</head>', `    ${altScript}\n  </head>`)
            : `${altScript}\n${altHtml}`;
          writeFileSync(fallback, altNext);
          injectedCount += 1;
          console.log(`  + /404 -> 404.html (fallback)`);
        }
      }
    }
    continue;
  }

  const html = readFileSync(target, 'utf8');

  // Idempotent: skip if a script tagged data-route-jsonld already exists.
  const marker = `data-route-jsonld="${route}"`;
  if (html.includes(marker)) continue;

  const payload = JSON.stringify({ '@context': 'https://schema.org', '@graph': keyOfferAvailability(graph) }, null, 2);
  const script = `<script type="application/ld+json" ${marker}>\n    ${payload}\n    </script>`;

  const next = html.includes('</head>')
    ? html.replace('</head>', `    ${script}\n  </head>`)
    : `${script}\n${html}`;

  writeFileSync(target, next);
  injectedCount += 1;
}

console.log(`Injected per-route JSON-LD into ${injectedCount} shell(s).`);