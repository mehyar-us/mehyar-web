/**
 * front-door.test.ts — the signed-out home repair (front-door deploy,
 * Product Chief order absorbing WS1's live defects):
 *  1. the sample proof sits ABOVE the first sign-in in #chat-sign-in,
 *     and the plan block no longer leads the door;
 *  2. the $330 audit band + /business-audit link render in the served
 *     home offer block ONLY while the audit offer is available;
 *  3. the mobile shell header cannot overflow at phone widths: the
 *     Microsoft button gets the same short-label compact treatment as
 *     the Google button, the signed-out header drops its placeholder
 *     business identity, and the actions cluster is viewport-capped.
 * Assertions are on file content, SSR output, and ordering — no network.
 */
import {expect,it,describe} from 'vitest';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
import {offerBlockSsrHtml,homeAuditBandSsrHtml,injectOfferBlock} from '../src/offer-block-ssr';

const here=dirname(fileURLToPath(import.meta.url));
const webDir=join(here,'..','web');
const indexHtml=readFileSync(join(webDir,'index.html'),'utf8');
const mobileCss=readFileSync(join(webDir,'mobile-compact.css'),'utf8');

describe('signed-out home order',()=>{
  it('proof (sample) precedes the first sign-in, plans follow',()=>{
    const sample=indexHtml.indexOf('home-sample');
    const signIn=indexHtml.indexOf('chat-google-sign-in');
    const plans=indexHtml.indexOf('id="offer-block"');
    expect(sample).toBeGreaterThan(-1);
    expect(signIn).toBeGreaterThan(sample);
    expect(plans).toBeGreaterThan(signIn);
  });
});

describe('home audit band',()=>{
  it('renders the catalog audit price and the audit page link',()=>{
    const band=homeAuditBandSsrHtml();
    expect(band).toContain('$330');
    expect(band).toContain('href="/business-audit"');
    expect(band).toContain('Extensive business audit');
  });
  it('appears in the offer block only when the audit offer is available',()=>{
    expect(offerBlockSsrHtml(true)).toContain('home-audit-band');
    expect(offerBlockSsrHtml(false)).not.toContain('home-audit-band');
    expect(offerBlockSsrHtml()).not.toContain('home-audit-band');
  });
  it('injectOfferBlock threads availability into the served home',()=>{
    const page='<div id="chat-sign-in"><div id="offer-block" class="offer-block" aria-label="Plans"><p class="offer-fallback">x</p></div></div>';
    expect(injectOfferBlock(page,true)).toContain('home-audit-band');
    expect(injectOfferBlock(page,false)).not.toContain('home-audit-band');
  });
});

describe('mobile shell header',()=>{
  it('gives the Microsoft button the short-label compact treatment',()=>{
    expect(mobileCss).toContain('#sign-in-microsoft .sign-in-label{display:none}');
    expect(mobileCss).toContain('#sign-in-microsoft .sign-in-short{display:inline}');
    expect(mobileCss).toContain('#sign-in-microsoft{padding:8px 12px;min-height:44px;font-size:12px;white-space:nowrap}');
  });
  it('drops the placeholder business identity from the signed-out header',()=>{
    expect(mobileCss).toContain('.app:has(#sign-in:not([hidden])) header .business-identity{display:none}');
  });
  it('caps the header actions cluster to the viewport',()=>{
    expect(mobileCss).toContain('.header-actions{width:auto;max-width:calc(100vw - 32px)');
  });
});
