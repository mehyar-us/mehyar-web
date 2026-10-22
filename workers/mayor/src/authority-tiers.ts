import {z} from 'zod';
import type {Env} from './env';
import {HttpError} from './http';
import {OPERATORS} from './permissions';

/** P1 authority tiers (vision): the owner decides, per action type, how much
 * authority The Mayor has — read-only, draft-for-approval, or act automatically
 * inside the owner's rules. Single source of truth is the mayor_authority_tiers
 * D1 table; every query carries tenant_id (tenant isolation invariant). */

export const AUTHORITY_TIERS=['readonly','draft','auto'] as const;
export type AuthorityTier=typeof AUTHORITY_TIERS[number];
export const AUTHORITY_ACTIONS=['booking','textback','call','suggestion_send'] as const;
export type AuthorityAction=typeof AUTHORITY_ACTIONS[number];

export const authorityTierSchema=z.enum(AUTHORITY_TIERS);
export const authorityActionSchema=z.enum(AUTHORITY_ACTIONS);
export const authorityTierSetSchema=z.object({action:authorityActionSchema,tier:authorityTierSchema}).strict();

/** Default when the owner never set a tier: draft-for-approval. Auto is never
 *  the default — it is always an explicit owner choice. */
export const DEFAULT_AUTHORITY_TIER:AuthorityTier='draft';

type Db=Env['AGENT_DB'];

export async function getAuthorityTier(db:Db,tenantId:string,action:AuthorityAction):Promise<AuthorityTier>{
 authorityActionSchema.parse(action);
 const row=await db.prepare('SELECT tier FROM mayor_authority_tiers WHERE tenant_id=? AND action=?')
  .bind(tenantId,action).first<{tier:string}>();
 const parsed=authorityTierSchema.safeParse(row?.tier);
 return parsed.success?parsed.data:DEFAULT_AUTHORITY_TIER;
}

/** The explicitly stored tier, or null when the owner never set one.
 *  No-approval behaviors (auto-send, auto-book) require an explicit 'auto' —
 *  never a default and never a legacy inference. */
export async function getExplicitAuthorityTier(db:Db,tenantId:string,action:AuthorityAction):Promise<AuthorityTier|null>{
 authorityActionSchema.parse(action);
 const row=await db.prepare('SELECT tier FROM mayor_authority_tiers WHERE tenant_id=? AND action=?')
  .bind(tenantId,action).first<{tier:string}>();
 const parsed=authorityTierSchema.safeParse(row?.tier);
 return parsed.success?parsed.data:null;
}

export async function setAuthorityTier(db:Db,tenantId:string,action:AuthorityAction,tier:AuthorityTier,actorRole:string):Promise<void>{
 authorityActionSchema.parse(action);
 authorityTierSchema.parse(tier);
 if(!(OPERATORS as readonly string[]).includes(actorRole))
  throw new HttpError(403,'permission_denied','Only an owner or manager can set how The Mayor acts.');
 const now=new Date().toISOString();
 await db.prepare(`INSERT INTO mayor_authority_tiers(tenant_id,action,tier,updated_at) VALUES(?,?,?,?)
  ON CONFLICT(tenant_id,action) DO UPDATE SET tier=excluded.tier,updated_at=excluded.updated_at`)
  .bind(tenantId,action,tier,now).run();
}

export async function listAuthorityTiers(db:Db,tenantId:string):Promise<Array<{action:AuthorityAction;tier:AuthorityTier;explicit:boolean}>>{
 const rows=await db.prepare('SELECT action,tier FROM mayor_authority_tiers WHERE tenant_id=?')
  .bind(tenantId).all<{action:string;tier:string}>();
 const explicit=new Map<AuthorityAction,AuthorityTier>();
 for(const row of rows.results){
  const action=authorityActionSchema.safeParse(row.action),tier=authorityTierSchema.safeParse(row.tier);
  if(action.success&&tier.success)explicit.set(action.data,tier.data);
 }
 return AUTHORITY_ACTIONS.map(action=>({action,tier:explicit.get(action)??DEFAULT_AUTHORITY_TIER,explicit:explicit.has(action)}));
}

/** Legacy liveSms toggle maps onto tiers for READING only: liveSms ON reads as
 *  'auto' for the send family (suggestion_send/textback). This preserves the old
 *  toggle's display meaning. It never grants no-approval behavior — auto-send
 *  and auto-book check getExplicitAuthorityTier, not this. */
export function effectiveTier(action:AuthorityAction,explicit:AuthorityTier|null,liveSms:boolean):AuthorityTier{
 if(explicit)return explicit;
 if(liveSms&&(action==='suggestion_send'||action==='textback'))return 'auto';
 return DEFAULT_AUTHORITY_TIER;
}

/** No-approval auto-send is allowed only when the owner explicitly chose 'auto'. */
export function autoSendAllowed(explicit:AuthorityTier|null):boolean{
 return explicit==='auto';
}

/* ---------------- user-facing copy (compliance item 12: honest claims) ---------------- */
/** Plain-language tier labels for the 3-option selector. */
export const TIER_LABELS:Record<AuthorityTier,string>={
 readonly:'Ask me first',
 draft:'Draft for my approval',
 auto:'Act automatically',
};
/** Plain-language action labels. */
export const ACTION_LABELS:Record<AuthorityAction,string>={
 booking:'Booking appointments',
 textback:'Texting back missed calls',
 call:'Placing phone calls',
 suggestion_send:'Sending suggestion texts',
};
/** What each tier actually does, per action. Every sentence describes implemented
 *  behavior — never a capability that does not exist. */
export const TIER_DESCRIPTIONS:Record<AuthorityAction,Record<AuthorityTier,string>>={
 booking:{
  readonly:'The Mayor shows availability but will not create appointments. You book them yourself.',
  draft:'The Mayor prepares each appointment for your review. Nothing is booked until you confirm it.',
  auto:'The Mayor books appointments directly from approved requests. Every booking is logged and you are notified.',
 },
 textback:{
  readonly:'The Mayor prepares a text-back draft for your review. Nothing is sent until you approve it.',
  draft:'The Mayor drafts the text-back. You review it and send it yourself.',
  auto:'The Mayor texts back missed calls automatically using your confirmed message. Every text is logged.',
 },
 call:{
  readonly:'The Mayor will not place calls. You make them yourself.',
  draft:'The Mayor prepares call details for your review before anything is dialed.',
  auto:'The Mayor does not place outbound calls on its own today — this sets the rule for if that ever becomes available. Every call would be logged.',
 },
 suggestion_send:{
  readonly:'The Mayor drafts suggestion texts for your review. Nothing is sent without your approval.',
  draft:'The Mayor prepares each suggestion. You review, edit, and send it yourself.',
  auto:'The Mayor sends suggestion texts without asking each time. Every send is logged. Real texts only reach customers when live sending is on and a phone number is connected.',
 },
};
