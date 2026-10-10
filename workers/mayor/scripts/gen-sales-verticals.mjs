/**
 * gen-sales-verticals.mjs — generates one static sales page per vertical from
 * workers/mayor/src/verticals.ts (the single source of truth for vertical
 * label, vocabulary, and KPIs). Run before `vite build` (wired into
 * `npm run build:web`). Pages land in web/sales/<slug>.html and are picked up
 * as vite rollup inputs. Zero JavaScript, zero price claims in the output.
 */
import {writeFileSync, mkdirSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {VERTICAL_PROFILES} from '../src/verticals.ts';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'web', 'sales');

/** URL slugs for the 7 shippable verticals ('other' has no public page). */
export const VERTICAL_SLUGS = {
  salon: 'salon',
  restaurant: 'restaurant',
  plumbing_hvac: 'plumbing-hvac',
  dental: 'dental',
  auto_repair: 'auto-repair',
  pet_grooming: 'pet-grooming',
  med_spa: 'med-spa',
};

function esc(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function cap(word) {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

export function verticalPage(vertical, profile) {
  const slug = VERTICAL_SLUGS[vertical];
  const label = profile.label;
  const v = profile.vocabulary;
  const kpis = profile.kpis ?? [];
  const kpiNames = kpis.map(k => k.label).join(', ');
  const kpiChips = kpis
    .map(k => `<li title="${esc(k.hint)}">${esc(k.label)}</li>`)
    .join('');
  const canonical = `https://mayor.mehyar.us/sales/${slug}`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#102b47">
  <meta name="description" content="The Mayor is the AI chief of staff for your ${esc(label.toLowerCase())} — missed-call text-backs, reminders, and the numbers that matter, in your language.">
  <meta name="referrer" content="no-referrer">
  <link rel="icon" href="/favicon.ico" sizes="any">
  <link rel="canonical" href="${canonical}">
  <link rel="stylesheet" href="/sales.css">
  <title>The Mayor for ${esc(label)} · Your AI Chief of Staff</title>
</head>
<body>
  <a class="skip-link" href="#sales-content">Skip to content</a>
  <header class="site-header">
    <a class="brand" href="https://mehyar.us/" aria-label="Mehyar US home"><img src="/icon-192.png" alt="" width="42" height="42"><span>The Mayor<small>BY MEHYAR US</small></span></a>
    <nav aria-label="Sales page navigation">
      <a href="/sales#how">How it works</a>
      <a href="/sales#money-loop">Money loop</a>
      <a href="/sales#plans">Pricing</a>
      <a href="/sales#faq">FAQ</a>
    </nav>
    <div class="header-ctas">
      <a class="text-link" href="/">Sign in</a>
      <a class="button button-small" href="/">Start free</a>
    </div>
  </header>

  <main id="sales-content" tabindex="-1">
    <section class="hero page-width" aria-labelledby="sales-heading">
      <div class="hero-copy">
        <span class="section-kicker">THE MAYOR · FOR ${esc(label.toUpperCase())}</span>
        <h1 id="sales-heading">The Mayor talks to you, the business owner.</h1>
        <p class="hero-description">Your AI chief of staff for your ${esc(label.toLowerCase())} — in your language, running the place with you. It answers the calls you miss, texts back the ${esc(v.customer)}s you would lose, and keeps the day's money where you can see it.</p>
        <div class="hero-ctas">
          <a class="button" href="/">Start free</a>
          <a class="button button-outline" href="/">Sign in</a>
        </div>
        <p class="hero-note">No credit card to start. The app itself opens after sign-in.</p>
      </div>
    </section>

    <section class="page-width" aria-labelledby="trade-heading">
      <span class="section-kicker">MADE FOR YOUR TRADE</span>
      <h2 id="trade-heading">It speaks ${esc(label.toLowerCase())}.</h2>
      <p class="section-lead">The Mayor knows your ${esc(v.booking)}s, your ${esc(v.customer)}s, your ${esc(v.staff)}s, and every ${esc(v.service)} on the schedule — and it watches the numbers that move your week: ${esc(kpiNames)}. No generic dashboards, no jargon.</p>
      <p class="loop-kpis-label">Watch it move your numbers:</p>
      <ul class="kpi-chips">${kpiChips}</ul>
    </section>

    <section class="page-width" aria-labelledby="loop-heading">
      <span class="section-kicker">THE MONEY LOOP</span>
      <h2 id="loop-heading">One missed call, recovered.</h2>
      <p class="section-lead">The walkthrough below is an <strong>illustrative example</strong>, not a customer story. Results vary; nothing here promises revenue.</p>
      <article class="loop-card">
        <p class="loop-example-label"><span class="example-badge">Example</span> Illustrative — results vary</p>
        <h3>${esc(label)}</h3>
        <ol class="loop-steps">
          <li><strong>The missed ${esc(v.booking)}.</strong> A ${esc(v.customer)} calls and nobody can pick up — your ${esc(v.staff)}s are with ${esc(v.customer)}s. Normally that ${esc(v.booking)} goes to whoever answers first.</li>
          <li><strong>The instant text-back.</strong> The Mayor texts within a minute, in your voice: sorry we missed your call — want to book? Reply YES and we will find you a time. Reply STOP to opt out.</li>
          <li><strong>The recovered ${esc(v.booking)}.</strong> ${cap(v.customer)} replies YES. The Mayor takes it from there, and the ${esc(v.booking)} lands on your book — before you have even seen the missed call.</li>
        </ol>
      </article>
    </section>

    <section class="cta-band page-width" aria-labelledby="cta-heading">
      <h2 id="cta-heading">Meet your chief of staff.</h2>
      <p>Sign in to open The Mayor and put it to work on your next missed call.</p>
      <div class="hero-ctas">
        <a class="button" href="/">Start free</a>
        <a class="button button-outline" href="/">Sign in</a>
      </div>
    </section>
  </main>

  <footer class="site-footer page-width">
    <p class="footer-brand">The Mayor <small>BY MEHYARSOFT LLC</small></p>
    <nav aria-label="Footer">
      <a href="/terms">Terms</a>
      <a href="https://mehyar.us/privacy-policy/" target="_blank" rel="noopener noreferrer">Privacy</a>
      <a href="https://mehyar.us/terms/" target="_blank" rel="noopener noreferrer">Company terms</a>
      <a href="https://mehyar.us/data-deletion/" target="_blank" rel="noopener noreferrer">Data deletion</a>
      <a href="mailto:info@mehyar.us">info@mehyar.us</a>
    </nav>
    <p class="footer-note">Purchases are final — no refunds.</p>
    <p class="footer-note">© 2026 MehyarSoft LLC. All rights reserved.</p>
  </footer>

</body>
</html>
`;
}

export function generateVerticalPages() {
  mkdirSync(outDir, {recursive: true});
  const pages = [];
  for (const [vertical, slug] of Object.entries(VERTICAL_SLUGS)) {
    const profile = VERTICAL_PROFILES[vertical];
    if (!profile) throw new Error(`missing vertical profile: ${vertical}`);
    const html = verticalPage(vertical, profile);
    writeFileSync(join(outDir, `${slug}.html`), html);
    pages.push({vertical, slug, path: join(outDir, `${slug}.html`)});
  }
  return pages;
}

// CLI: node scripts/gen-sales-verticals.mjs
const pages = generateVerticalPages();
console.log(`generated ${pages.length} vertical sales pages: ${pages.map(p => p.slug).join(', ')}`);
