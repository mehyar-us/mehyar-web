/**
 * product-descriptor.ts — the ProductDescriptor (Reinvention Slice 0,
 * blueprint §1.7). ONE versioned document — name, slogan, capability
 * list, price references into the CatalogService — from which the
 * public surfaces are generated/stamped:
 *
 *  - the API self-description (GET /api/product),
 *  - the landing page and the money pages (a hash meta stamped at
 *    request time by the worker's HTML branches),
 *  - OG-bearing pages (the same stamp rides beside the og: tags).
 *
 * A descriptor hash (SHA-256 of the canonical form) is stamped on every
 * surface; a mismatch across surfaces fails tests (build-failure
 * semantics at test level in this slice). The descriptor carries price
 * REFERENCES (catalog refs + amounts) — never raw Stripe price IDs and
 * never live seat counts (counts change per request; the hash must be
 * stable across surfaces rendered at different moments).
 *
 * The engine is forbidden from generating product claims from model
 * knowledge; this document is the only product description the system
 * itself serves.
 */
import type {Env} from './env';
import {readCatalog,type CatalogEnv,type CatalogSnapshot} from './catalog-service';
import {FOUNDING_SEATS_TOTAL} from './billing/plans';

export const DESCRIPTOR_VERSION='1.0.0';
export const DESCRIPTOR_META_NAME='mayor-descriptor';
/** The sentence the descriptor carries for the founding lock (§8
 * Decision 8): the lock holds while the subscription stays active —
 * exactly what /terms states, no softer promise. */
export const FOUNDING_LOCK_TERMS='Locked at the founding rate for as long as the subscription stays active.';

export interface DescriptorCapability{code:string;label:string}
export interface DescriptorPrice{ref:string;cents:number;currency:'USD';kind:string;interval?:string}
export interface ProductDescriptor {
 descriptorVersion:string;
 name:string;
 slogan:string;
 capabilities:DescriptorCapability[];
 prices:DescriptorPrice[];
 founding:{priceRef:string;seatsTotal:number;lockTerms:string};
 audit:{priceRefs:string[];delivery:string};
}

/** The capability list — what the product actually does today, stated
 * as codes the surfaces can render. Gated capabilities say so in their
 * label rather than promising a connection that may not exist. */
export const DESCRIPTOR_CAPABILITIES:DescriptorCapability[]=[
 {code:'talk',label:'Talk or type to your business in plain language'},
 {code:'voice',label:'Voice conversations with your assistant'},
 {code:'phone',label:'Answers your business phone and talks to callers (with a connected number)'},
 {code:'calendar',label:'Books, cancels, and reschedules on your calendar (with a connected calendar)'},
 {code:'textback',label:'Missed-call text-back to customers'},
 {code:'briefing',label:'A morning briefing and proactive follow-ups, prepared for your approval'},
 {code:'billing',label:'Plan, founding cohort, and usage-pack billing'},
 {code:'audit',label:'The Extensive business audit — a reviewed report on your online presence'},
 {code:'mcp',label:'A read-only MCP endpoint for your own tools'},
 {code:'connectors',label:'Owner-approved connections to your existing tools'},
];

export function buildDescriptor(catalog:CatalogSnapshot):ProductDescriptor{
 return {
  descriptorVersion:DESCRIPTOR_VERSION,
  name:'The Mayor',
  slogan:'Mayor. Talk to your business.',
  capabilities:DESCRIPTOR_CAPABILITIES,
  prices:catalog.prices.map(entry=>({ref:entry.ref,cents:entry.cents,currency:entry.currency,kind:entry.kind,...(entry.interval?{interval:entry.interval}:{})})),
  founding:{priceRef:'founding',seatsTotal:FOUNDING_SEATS_TOTAL,lockTerms:FOUNDING_LOCK_TERMS},
  audit:{priceRefs:['audit:worker','audit:hub'],delivery:'Payment queues the audit; it does not mean a report is complete.'},
 };
}

/** Canonical form: fixed key order by construction, no live state. */
export function canonicalDescriptorJson(descriptor:ProductDescriptor):string{
 return JSON.stringify(descriptor);
}

export async function descriptorHash(descriptor:ProductDescriptor):Promise<string>{
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonicalDescriptorJson(descriptor)));
 return Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
}

export async function currentDescriptor(env:CatalogEnv):Promise<{catalog:CatalogSnapshot;descriptor:ProductDescriptor;hash:string}>{
 const catalog=await readCatalog(env);
 const descriptor=buildDescriptor(catalog);
 return {catalog,descriptor,hash:await descriptorHash(descriptor)};
}

export function descriptorMetaTag(hash:string):string{
 return `<meta name="${DESCRIPTOR_META_NAME}" content="${hash}">`;
}

/**
 * Stamp the descriptor hash into an HTML document's <head>. Idempotent:
 * an existing stamp is replaced, never duplicated. Documents without a
 * <head> are returned unchanged (fail-quiet — the caller's served-bytes
 * checks decide whether a missing stamp is a defect on that surface).
 */
export function stampDescriptorHash(html:string,hash:string):string{
 const tag=descriptorMetaTag(hash);
 const existing=new RegExp(`<meta name="${DESCRIPTOR_META_NAME}" content="[a-f0-9]{64}">`);
 if(existing.test(html))return html.replace(existing,tag);
 const headEnd=html.indexOf('</head>');
 if(headEnd<0)return html;
 return html.slice(0,headEnd)+tag+html.slice(headEnd);
}

/** Extract a stamped descriptor hash from served HTML (null if absent). */
export function stampedDescriptorHash(html:string):string|null{
 const match=html.match(new RegExp(`<meta name="${DESCRIPTOR_META_NAME}" content="([a-f0-9]{64})">`));
 return match?match[1]:null;
}

/**
 * GET /api/product — the API's self-description. Serves the descriptor,
 * its hash, and the LIVE founding block (from the catalog read, so the
 * seat state here can never disagree with /api/billing/catalog).
 */
export async function productDescriptorResponse(request:Request,env:Env):Promise<Response|null>{
 const url=new URL(request.url);
 if(url.pathname!=='/api/product')return null;
 if(request.method!=='GET')return Response.json({error:'method_not_allowed',message:'Use GET for the product descriptor.'},{status:405,headers:{'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'}});
 const {catalog,descriptor,hash}=await currentDescriptor(env);
 return Response.json({descriptor,descriptorHash:hash,founding:catalog.founding},{headers:{'cache-control':'public, max-age=300','x-content-type-options':'nosniff','referrer-policy':'no-referrer'}});
}
