/**
 * honest-claims.test.ts — chief order 2026-10-11 (claim/capability tension):
 *
 * 1. /sales carries one honest line under the money-loop section:
 *    "Text-back works once you connect your business number — setup takes minutes."
 *    (consistent with the homepage FAQ: "Phone features require a supported
 *    provider, a connected number, and completed setup.")
 * 2. OG + Twitter card tags on / and /sales, pointing at real served assets.
 * 3. Logged-out homepage gating: app nav + business-identity hidden when there
 *    is no session; nav restored on login, identity restored on enterBusiness.
 */
import {expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
import {generateVerticalPages,VERTICAL_SLUGS} from '../scripts/gen-sales-verticals.mjs';
import {VERTICAL_PROFILES} from '../src/verticals';

const here=dirname(fileURLToPath(import.meta.url));
const webDir=join(here,'..','web');
const read=(p:string)=>readFileSync(join(webDir,p),'utf8');

const HONEST_LINE='Text-back works once you connect your business number — setup takes minutes.';

it('/sales has the honest capability line under the money-loop section',()=>{
  const html=read('sales.html');
  expect(html).toContain(HONEST_LINE);
  // It sits inside the money-loop section (after the section opens, before it closes).
  const sectionStart=html.indexOf('id="money-loop"');
  const sectionEnd=html.indexOf('</section>',sectionStart);
  const lineAt=html.indexOf(HONEST_LINE,sectionStart);
  expect(sectionStart).toBeGreaterThanOrEqual(0);
  expect(lineAt).toBeGreaterThan(sectionStart);
  expect(lineAt).toBeLessThan(sectionEnd);
});

it('/sales hero surfaces the provider-setup qualifier up top',()=>{
  const html=read('sales.html');
  const heroEnd=html.indexOf('id="how"');
  expect(html.slice(0,heroEnd)).toContain(HONEST_LINE);
});

it('/sales honest line is consistent with the homepage FAQ requirement language',()=>{
  const index=read('index.html');
  expect(index).toContain('Phone features require a supported provider, a connected number, and completed setup.');
});

it('/ and /sales carry OG + Twitter card tags with real image assets',()=>{
  for(const page of ['index.html','sales.html']){
    const html=read(page);
    for(const tag of [
      '<meta property="og:type" content="website">',
      '<meta property="og:title"',
      '<meta property="og:description"',
      '<meta property="og:url"',
      '<meta name="twitter:card" content="summary_large_image">',
      '<meta name="twitter:title"',
      '<meta name="twitter:description"',
    ]) expect(html,`${page} missing ${tag}`).toContain(tag);
    // og:image / twitter:image must point at the real served icon asset.
    expect(html).toContain('<meta property="og:image" content="https://mayor.mehyar.us/icon-512.png">');
    expect(html).toContain('<meta name="twitter:image" content="https://mayor.mehyar.us/icon-512.png">');
  }
  expect(read('index.html')).toContain('<meta property="og:url" content="https://mayor.mehyar.us/">');
  expect(read('sales.html')).toContain('<meta property="og:url" content="https://mayor.mehyar.us/sales">');
});

it('all 7 vertical pages carry per-vertical OG + Twitter card tags',()=>{
  generateVerticalPages();
  for(const [vertical,slug] of Object.entries(VERTICAL_SLUGS)){
    const profile=(VERTICAL_PROFILES as Record<string,typeof VERTICAL_PROFILES.salon>)[vertical];
    const html=read(`sales/${slug}.html`);
    for(const tag of [
      '<meta property="og:type" content="website">',
      '<meta property="og:title"',
      '<meta property="og:description"',
      '<meta name="twitter:card" content="summary_large_image">',
      '<meta name="twitter:title"',
      '<meta name="twitter:description"',
      '<meta property="og:image" content="https://mayor.mehyar.us/icon-512.png">',
      '<meta name="twitter:image" content="https://mayor.mehyar.us/icon-512.png">',
    ]) expect(html,`/sales/${slug} missing ${tag}`).toContain(tag);
    // og:url is the page's own canonical URL.
    expect(html).toContain(`<meta property="og:url" content="https://mayor.mehyar.us/sales/${slug}">`);
    // Titles/descriptions are per-vertical, from the profile — honest, no invented claims.
    expect(html).toContain(`The Mayor for ${profile.label}`);
    expect(html).toContain(profile.label.toLowerCase());
    expect(html).not.toMatch(/\$\d/);
  }
});

it('logged-out view hides the app nav and business-identity; login restores nav',()=>{
  const main=read('main.ts');
  // No-session branch gates the landing.
  expect(main).toMatch(/if\(!session\)\{[\s\S]*?querySelector<HTMLElement>\('nav\[aria-label="Main navigation"\]'\)!\.hidden=true/);
  expect(main).toMatch(/if\(!session\)\{[\s\S]*?\$\('business-identity'\)\.hidden=true/);
  // Login restores the nav.
  expect(main).toMatch(/loggedIn=true;[\s\S]*?querySelector<HTMLElement>\('nav\[aria-label="Main navigation"\]'\)!\.hidden=false/);
  // enterBusiness restores the identity block once a real business exists.
  expect(main).toMatch(/async function enterBusiness[\s\S]*?\$\('business-identity'\)\.hidden=false/);
});

it('no Council references anywhere in the changed files',()=>{
  for(const f of ['sales.html','index.html','main.ts']){
    expect(read(f).toLowerCase()).not.toContain('council');
  }
});
