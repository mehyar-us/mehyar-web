import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {isPublicAssetPath} from '../src/public-routes';

const read=(path:string)=>readFileSync(new URL(path,import.meta.url),'utf8');
const INDEXNOW_KEY='a1b2c3d4e5f6478899aabbccddeeff00';
const GUIDES=['how-much-does-a-missed-call-cost','ai-receptionist-vs-answering-service','missed-call-text-back'] as const;

it('gives the homepage a descriptive, slogan-carrying title',()=>{
 const html=read('../web/index.html');
 expect(html).toContain('<title>Mayor — Talk to Your Business | AI receptionist & follow-up for local businesses</title>');
 expect(html).not.toContain('<title>Mayor · MehyarSoft</title>');
});

it('carries a canonical tag on every funnel page',()=>{
 const pages:Record<string,string>={'../web/index.html':'https://mayor.mehyar.us/','../web/sales.html':'https://mayor.mehyar.us/sales','../web/pricing.html':'https://mayor.mehyar.us/pricing','../web/business-audit.html':'https://mayor.mehyar.us/business-audit'};
 for(const [path,url] of Object.entries(pages))expect(read(path),path).toContain(`<link rel="canonical" href="${url}">`);
 for(const slug of ['salon','restaurant','plumbing-hvac','dental','auto-repair','pet-grooming','med-spa'])
  expect(read(`../web/sales/${slug}.html`),slug).toContain(`<link rel="canonical" href="https://mayor.mehyar.us/sales/${slug}">`);
});

it('explicitly welcomes the major AI crawlers in robots.txt',()=>{
 const robots=read('../web/public/robots.txt');
 for(const bot of ['GPTBot','ClaudeBot','PerplexityBot','Google-Extended']){
  expect(robots).toMatch(new RegExp(`User-agent: ${bot}\\nAllow: /`));
 }
 expect(robots).toContain('Sitemap: https://mayor.mehyar.us/sitemap.xml');
});

it('hosts the IndexNow key file whose content is the key itself',()=>{
 const key=read(`../web/public/${INDEXNOW_KEY}.txt`);
 expect(key).toBe(INDEXNOW_KEY);
 expect(isPublicAssetPath(`/${INDEXNOW_KEY}.txt`)).toBe(true);
});

it('keeps the Meta pixel behind the same consent gate as GTM and GA4',()=>{
 const consent=read('../web/public/analytics-consent.js');
 // The IDs in production use, named in the file.
 expect(consent).toContain("GTM_CONTAINER_ID = 'GTM-PZLMLZ5C'");
 expect(consent).toContain("GA4_MEASUREMENT_ID = 'G-6RCJMF73VJ'");
 // The pixel loader exists and is consent-gated (inside loadGrantedTags).
 // Activated 2026-10-16 with the verified "The Mayor" dataset ID.
 expect(consent).toContain("META_PIXEL_ID = '1773921077163350'");
 const granted=consent.slice(consent.indexOf('function loadGrantedTags()'),consent.indexOf('function enableGrantedAnalytics()'));
 expect(granted).toContain('connect.facebook.net/en_US/fbevents.js');
 expect(granted).toContain("fbq('init', META_PIXEL_ID)");
 expect(granted.indexOf('META_PIXEL_ID')).toBeLessThan(granted.indexOf('fbevents.js'));
});

it('publishes the three guides with honest structure: canonical, article schema, FAQ, internal links',()=>{
 for(const slug of GUIDES){
  const html=read(`../web/${slug}.html`);
  expect(html,slug).toContain(`<link rel="canonical" href="https://mayor.mehyar.us/${slug}">`);
  expect(html,slug).toContain('"@type":"Article"');
  expect(html,slug).toContain('"@type":"FAQPage"');
  expect(html,slug).toContain('href="/sales"');
  expect(html,slug).toContain('href="/?start=1"');
  // Beacon host superseded 2026-10-22 (audience → Mayor integration):
  // the tag loads from mayor.mehyar.us now — the collector moved to
  // the Mayor-served endpoint ahead of the old host's removal.
  expect(html,slug).toContain('https://mayor.mehyar.us/b.js');
  expect(html,slug).toContain('src="/analytics-consent.js"');
  expect(html,slug).not.toMatch(/guarantee|guaranteed/i);
  expect(isPublicAssetPath(`/${slug}`)).toBe(true);
  expect(isPublicAssetPath(`/${slug}.html`)).toBe(true);
 }
});

it('lists the guides in the sitemap and llms.txt',()=>{
 const sitemap=read('../web/public/sitemap.xml');
 const llms=read('../web/public/llms.txt');
 for(const slug of GUIDES){
  expect(sitemap).toContain(`<loc>https://mayor.mehyar.us/${slug}</loc>`);
  expect(llms).toContain(`https://mayor.mehyar.us/${slug}`);
 }
});

it('keeps invented statistics out of the cost guide: every figure is a labeled example or the reader\u2019s own',()=>{
 const html=read('../web/how-much-does-a-missed-call-cost.html');
 expect(html).toContain('example assumptions, labeled');
 expect(html).not.toMatch(/\d+\s?%\s?of (businesses|callers|shops)/i);
 expect(html).not.toMatch(/studies (show|say)|research shows/i);
});
