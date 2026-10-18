// Inject a machine-readable product index into the /apps route shell so
// no-JS readers — AI assistants, crawlers, link unfurlers — can see the full
// product directory on first byte. The React app renders the same list from
// the same source after hydration; without this, the shell is an empty
// <div id="root"> and non-JS readers see zero products (verified live:
// a major AI assistant answered "3 flagship products" for a 33-product page).
//
// Single source of truth: client/src/pages/Apps.tsx `managedApps`.
// This script FAILS THE BUILD if the extraction count does not match the
// number of entries in the array — a registry edit that changes the entry
// shape must update this extractor, loudly, not silently drift.
//
// Outputs, all generated from managedApps:
//  1. An ItemList JSON-LD block in dist/public/apps/index.html <head>.
//  2. A static HTML product index inside the shell's #root (React replaces
//     #root's children on mount, so JS visitors never see a duplicate).
//  3. The marker-delimited product block in dist/public/llms.txt, refreshed
//     in place between <!-- PRODUCTS:BEGIN --> and <!-- PRODUCTS:END -->.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const APPS_SRC = 'client/src/pages/Apps.tsx';
const SHELL = join('dist/public', 'apps', 'index.html');
const LLMS = join('dist/public', 'llms.txt');

function unescapeTs(s) {
  return s.replace(/\\"/g, '"').replace(/\\'/g, "'").replace(/\\\\/g, '\\');
}
function escHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// --- Extract managedApps -------------------------------------------------
const src = readFileSync(APPS_SRC, 'utf8');
const start = src.indexOf('const managedApps');
if (start < 0) throw new Error('inject-apps-index: managedApps not found in Apps.tsx');
const region = src.slice(start, src.indexOf('];', start));
const idCount = (region.match(/\n\s+id: "/g) || []).length;
const entryRe = /id: "([^"]+)",\s*\n\s*name: "([^"]+)",\s*\n\s*url: "([^"]+)",\s*\n\s*tagline: "((?:[^"\\]|\\.)*)"/g;
const apps = [];
let m;
while ((m = entryRe.exec(region)) !== null) {
  apps.push({ id: m[1], name: m[2], url: m[3], tagline: unescapeTs(m[4]) });
}
if (apps.length !== idCount || apps.length === 0) {
  throw new Error(
    `inject-apps-index: extracted ${apps.length} entries but managedApps carries ${idCount} ids — extractor drift, fix scripts/inject-apps-index.mjs`
  );
}
console.log(`  apps index: ${apps.length} products extracted from Apps.tsx`);

// --- 1 + 2: shell JSON-LD + static index --------------------------------
if (!existsSync(SHELL)) {
  console.log(`  apps index: ${SHELL} missing; skipping shell injection.`);
} else {
  let html = readFileSync(SHELL, 'utf8');

  if (!html.includes('data-apps-itemlist')) {
    const itemList = {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      name: 'Products We Own — MehyarSoft LLC',
      description: `The full product directory of MehyarSoft LLC: ${apps.length} products owned and operated.`,
      numberOfItems: apps.length,
      itemListElement: apps.map((a, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        item: { '@type': 'WebSite', name: a.name, url: a.url, description: a.tagline },
      })),
    };
    const script = `<script type="application/ld+json" data-apps-itemlist>\n    ${JSON.stringify(itemList, null, 2)}\n    </script>`;
    html = html.includes('</head>')
      ? html.replace('</head>', `    ${script}\n  </head>`)
      : `${script}\n${html}`;
    console.log('  apps index: ItemList JSON-LD injected');
  }

  if (!html.includes('data-static-product-index')) {
    const items = apps
      .map(
        (a) =>
          `        <li><a href="${escHtml(a.url)}">${escHtml(a.name)}</a> — ${escHtml(a.tagline)}</li>`
      )
      .join('\n');
    const section =
      `<section data-static-product-index>\n` +
      `      <h1>Products We Own — MehyarSoft LLC</h1>\n` +
      `      <p>MehyarSoft LLC owns and operates ${apps.length} products. The full directory:</p>\n` +
      `      <ul>\n${items}\n      </ul>\n` +
      `    </section>`;
    if (!html.includes('<div id="root"></div>')) {
      throw new Error('inject-apps-index: shell #root is not the empty div — cannot place the static index safely');
    }
    html = html.replace('<div id="root"></div>', `<div id="root">${section}</div>`);
    console.log('  apps index: static product index injected into #root');
  }

  writeFileSync(SHELL, html);
}

// --- 3: llms.txt product block -------------------------------------------
if (existsSync(LLMS)) {
  const llms = readFileSync(LLMS, 'utf8');
  const begin = '<!-- PRODUCTS:BEGIN -->';
  const end = '<!-- PRODUCTS:END -->';
  const bi = llms.indexOf(begin);
  const ei = llms.indexOf(end);
  if (bi >= 0 && ei > bi) {
    const lines = apps.map((a) => `- **${a.name}** (${a.url}) — ${a.tagline}`).join('\n');
    const block = `${begin}\nMehyarSoft LLC owns and operates ${apps.length} products:\n\n${lines}\n${end}`;
    writeFileSync(LLMS, llms.slice(0, bi) + block + llms.slice(ei + end.length));
    console.log('  apps index: llms.txt product block refreshed');
  } else {
    console.log('  apps index: llms.txt carries no PRODUCTS markers; skipped.');
  }
}
