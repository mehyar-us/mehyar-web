import type {Env} from '../env';
import {FOUNDING_SEATS_TOTAL} from './plans';
import {mode} from './stripe';

/** The locked founding-cohort seam (Product/Marketing, 2026-10-16): the
 * offer surface carries exactly this block. available:false + null counts
 * means the count could not be computed — surfaces then show NO number,
 * never a guessed figure. Counts read ONLY the worker's billing state
 * (the rows the webhook/sync writer maintains in
 * mayor_billing_subscriptions), never a cached or manual number. */
export interface FoundingBlock {available:boolean;seats_total:number;seats_taken:number|null;seats_remaining:number|null;}
export type FoundingEnv=Pick<Env,'AGENT_DB'|'MAYOR_STRIPE_MODE'|'MAYOR_STRIPE_FOUNDING_PRICE_ID'>;
export const FOUNDING_UNAVAILABLE:FoundingBlock={available:false,seats_total:FOUNDING_SEATS_TOTAL,seats_taken:null,seats_remaining:null};

export async function foundingSeats(env:FoundingEnv):Promise<FoundingBlock>{
 try{
  const selected=mode(env),priceId=env.MAYOR_STRIPE_FOUNDING_PRICE_ID;
  if(!selected||!/^price_[A-Za-z0-9]+$/.test(priceId??''))return FOUNDING_UNAVAILABLE;
  // A seat is held from the moment a founding subscription is created and
  // released when it leaves a seat-holding state (canceled/expired rows
  // keep their last status, so they stop counting automatically).
  const row=await env.AGENT_DB.prepare("SELECT COUNT(*) AS held FROM mayor_billing_subscriptions WHERE mode=? AND price_id=? AND status IN ('active','trialing')").bind(selected,priceId).first<{held:number}>();
  const taken=Math.max(0,Math.min(FOUNDING_SEATS_TOTAL,Number(row?.held??0)));
  return {available:true,seats_total:FOUNDING_SEATS_TOTAL,seats_taken:taken,seats_remaining:FOUNDING_SEATS_TOTAL-taken};
 }catch{return FOUNDING_UNAVAILABLE;}
}

/** Open founding checkouts reserve their seat at the gate: two checkouts
 * opened at 24 holders must not both be sold seat 25. A checkout row is
 * stamped cohort='founding' at creation; pending/open + unexpired counts. */
export async function foundingOpenCheckouts(env:FoundingEnv):Promise<number>{
 const selected=mode(env);if(!selected)return 0;
 const row=await env.AGENT_DB.prepare("SELECT COUNT(*) AS open FROM mayor_billing_checkouts WHERE mode=? AND cohort='founding' AND status IN ('pending','open') AND (expires_at IS NULL OR expires_at>?)").bind(selected,Math.floor(Date.now()/1000)).first<{open:number}>();
 return Math.max(0,Number(row?.open??0));
}

/** The checkout-creation gate (the enforcement backstop behind the
 * display swap): founding checkout is offered only while a seat remains
 * after current holders AND in-flight founding checkouts. */
export async function foundingGateOpen(env:FoundingEnv):Promise<boolean>{
 const seats=await foundingSeats(env);
 if(!seats.available||seats.seats_remaining===null||seats.seats_remaining<=0)return false;
 const open=await foundingOpenCheckouts(env).catch(()=>Number.MAX_SAFE_INTEGER);
 return seats.seats_remaining-open>0;
}
