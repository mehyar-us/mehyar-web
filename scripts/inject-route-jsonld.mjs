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
          const altPayload = JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }, null, 2);
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

  const payload = JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }, null, 2);
  const script = `<script type="application/ld+json" ${marker}>\n    ${payload}\n    </script>`;

  const next = html.includes('</head>')
    ? html.replace('</head>', `    ${script}\n  </head>`)
    : `${script}\n${html}`;

  writeFileSync(target, next);
  injectedCount += 1;
}

console.log(`Injected per-route JSON-LD into ${injectedCount} shell(s).`);