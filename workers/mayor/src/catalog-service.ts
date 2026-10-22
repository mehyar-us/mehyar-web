/**
 * catalog-service.ts — CatalogService (Reinvention Slice 0, blueprint
 * §1.7/§1.8). A READER of existing truth, never a second source:
 *
 *  - Plans and packs come from src/billing/plans.ts semantics, unchanged.
 *  - Founding seats come ONLY from src/billing/founding.ts foundingSeats()
 *    — subscription-row counting with fail-quiet preserved (uncomputable
 *    ⇒ available:false + null counts; no number is ever invented here).
 *  - Prices are keyed by Stripe price ID, never by amount (Demand 4).
 *    The two $330 audit prices stay distinct entries: the hub funnel
 *    (mehyar.us /audit) and this worker's funnel (/business-audit) are
 *    different Prices on the same account and are never merged.
 *
 * Price IDs live in this server-side snapshot only. Public projections
 * (the /api/billing/catalog response, the ProductDescriptor as served)
 * carry catalog refs and amounts, never raw Stripe price IDs — the
 * pinned public-catalog contract (tests/billing-catalog.test.ts).
 */
import type {Env} from './env';
import {PLANS,CREDIT_PACKS,BILLING_VERSION,PRO_PRICE_VERSION,CREDIT_PACK_VERSION,FOUNDING_PRICE_CENTS} from './billing/plans';
import {foundingSeats,FOUNDING_UNAVAILABLE,type FoundingBlock} from './billing/founding';
import {AUDIT_OFFER} from './billing/audit';

/** The hub funnel's audit Price (mehyar.us /audit checkout). A registry
 * fact recorded in blueprint §4.2 — it is NOT configured on this worker
 * (the hub owns that checkout); it is listed here so the catalog can
 * never conflate the two $330 Prices. */
export const HUB_AUDIT_PRICE_ID='price_1URJh64NaXpNyV6yTyS1zCyN';

export type CatalogEnv=Pick<Env,'AGENT_DB'|'MAYOR_STRIPE_MODE'|'MAYOR_STRIPE_PRICE_ID'|'MAYOR_STRIPE_FOUNDING_PRICE_ID'|'MAYOR_STRIPE_CREDIT_PRICE_SMALL'|'MAYOR_STRIPE_CREDIT_PRICE_MEDIUM'|'MAYOR_STRIPE_CREDIT_PRICE_LARGE'|'MAYOR_STRIPE_AUDIT_PRICE_ID'>;

export interface CatalogPriceEntry {
 /** Stable catalog reference (the descriptor's price references point here). */
 ref:string;
 /** Stripe price ID — the catalog key. Null when unconfigured: the entry
  * is reported unavailable rather than pointed at a guessed ID. */
 priceId:string|null;
 cents:number;
 currency:'USD';
 kind:'subscription'|'one_time'|'credit_pack';
 interval?:string;
 funnel:'worker'|'hub';
 available:boolean;
}

export interface CatalogSnapshot {
 catalogVersion:string;
 priceVersion:string;
 creditPackVersion:string;
 currency:'USD';
 plans:typeof PLANS;
 creditPacks:typeof CREDIT_PACKS;
 foundingPriceCents:number;
 founding:FoundingBlock;
 /** Every price the product can charge, keyed by price ID. */
 prices:CatalogPriceEntry[];
}

function priceIdOrNull(value:string|undefined):string|null{
 return value&&/^price_[A-Za-z0-9]+$/.test(value)?value:null;
}

export async function readCatalog(env:CatalogEnv,founding?:FoundingBlock):Promise<CatalogSnapshot>{
 const block=founding??(env.AGENT_DB?await foundingSeats(env):FOUNDING_UNAVAILABLE);
 const pro=PLANS.find(p=>p.id==='pro')!;
 const packPriceIds:Record<string,string|undefined>={
  small:env.MAYOR_STRIPE_CREDIT_PRICE_SMALL,
  medium:env.MAYOR_STRIPE_CREDIT_PRICE_MEDIUM,
  large:env.MAYOR_STRIPE_CREDIT_PRICE_LARGE,
 };
 const prices:CatalogPriceEntry[]=[
  {ref:'pro',priceId:priceIdOrNull(env.MAYOR_STRIPE_PRICE_ID),cents:pro.priceCents,currency:'USD',kind:'subscription',interval:'month',funnel:'worker',available:priceIdOrNull(env.MAYOR_STRIPE_PRICE_ID)!==null},
  {ref:'founding',priceId:priceIdOrNull(env.MAYOR_STRIPE_FOUNDING_PRICE_ID),cents:FOUNDING_PRICE_CENTS,currency:'USD',kind:'subscription',interval:'month',funnel:'worker',available:priceIdOrNull(env.MAYOR_STRIPE_FOUNDING_PRICE_ID)!==null},
  ...CREDIT_PACKS.map(pack=>({ref:`pack:${pack.id}`,priceId:priceIdOrNull(packPriceIds[pack.id]),cents:pack.priceCents,currency:'USD' as const,kind:'credit_pack' as const,funnel:'worker' as const,available:priceIdOrNull(packPriceIds[pack.id])!==null})),
  {ref:'audit:worker',priceId:priceIdOrNull(env.MAYOR_STRIPE_AUDIT_PRICE_ID),cents:AUDIT_OFFER.priceCents,currency:'USD',kind:'one_time',funnel:'worker',available:priceIdOrNull(env.MAYOR_STRIPE_AUDIT_PRICE_ID)!==null},
  {ref:'audit:hub',priceId:HUB_AUDIT_PRICE_ID,cents:AUDIT_OFFER.priceCents,currency:'USD',kind:'one_time',funnel:'hub',available:true},
 ];
 return {
  catalogVersion:BILLING_VERSION,
  priceVersion:PRO_PRICE_VERSION,
  creditPackVersion:CREDIT_PACK_VERSION,
  currency:'USD',
  plans:PLANS,
  creditPacks:CREDIT_PACKS,
  foundingPriceCents:FOUNDING_PRICE_CENTS,
  founding:block,
  prices,
 };
}

/** Look up a catalog entry by the Stripe price ID it is keyed under. */
export function catalogEntryByPriceId(catalog:CatalogSnapshot,priceId:string):CatalogPriceEntry|null{
 return catalog.prices.find(entry=>entry.priceId===priceId)??null;
}
