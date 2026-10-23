/**
 * front-door.test.ts — the signed-out home repair (front-door deploy,
 * Product Chief order absorbing WS1's live defects), as reworked by
 * the rot564 sell-first pass (2026-10-22):
 *  1. the welcome leads with the /sales money-loop story, then the
 *     sample proof, then the audit call to action — all ABOVE the
 *     first sign-in; the plan block follows the sign-in;
 *  2. the $330 audit band renders into #home-audit-slot above the
 *     sign-in ONLY while the audit offer is available (rot564 moved
 *     it out of the offer block, where the front-door repair had
 *     placed it below the sign-in buttons);
 *  3. the three duplicated sign-in blocks collapsed to ONE — the
 *     chat welcome's OAuth pair. The header keeps a single "Sign in"
 *     button that routes to that block (no OAuth pair of its own),
 *     and the Today welcome panel carries one "Start free" button
 *     that routes there too. The mobile Microsoft compact rules the
 *     front-door repair added are gone with the header button they
 *     served; the surviving header button keeps its compact rules.
 * Assertions are on file content, SSR output, and ordering — no network.
 */
import {expect,it,describe} from 'vitest';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
import {offerBlockSsrHtml,homeAuditBandSsrHtml,injectOfferBlock,injectHomeAuditSlot} from '../src/offer-block-ssr';

const here=dirname(fileURLToPath(import.meta.url));
const webDir=join(here,'..','web');
const indexHtml=readFileSync(join(webDir,'index.html'),'utf8');
const mobileCss=readFileSync(join(webDir,'mobile-compact.css'),'utf8');
const mainTs=readFileSync(join(webDir,'main.ts'),'utf8');

describe('signed-out home order',()=>{
  it('proof (sample) precedes the first sign-in, plans follow',()=>{
    const sample=indexHtml.indexOf('home-sample');
    const signIn=indexHtml.indexOf('chat-google-sign-in');
    const plans=indexHtml.indexOf('id="offer-block"');
    expect(sample).toBeGreaterThan(-1);
    expect(signIn).toBeGreaterThan(sample);
    expect(plans).toBeGreaterThan(signIn);
  });
  it('the money-loop story leads the welcome, above the sample and the sign-in (rot564)',()=>{
    const story=indexHtml.indexOf('home-story');
    const sample=indexHtml.indexOf('home-sample');
    const auditSlot=indexHtml.indexOf('id="home-audit-slot"');
    const signIn=indexHtml.indexOf('chat-google-sign-in');
    expect(story).toBeGreaterThan(-1);
    expect(sample).toBeGreaterThan(story);
    expect(auditSlot).toBeGreaterThan(sample);
    expect(signIn).toBeGreaterThan(auditSlot);
    // Story copy is /sales' own words (provenance pinned, no new claims).
    expect(indexHtml).toContain('The Mayor talks to you, the business owner.');
    expect(indexHtml).toContain('Mayor. Talk to your business.');
    expect(indexHtml).toContain('The same loop everywhere: a missed call, an instant text-back from your connected business number, a recovered booking.');
    expect(indexHtml).toContain('Text-back works once you connect your business number — setup takes minutes.');
    // No price literal rides the static story — prices render at serve time only.
    expect(indexHtml.slice(story,sample)).not.toMatch(/\$\d/);
  });
});

describe('one sign-in block (rot564 collapse)',()=>{
  it('exactly one OAuth pair exists in the shell — the chat welcome pair',()=>{
    expect(indexHtml.match(/id="chat-google-sign-in"/g)).toHaveLength(1);
    expect(indexHtml.match(/id="chat-microsoft-sign-in"/g)).toHaveLength(1);
    expect(indexHtml).not.toContain('sign-in-microsoft');
    expect(indexHtml).not.toContain('today-sign-in');
    expect(indexHtml).not.toContain('today-microsoft-sign-in');
    expect(indexHtml).not.toContain('Start with Google');
    expect(indexHtml).not.toContain('Start with Microsoft');
  });
  it('the header and Today buttons route to the one block instead of signing in',()=>{
    expect(indexHtml).toContain('id="today-start"');
    expect(mainTs).toContain("const goToSignInBlock=()=>{show('chat');$('chat-sign-in').scrollIntoView({block:'center'});$<HTMLButtonElement>('chat-google-sign-in').focus({preventScroll:true});};");
    expect(mainTs).toContain("$('today-start').onclick=()=>goToSignInBlock();");
    expect(mainTs).toContain("$('sign-in').onclick=()=>goToSignInBlock();");
    expect(mainTs).not.toContain("$('sign-in-microsoft')");
    expect(mainTs).not.toContain("$('today-sign-in')");
    expect(mainTs).not.toContain("$('today-microsoft-sign-in')");
  });
});

describe('home audit band',()=>{
  it('renders the catalog audit price and the audit page link',()=>{
    const band=homeAuditBandSsrHtml();
    expect(band).toContain('$330');
    expect(band).toContain('href="/business-audit"');
    expect(band).toContain('Extensive business audit');
  });
  it('renders into the audit slot above the sign-in, only when the audit offer is available (rot564 move)',()=>{
    const page='<div id="chat-sign-in"><div id="home-audit-slot"></div><div id="offer-block" class="offer-block" aria-label="Plans"><p class="offer-fallback">x</p></div></div>';
    expect(injectHomeAuditSlot(page,true)).toContain('home-audit-band');
    expect(injectHomeAuditSlot(page,true)).toContain('data-ssr="catalog"');
    expect(injectHomeAuditSlot(page,false)).toBe(page);
    expect(injectHomeAuditSlot(page,false)).not.toContain('home-audit-band');
    // Idempotent + fail-quiet on unexpected markup.
    const filled=injectHomeAuditSlot(page,true);
    expect(injectHomeAuditSlot(filled,true)).toBe(filled);
    expect(injectHomeAuditSlot('<p>no slot</p>',true)).toBe('<p>no slot</p>');
  });
  it('no longer rides inside the offer block (rot564 move)',()=>{
    expect(offerBlockSsrHtml()).not.toContain('home-audit-band');
    expect(injectOfferBlock('<div id="offer-block" class="offer-block" aria-label="Plans"><p class="offer-fallback">x</p></div>')).not.toContain('home-audit-band');
  });
});

describe('mobile shell header',()=>{
  it('keeps the surviving header sign-in button compact (the Microsoft pair is gone with the collapse)',()=>{
    expect(mobileCss).toContain('#sign-in{padding:8px 12px;min-height:44px;font-size:12px;white-space:nowrap}');
    expect(mobileCss).toContain('#sign-in .sign-in-label{display:none}');
    expect(mobileCss).toContain('#sign-in .sign-in-short{display:inline}');
    expect(mobileCss).not.toContain('#sign-in-microsoft');
  });
  it('drops the placeholder business identity from the signed-out header',()=>{
    expect(mobileCss).toContain('.app:has(#sign-in:not([hidden])) header .business-identity{display:none}');
  });
  it('caps the header actions cluster to the viewport',()=>{
    expect(mobileCss).toContain('.header-actions{width:auto;max-width:calc(100vw - 32px)');
  });
});

describe('no-card line at the homepage ask (post-deploy pass item 3, 2026-10-22)',()=>{
  it('the established wording appears exactly once, inside the one sign-in block at the offer ask',()=>{
    expect(indexHtml.match(/No credit card to start\./g)).toHaveLength(1);
    const block=indexHtml.indexOf('id="chat-sign-in"');
    const line=indexHtml.indexOf('No credit card to start.');
    const offer=indexHtml.indexOf('id="offer-block"');
    expect(block).toBeGreaterThan(-1);
    expect(line).toBeGreaterThan(block);
    // In the ask's visual unit: after the sign-in buttons, directly
    // before the offer block that carries the Start free ask.
    expect(line).toBeGreaterThan(indexHtml.indexOf('chat-google-sign-in'));
    expect(offer).toBeGreaterThan(line);
  });
});
