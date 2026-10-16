/**
 * analytics-consent.test.ts — consent-gated GA4 + GTM wiring for mayor.mehyar.us.
 *
 * The snippet (web/public/analytics-consent.js) must:
 *  - default every Consent Mode storage to denied BEFORE any measurement URL
 *    appears in the file (nothing can fire pre-consent),
 *  - inject googletagmanager.com tags ONLY from the consent-granted code path,
 *  - load GA4 as direct gtag.js (never configured inside GTM),
 *  - show a banner with equally-weighted Accept / Reject,
 *  - expose window.MayorConsent.reopen() for the footer "Cookie settings" link.
 * No network calls are made here — every assertion is on file content and
 * ordering.
 */
import {expect,it,describe} from 'vitest';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
import {isPublicAssetPath} from '../src/public-routes';

const here=dirname(fileURLToPath(import.meta.url));
const webDir=join(here,'..','web');
const publicDir=join(webDir,'public');
const scriptsDir=join(here,'..','scripts');

const snippet=readFileSync(join(publicDir,'analytics-consent.js'),'utf8');
/** Snippet with comments removed — doc comments legitimately name the
 * function and hosts, so structural checks run on code only. */
const code=snippet
  .replace(/\/\*[\s\S]*?\*\//g,'')
  .replace(/^[ \t]*\/\/.*$/gm,'');
const consentCss=readFileSync(join(publicDir,'analytics-consent.css'),'utf8');
const generatorSource=readFileSync(join(scriptsDir,'gen-sales-verticals.mjs'),'utf8');

function readPage(name:string):string{
  return readFileSync(join(webDir,name),'utf8');
}
const PAGES=['index.html','sales.html','pricing.html','business-audit.html'] as const;

/** All start indices of `needle` in `source`. */
function allIndices(source:string,needle:string):number[]{
  const out:number[]=[];
  let i=source.indexOf(needle);
  while(i>=0){out.push(i);i=source.indexOf(needle,i+1);}
  return out;
}

/** [start,end) span of the body of `function NAME(` … its matching `}`. */
function functionSpan(source:string,name:string):[number,number]{
  const decl=new RegExp(`function\\s+${name}\\s*\\(`);
  const m=decl.exec(source);
  if(!m)throw new Error(`function ${name} not found`);
  const bodyStart=source.indexOf('{',m.index);
  let depth=0;
  for(let j=bodyStart;j<source.length;j++){
    if(source[j]==='{')depth++;
    else if(source[j]==='}'){
      depth--;
      if(depth===0)return [bodyStart,j+1];
    }
  }
  throw new Error(`unbalanced braces in ${name}`);
}

/** Call-site indices of `NAME()` excluding the function's own definition. */
function callSites(source:string,name:string):number[]{
  const decl=new RegExp(`function\\s+${name}\\s*\\(`).exec(source);
  const declStart=decl?decl.index:-1;
  return allIndices(source,`${name}()`).filter(i=>!(declStart>=0&&i>=declStart&&i<declStart+40));
}

describe('consent snippet identity',()=>{
  it('carries the exact GA4 measurement ID and GTM container ID, and no other G- IDs',()=>{
    expect(snippet).toContain('G-6RCJMF73VJ');
    expect(snippet).toContain('GTM-PZLMLZ5C');
    const gIds=[...new Set(snippet.match(/G-[A-Z0-9]{4,}/g)??[])];
    expect(gIds).toEqual(['G-6RCJMF73VJ']);
  });

  it('is the only analytics code on the page — no other measurement IDs leak in',()=>{
    // UA-… legacy IDs and extra G-… IDs would indicate a second property.
    expect(snippet).not.toMatch(/UA-\d+/);
  });
});

describe('consent defaults before any tag',()=>{
  it("sets gtag('consent','default') with everything denied BEFORE any googletagmanager.com URL",()=>{
    const consentIdx=code.indexOf("gtag('consent', 'default'");
    expect(consentIdx).toBeGreaterThan(-1);
    const tagIdx=code.indexOf('googletagmanager.com');
    expect(tagIdx).toBeGreaterThan(-1);
    expect(consentIdx).toBeLessThan(tagIdx);
  });

  it('denies every storage category in the default call (security stays granted)',()=>{
    const start=code.indexOf("gtag('consent', 'default'");
    const block=code.slice(start,start+600);
    for(const key of ['ad_storage','ad_user_data','ad_personalization','analytics_storage','functionality_storage','personalization_storage']){
      expect(block).toContain(`${key}: 'denied'`);
    }
    expect(block).toContain("security_storage: 'granted'");
  });
});

describe('tag injection is gated on consent (structural)',()=>{
  const loadSpan=functionSpan(code,'loadGrantedTags');
  const inside=([s,e]:[number,number])=>(i:number)=>i>=s&&i<e;
  const inLoad=inside(loadSpan);

  it('every tag-injection site lives inside loadGrantedTags()',()=>{
    const sites=[
      ...allIndices(code,"createElement('script')"),
      ...allIndices(code,'googletagmanager.com'),
      ...allIndices(code,'gtm.js'),
    ];
    expect(sites.length).toBeGreaterThan(0);
    for(const i of sites)expect(inLoad(i),`injection at ${i} escapes loadGrantedTags`).toBe(true);
  });

  it('loadGrantedTags() is called only from enableGrantedAnalytics()',()=>{
    const enableSpan=functionSpan(code,'enableGrantedAnalytics');
    const sites=callSites(code,'loadGrantedTags');
    expect(sites.length).toBeGreaterThan(0);
    for(const i of sites)expect(inside(enableSpan)(i),`loadGrantedTags call at ${i} is outside the granted path`).toBe(true);
  });

  it('enableGrantedAnalytics() is reachable only from the granted branch and the Accept handler',()=>{
    const sites=callSites(code,'enableGrantedAnalytics');
    expect(sites.length).toBeGreaterThan(0);
    for(const i of sites){
      const context=code.slice(Math.max(0,i-400),i);
      expect(/granted|accept/i.test(context),`granted-path call at ${i} has unexpected context`).toBe(true);
    }
  });

  it('GA4 is direct gtag.js only — never configured inside the GTM container',()=>{
    // The gtag.js library URL is built from the GA4 id, and config() runs
    // only inside loadGrantedTags; no container-side GA4 tag config exists.
    expect(snippet).toContain("gtag('config', GA4_MEASUREMENT_ID)");
    expect(snippet).not.toMatch(/gtm\.js\?id=G-/);
  });

  it('guards against double-loading the tags',()=>{
    const [s]=loadSpan;
    const body=snippet.slice(s,loadSpan[1]);
    expect(body).toContain('tagsLoaded');
  });
});

describe('banner and choice storage',()=>{
  it('shows a banner with equally-weighted Accept and Reject handlers',()=>{
    expect(snippet).toContain('Accept');
    expect(snippet).toContain('Reject');
    expect(snippet).toContain("addEventListener('click', onAccept)");
    expect(snippet).toContain("addEventListener('click', onReject)");
    // Equal visual weight: both buttons share the same base class/styles.
    expect(snippet).toContain('mayor-consent-btn mayor-consent-accept');
    expect(snippet).toContain('mayor-consent-btn mayor-consent-reject');
    expect(consentCss).toContain('.mayor-consent-accept');
    expect(consentCss).toContain('.mayor-consent-reject');
    expect(consentCss).toContain('.mayor-consent-btn');
  });

  it('uses honest copy: names Google Analytics and Meta ads, loads only on accept',()=>{
    expect(snippet).toContain('Google Analytics and Meta (Facebook) tools to understand site traffic and measure our ads');
    expect(snippet).toContain('They only load if you accept');
  });

  it('persists the choice in localStorage under the versioned key',()=>{
    expect(snippet).toContain('mayor.analytics-consent.v1');
    expect(snippet).toContain("writeChoice('granted')");
    expect(snippet).toContain("writeChoice('denied')");
  });

  it('exposes window.MayorConsent.reopen() and binds footer triggers without inline handlers',()=>{
    expect(snippet).toContain('window.MayorConsent');
    expect(snippet).toContain('reopen');
    expect(snippet).toContain('[data-mayor-consent-reopen]');
    // No inline onclick attributes on the consent plumbing — the CSP
    // forbids inline handlers. (pricing.html has a pre-existing inline
    // fallback script, out of scope; it must not be the consent trigger.)
    expect(snippet).not.toContain('onclick');
    expect(generatorSource).not.toContain('onclick');
    for(const page of PAGES){
      const html=readPage(page);
      const trigger=html.match(/<button[^>]*data-mayor-consent-reopen[^>]*>/);
      expect(trigger,`${page} consent trigger`).toBeTruthy();
      expect(trigger![0],`${page} consent trigger`).not.toContain('onclick');
    }
  });
});

describe('page wiring',()=>{
  it.each([...PAGES])('%s references /analytics-consent.js synchronously in <head>',(page)=>{
    const html=readPage(page);
    const tag='<script src="/analytics-consent.js"></script>';
    expect(html).toContain(tag);
    const headEnd=html.indexOf('</head>');
    expect(headEnd).toBeGreaterThan(-1);
    expect(html.indexOf(tag)).toBeLessThan(headEnd);
  });

  it('generator template wires the snippet in <head>',()=>{
    const tag='<script src="/analytics-consent.js"></script>';
    expect(generatorSource).toContain(tag);
    expect(generatorSource.indexOf(tag)).toBeLessThan(generatorSource.indexOf('</head>'));
  });

  it('all 7 generated vertical pages carry the snippet in <head>',()=>{
    const slugs=['salon','restaurant','plumbing-hvac','dental','auto-repair','pet-grooming','med-spa'];
    const tag='<script src="/analytics-consent.js"></script>';
    for(const slug of slugs){
      const html=readFileSync(join(webDir,'sales',`${slug}.html`),'utf8');
      expect(html,slug).toContain(tag);
      expect(html.indexOf(tag),slug).toBeLessThan(html.indexOf('</head>'));
    }
  });

  it('every page template has a footer Cookie settings trigger',()=>{
    for(const page of [...PAGES]){
      const html=readPage(page);
      expect(html,page).toContain('data-mayor-consent-reopen');
      expect(html,page).toContain('Cookie settings');
    }
    expect(generatorSource).toContain('data-mayor-consent-reopen');
    expect(generatorSource).toContain('Cookie settings');
  });
});

describe('worker and headers plumbing',()=>{
  it('whitelists the consent assets as public paths',()=>{
    expect(isPublicAssetPath('/analytics-consent.js')).toBe(true);
    expect(isPublicAssetPath('/analytics-consent.css')).toBe(true);
    // Existing entries still hold.
    expect(isPublicAssetPath('/sw.js')).toBe(true);
    expect(isPublicAssetPath('/nope.js')).toBe(false);
  });

  it('CSP allows the consent-gated Google hosts (script/connect/img)',()=>{
    const headers=readFileSync(join(publicDir,'_headers'),'utf8');
    const cspLine=headers.split('\n').find(l=>l.includes('Content-Security-Policy'))??'';
    expect(cspLine).toContain('https://www.googletagmanager.com');
    expect(cspLine).toContain('https://www.google-analytics.com');
    // The consent file itself stays same-origin: no unsafe-inline added.
    expect(cspLine).not.toContain('unsafe-inline');
  });

  it('CSP allows the consent-gated Meta hosts (script/connect/img)',()=>{
    const headers=readFileSync(join(publicDir,'_headers'),'utf8');
    const cspLine=headers.split('\n').find(l=>l.includes('Content-Security-Policy'))??'';
    // fbevents.js loads from connect.facebook.net (script-src); the /tr
    // PageView beacon goes to www.facebook.com (connect-src + img-src).
    // Without these the pixel tag injects but the browser refuses the
    // fetch — the AIMech defect (rot286 order #1).
    expect(cspLine).toContain("script-src 'self' 'wasm-unsafe-eval' https://www.googletagmanager.com https://connect.facebook.net");
    expect(cspLine).toContain('https://www.facebook.com');
  });
});
