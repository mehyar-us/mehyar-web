/**
 * sales-catalog.test.ts — the /sales page renders pricing ONLY from the
 * billing catalog payload. No dollar amount may be hardcoded in the sales
 * surface (HTML/TS/CSS); the test fixture below is the only place prices
 * appear, and it is excluded from the hardcode scan by design.
 */
import {expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
import {
 buildMoneyLoopExamples,
 formatPriceCents,
 parseCatalog,
 renderMoneyLoopHtml,
 renderPricingHtml,
 renderPricingUnavailableHtml,
} from '../web/sales-pricing';

const here=dirname(fileURLToPath(import.meta.url));
function salesSource(name:string):string{
 return readFileSync(join(here,'..','web',name),'utf8');
}
const SALES_SOURCES=['sales.html','sales.ts','sales.css','sales-pricing.ts'].map(salesSource);

// Fixture: deliberately absurd prices. The page must render THESE, proving
// it reads the catalog instead of hardcoding.
const ABSURD_FIXTURE={
 currency:'USD',
 plans:[
  {id:'free',name:'Free',priceCents:0,interval:'calendar_month',replyLimit:100,voiceMinuteLimit:10},
  {id:'pro',name:'Pro',priceCents:99900,interval:'month',replyLimit:4242,voiceMinuteLimit:777},
 ],
 creditPacks:[
  {id:'small',name:'Small',priceCents:11100,replyAttempts:200,voiceMinutes:15},
 ],
};
// Fixture mirroring the live catalog shape (pro 1400c, packs 400/800/1200c).
const LIVE_SHAPE_FIXTURE={
 currency:'USD',
 plans:[
  {id:'free',name:'Free',priceCents:0,interval:'calendar_month',replyLimit:100,voiceMinuteLimit:10},
  {id:'pro',name:'Pro',priceCents:1400,interval:'month',replyLimit:1000,voiceMinuteLimit:120},
 ],
 creditPacks:[
  {id:'small',name:'Small',priceCents:400,replyAttempts:200,voiceMinutes:15},
  {id:'medium',name:'Medium',priceCents:800,replyAttempts:500,voiceMinutes:45},
  {id:'large',name:'Large',priceCents:1200,replyAttempts:800,voiceMinutes:90},
 ],
};

it('renders whatever the catalog serves — fixture with 99900c renders $999, not a hardcoded price',()=>{
 const catalog=parseCatalog(ABSURD_FIXTURE);
 expect(catalog).not.toBeNull();
 const html=renderPricingHtml(catalog!);
 expect(html).toContain('$999');
 expect(html).toContain('4,242 reply attempts');
 expect(html).toContain('777 voice minutes');
 expect(html).toContain('$111');
 expect(html).not.toContain('$14');
 expect(html).not.toContain('$39');
});

it('renders the live-shape fixture correctly ($14 pro, $4/$8/$12 packs)',()=>{
 const catalog=parseCatalog(LIVE_SHAPE_FIXTURE);
 expect(catalog).not.toBeNull();
 const html=renderPricingHtml(catalog!);
 expect(html).toContain('$14');
 expect(html).toContain('$4');
 expect(html).toContain('$8');
 expect(html).toContain('$12');
 expect(html).toContain('per month');
 expect(html).toContain('one-time');
});

it('formats cent amounts without literal dollar signs in source',()=>{
 expect(formatPriceCents(1400)).toBe('$14');
 expect(formatPriceCents(0)).toBe('$0');
 expect(formatPriceCents(99900)).toBe('$999');
 expect(formatPriceCents(1050)).toBe('$10.50');
 expect(()=>formatPriceCents(-1)).toThrow();
});

it('shows the unavailable state on fetch failure or bad payload — never a guessed price',()=>{
 expect(parseCatalog(null)).toBeNull();
 expect(parseCatalog({})).toBeNull();
 expect(parseCatalog({plans:[],creditPacks:[]})).toBeNull();
 expect(parseCatalog({plans:[{id:'pro'}],creditPacks:[]})).toBeNull();
 const html=renderPricingUnavailableHtml();
 expect(html).toContain('Pricing is unavailable right now');
 expect(html).not.toMatch(/\$\d/);
});

it('contains no hardcoded dollar amounts in the sales surface sources',()=>{
 for(const source of SALES_SOURCES){
  expect(source).not.toMatch(/\$\d/);
 }
});

it('builds one honest money-loop example per vertical from the vertical profiles',()=>{
 const examples=buildMoneyLoopExamples();
 expect(examples.map(e=>e.vertical).sort()).toEqual(
  ['auto_repair','dental','med_spa','pet_grooming','plumbing_hvac','restaurant','salon'].sort());
 for(const example of examples){
  expect(example.miss.length).toBeGreaterThan(40);
  expect(example.textback).toContain('Reply YES');
  expect(example.textback).not.toContain('{business}');
  expect(example.recover.length).toBeGreaterThan(40);
  expect(example.kpis.length).toBeGreaterThanOrEqual(2);
 }
 const html=renderMoneyLoopHtml(examples);
 expect(html).toContain('Illustrative');
 expect(html).toContain('results vary');
 // Vertical-specific vocabulary shows up: salon chair, restaurant table, dental patient.
 expect(html).toContain('Rebooking rate');
 expect(html).toContain('Chair utilization');
 expect(html).toContain('No-show rate');
 expect(html).toContain('After-hours catch');
 expect(html).not.toMatch(/\$\d/);
});

it('never names the product Jarvis — Jarvis-like descriptor allowed at most once',()=>{
 const combined=SALES_SOURCES.join('\n');
 const standalone=combined.match(/Jarvis(?!-like)/g)??[];
 expect(standalone).toEqual([]);
 const descriptor=combined.match(/Jarvis-like/g)??[];
 expect(descriptor.length).toBeLessThanOrEqual(1);
 const rendered=renderMoneyLoopHtml(buildMoneyLoopExamples())+renderPricingHtml(parseCatalog(LIVE_SHAPE_FIXTURE)!);
 expect(rendered).not.toMatch(/Jarvis(?!-like)/);
});

it('sales page carries the required footer and CTA links, and no street address',()=>{
 const html=salesSource('sales.html');
 expect(html).toContain('MehyarSoft LLC');
 expect(html).toContain('href="/terms"');
 expect(html).toContain('https://mehyar.us/privacy-policy/');
 expect(html).toContain('https://mehyar.us/terms/');
 expect(html).toContain('https://mehyar.us/data-deletion/');
 expect(html).toContain('Purchases are final');
 expect(html).toContain('mailto:info@mehyar.us');
 expect(html).toContain('href="/"');
 expect(html).toContain('Start free');
 expect(html).toContain('Sign in');
 expect(html).not.toContain('96th St');
 expect(html).not.toContain('11209');
});
