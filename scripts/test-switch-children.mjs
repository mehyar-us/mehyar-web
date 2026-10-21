// Guard: no pathless child inside the hub App's wouter <Switch>.
//
// 2026-10-21 incident (a recurrence of the Oct 16 one): the custom
// <Redirect to href> elements inside <Switch> carried no `path` prop.
// Wouter's Switch treats a pathless child as a match-everything fallback,
// so the FIRST Redirect shadowed every route below it — /privacy-policy/,
// /terms/, /data-deletion, /sitemap and /unsubscribe all rendered an
// empty <main> behind perfect 200s. The Oct 16 fix was a reorder, which
// decayed. This assertion pins the mechanism fix: every self-closing
// element child of the Switch must carry a path= prop, except the single
// intentional fallback (<Route component={NotFound} />), which stays LAST.
//
// Usage: node scripts/test-switch-children.mjs [path-to-App.tsx]

import { readFileSync } from 'node:fs';

const file = process.argv[2] ?? 'client/src/App.tsx';
let src = readFileSync(file, 'utf8');

// Strip comments first so a literal "<Switch>" inside a comment (like the
// one in this incident's own fix note) cannot fake the region: JSX block
// comments, C-style block comments, and full-line // comments.
src = src
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

const open = src.indexOf('<Switch>');
const close = src.indexOf('</Switch>');
if (open < 0 || close < 0 || close < open) {
  console.error(`FAIL: could not locate <Switch>…</Switch> in ${file}`);
  process.exit(1);
}
const region = src.slice(open, close);

// Switch children in this app are self-closing elements (Route / Redirect).
const elements = [...region.matchAll(/<([A-Z][A-Za-z0-9]*)\b[^>]*\/>/g)].map((m) => ({
  tag: m[1],
  text: m[0],
}));

if (elements.length === 0) {
  console.error('FAIL: no self-closing elements found inside <Switch> — extractor drift?');
  process.exit(1);
}

const failures = [];
elements.forEach((el, i) => {
  const isNotFoundFallback = el.tag === 'Route' && /component=\{NotFound\}/.test(el.text);
  if (isNotFoundFallback) {
    if (i !== elements.length - 1) failures.push(`the NotFound fallback is not the last Switch child (position ${i + 1}/${elements.length})`);
    return;
  }
  if (!/\bpath=/.test(el.text)) {
    failures.push(`<${el.tag}> at Switch position ${i + 1} has no path= prop — a pathless child wildcard-matches and shadows every route below it`);
  }
});

if (failures.length) {
  console.error(`FAIL (${file}):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`OK: ${elements.length} Switch children in ${file}, all pathed (plus the trailing NotFound fallback).`);
