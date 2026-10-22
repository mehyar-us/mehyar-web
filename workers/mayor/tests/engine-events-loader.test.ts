import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {describe,expect,it} from 'vitest';

/**
 * Instrumented capture for the consent-gated loader: the REAL
 * analytics-consent.js runs against stubbed window/document, with a
 * granted (or denied) consent record pre-seeded. This proves the exact
 * payloads the loader dispatches to the GA4 data layer and the Meta
 * pixel when the engine issues money-path directives — and that it
 * dispatches nothing without a current granted record.
 */
const source=readFileSync(new URL('../web/public/analytics-consent.js',import.meta.url),'utf8');

function loadLoader(choice:'granted'|'denied'|null){
 const store=new Map<string,string>();
 // The stored consent record is the bare choice string (see readChoice).
 if(choice)store.set('mayor.analytics-consent.v1',choice);
 const localStorage={
  getItem:(key:string)=>store.get(key)??null,
  setItem:(key:string,value:string)=>{store.set(key,value);},
  removeItem:(key:string)=>{store.delete(key);},
 };
 const fbqCalls:unknown[][]=[];
 const fbq=(...args:unknown[])=>{fbqCalls.push(args);};
 const scriptStub={parentNode:{insertBefore(){}}};
 const elementStub=()=>({setAttribute(){},addEventListener(){},appendChild(){},style:{},classList:{add(){}}});
 const documentStub={
  readyState:'complete',
  head:{appendChild(){}},
  body:{appendChild(){},insertAdjacentHTML(){}},
  createElement:elementStub,
  getElementsByTagName:()=>[scriptStub],
  getElementById:()=>null,
  querySelectorAll:()=>[],
  addEventListener(){},
 };
 const windowStub:Record<string,unknown>={
  localStorage,
  fbq,
  document:documentStub,
  dataLayer:[] as unknown[],
  MayorConsent:undefined,
 };
 windowStub.window=windowStub;
 const context=vm.createContext({window:windowStub,document:documentStub,localStorage,console,setTimeout,clearTimeout});
 vm.runInContext(source,context);
 return {window:windowStub as {MayorConsent:{choice():string|null;emitEngineEvents(d:unknown):number};dataLayer:unknown[][]},fbqCalls,store};
}

const BEGIN_CHECKOUT={name:'begin_checkout',eventId:'evt-begin-1',params:{value:99,currency:'USD',items:[{item_id:'pro',item_name:'Mayor Pro',price:99,quantity:1}]}};
const PURCHASE={name:'purchase',eventId:'evt-purchase-1',params:{value:79.2,currency:'USD',transaction_id:'in_123',items:[{item_id:'founding',item_name:'Mayor Pro — Founding',price:79.2,quantity:1}]}};

describe('consent-gated loader — engine event dispatch (instrumented capture)',()=>{
 it('granted: fires the exact GA4 payload and the Meta mapping',()=>{
  const {window,fbqCalls}=loadLoader('granted');
  const mayor=window.MayorConsent;
  expect(mayor.choice()).toBe('granted');
  expect(mayor.emitEngineEvents([BEGIN_CHECKOUT,PURCHASE])).toBe(2);
  const events=window.dataLayer.map(entry=>Array.from(entry as ArrayLike<unknown>)).filter(entry=>entry[0]==='event');
  expect(events).toContainEqual(['event','begin_checkout',BEGIN_CHECKOUT.params]);
  expect(events).toContainEqual(['event','purchase',PURCHASE.params]);
  expect(fbqCalls).toContainEqual(['track','InitiateCheckout',{value:99,currency:'USD'}]);
  expect(fbqCalls).toContainEqual(['track','Purchase',{value:79.2,currency:'USD'}]);
 });

 it('granted: delivery is deduped per event id across calls',()=>{
  const {window}=loadLoader('granted');
  const mayor=window.MayorConsent;
  expect(mayor.emitEngineEvents([PURCHASE])).toBe(1);
  expect(mayor.emitEngineEvents([PURCHASE])).toBe(0);
  const purchases=window.dataLayer.map(entry=>Array.from(entry as ArrayLike<unknown>)).filter(entry=>entry[0]==='event'&&entry[1]==='purchase');
  expect(purchases).toHaveLength(1);
 });

 it('denied: dispatches nothing, whatever directives it is handed',()=>{
  const {window,fbqCalls}=loadLoader('denied');
  expect(window.MayorConsent.emitEngineEvents([BEGIN_CHECKOUT,PURCHASE])).toBe(0);
  expect(window.dataLayer.map(entry=>Array.from(entry as ArrayLike<unknown>)).filter(entry=>entry[0]==='event')).toEqual([]);
  expect(fbqCalls.filter(call=>call[0]==='track'&&call[1]!=='PageView')).toEqual([]);
 });

 it('no record: dispatches nothing',()=>{
  const {window}=loadLoader(null);
  expect(window.MayorConsent.emitEngineEvents([BEGIN_CHECKOUT])).toBe(0);
 });
});
