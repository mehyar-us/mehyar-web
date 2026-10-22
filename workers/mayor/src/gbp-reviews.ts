import {z} from 'zod';
import type {Actor,Env} from './env';
import {HttpError} from './http';
import {OPERATORS,requireMembership} from './permissions';
import {capabilityStatus,providerConfigured} from './auth/capabilities';
import {connectorCredential} from './connectors/credentials';
import type {Operation} from './connectors/types';

/** P6 — Google Business Profile reviews + hours read.
 *
 * GROUND TRUTH (investigated 2026-10-12 against this repo + prod config):
 * - The existing Google OAuth grant CANNOT read Business Profile data today.
 *   Its capabilities are gmail_read / calendar_read / calendar_manage only,
 *   and production GOOGLE_ENABLED_CAPABILITIES is exactly
 *   "calendar_read,calendar_manage,gmail_read" (wrangler.production.jsonc).
 *   No grant can therefore carry the required scope
 *   https://www.googleapis.com/auth/business.manage — P6 adds that scope as
 *   the new `business_reviews` capability (src/auth/capabilities.ts), which
 *   stays disabled until the env flag enables it.
 * - Even with the scope, Google gates the Business Profile APIs themselves:
 *   the Cloud project needs Business Profile API access approved/enabled by
 *   Google, or mybusiness.googleapis.com / mybusinessbusinessinformation
 *   answer 403. That enablement lives in Google Cloud Console, not this repo.
 *
 * So this module is built behind the REAL API contract (accounts →
 * locations → reviews, hours from the location resource) and reports an
 * honest unavailable state — with the exact blocker named — whenever the
 * scope, the grant, or Google's API approval is missing. It NEVER invents
 * a review, a rating, or hours: a snapshot exists only after a real,
 * successful provider read, and is served with its "as of" timestamp.
 * Provider content (review text, reviewer names) is untrusted data.
 */

export const GBP_BUSINESS_SCOPE='https://www.googleapis.com/auth/business.manage';
export const GBP_REVIEWS_CAPABILITY='business_reviews';

/** The exact blockers that can stand between a tenant and a live read. */
export const GBP_API_ACCESS_BLOCKER='Google Business Profile API access approval for the Google Cloud project (mybusiness.googleapis.com + mybusinessbusinessinformation.googleapis.com)';

export const GBP_READ_OPERATION:Operation={
 name:'google.business.reviews.read',effect:'read',
 scopes:[[GBP_BUSINESS_SCOPE]],
};

export type GbpUnavailableReason=
 |'google_not_configured'|'token_custody_unavailable'|'capability_not_enabled'
 |'grant_missing'|'scope_not_granted'|'api_not_enabled_or_access_not_approved'
 |'provider_read_failed'|'no_locations';

export interface GbpReviewsAvailability{
 available:boolean;
 reason?:GbpUnavailableReason;
 /** Env var names / external approvals still missing — names only, never values. */
 missing:string[];
 /** Plain-language explanation safe to show the owner. */
 message:string;
}

const AVAILABLE_MESSAGE='Google Business Profile reviews and hours can be read with the connected Google account.';

/** Config-side availability: OAuth app present, token custody present, and
 * the business_reviews capability enabled. Says nothing about any tenant's
 * grant — that is grantAvailability below. */
export function gbpReviewsAvailability(env:Env):GbpReviewsAvailability{
 if(!providerConfigured(env,'google')){
  return {available:false,reason:'google_not_configured',missing:['GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','BETTER_AUTH_SECRET'],
   message:'Reviews are not readable yet: Google sign-in itself is not configured for The Mayor.'};
 }
 if(!env.TOKEN_ENCRYPTION_KEY){
  return {available:false,reason:'token_custody_unavailable',missing:['TOKEN_ENCRYPTION_KEY'],
   message:'Reviews are not readable yet: secure token storage is not configured, so Google access cannot be kept safely.'};
 }
 const capability=capabilityStatus(env).providers.google.capabilities.find(c=>c.id===GBP_REVIEWS_CAPABILITY);
 if(!capability?.enabled){
  return {available:false,reason:'capability_not_enabled',
   missing:[`GOOGLE_ENABLED_CAPABILITIES must include ${GBP_REVIEWS_CAPABILITY}`,`OAuth scope ${GBP_BUSINESS_SCOPE} must be approved on the Google consent screen`,GBP_API_ACCESS_BLOCKER],
   message:'Reviews are not readable yet: The Mayor\u2019s Google connection does not include the Business Profile permission (business.manage), and Google has to approve Business Profile API access for the app first. Your calendar connection is unaffected.'};
 }
 return {available:true,missing:[],message:AVAILABLE_MESSAGE};
}

/* --------------------------- pure parsing --------------------------- */

const STAR_VALUES:Record<string,number>={ONE:1,TWO:2,THREE:3,FOUR:4,FIVE:5};

export function starRatingValue(value:unknown):number|null{
 if(typeof value==='number'&&Number.isInteger(value)&&value>=1&&value<=5)return value;
 if(typeof value==='string')return STAR_VALUES[value]??null;
 return null;
}

export interface GbpReview{
 reviewerName:string|null;
 starRating:number|null;
 comment:string|null;
 createTime:string|null;
 updateTime:string|null;
}

const reviewSchema=z.object({
 starRating:z.unknown().optional(),
 comment:z.string().optional(),
 createTime:z.string().optional(),
 updateTime:z.string().optional(),
 reviewer:z.object({displayName:z.string().optional()}).passthrough().optional(),
}).passthrough();

/** Parse one provider review. Returns null for shapes we cannot honestly use. */
export function parseGbpReview(raw:unknown):GbpReview|null{
 const parsed=reviewSchema.safeParse(raw);
 if(!parsed.success)return null;
 const r=parsed.data;
 return {
  reviewerName:r.reviewer?.displayName?.trim().slice(0,120)||null,
  starRating:starRatingValue(r.starRating),
  comment:r.comment?.trim().slice(0,1000)||null,
  createTime:r.createTime??null,
  updateTime:r.updateTime??null,
 };
}

export interface GbpReviewsSummary{count:number;averageRating:number|null;latest:GbpReview|null}

/** Aggregate parsed reviews. Average uses rated reviews only and is rounded
 * to one decimal; latest is by update time, falling back to create time. */
export function summarizeGbpReviews(reviews:readonly GbpReview[]):GbpReviewsSummary{
 const rated=reviews.map(r=>r.starRating).filter((v):v is number=>v!=null);
 const averageRating=rated.length?Math.round((rated.reduce((a,b)=>a+b,0)/rated.length)*10)/10:null;
 const when=(r:GbpReview)=>Date.parse(r.updateTime??r.createTime??'')||0;
 const latest=reviews.length?[...reviews].sort((a,b)=>when(b)-when(a))[0]:null;
 return {count:reviews.length,averageRating,latest};
}

export interface GbpLocationHours{day:string;open:string|null;close:string|null}
export interface GbpLocation{
 /** Provider resource name, e.g. "locations/123". */
 name:string;
 title:string|null;
 timeZone:string|null;
 hours:GbpLocationHours[];
}

const timeOfDay=z.object({hours:z.number().optional(),minutes:z.number().optional()}).passthrough();
const locationSchema=z.object({
 name:z.string(),
 title:z.string().optional(),
 timeZone:z.string().optional(),
 regularHours:z.object({periods:z.array(z.object({
  openDay:z.string().optional(),closeDay:z.string().optional(),
  openTime:timeOfDay.optional(),closeTime:timeOfDay.optional(),
 }).passthrough()).optional()}).passthrough().optional(),
}).passthrough();

function clock(time:{hours?:number;minutes?:number}|undefined):string|null{
 if(!time||typeof time.hours!=='number')return null;
 return `${String(time.hours).padStart(2,'0')}:${String(time.minutes??0).padStart(2,'0')}`;
}

/** Parse one businessinformation location, including its regular hours. */
export function parseGbpLocation(raw:unknown):GbpLocation|null{
 const parsed=locationSchema.safeParse(raw);
 if(!parsed.success)return null;
 const loc=parsed.data;
 return {
  name:loc.name,
  title:loc.title?.trim().slice(0,200)||null,
  timeZone:loc.timeZone??null,
  hours:(loc.regularHours?.periods??[]).map(p=>({
   day:p.openDay??p.closeDay??'',
   open:clock(p.openTime),close:clock(p.closeTime),
  })).filter(h=>h.day),
 };
}

/* --------------------------- grant ground truth --------------------------- */

interface GrantRow{id:string;status:string;selected_capabilities:string;granted_scopes:string}

async function googleGrants(env:Env,actor:Actor):Promise<GrantRow[]>{
 const rows=await env.AGENT_DB.prepare(`SELECT id,status,selected_capabilities,granted_scopes FROM auth_provider_grants
  WHERE tenant_scope=? AND user_id=? AND provider='google' AND status!='revoked' ORDER BY updated_at DESC LIMIT 20`)
  .bind(actor.tenantId,actor.userId).all<GrantRow>();
 return rows.results;
}

function grantHasBusinessReviews(grant:GrantRow):boolean{
 try{
  const selected:unknown=JSON.parse(grant.selected_capabilities);
  const scopes:unknown=JSON.parse(grant.granted_scopes);
  return grant.status==='authorized'
   &&Array.isArray(selected)&&selected.includes(GBP_REVIEWS_CAPABILITY)
   &&Array.isArray(scopes)&&scopes.includes(GBP_BUSINESS_SCOPE);
 }catch{return false;}
}

/** True only when a live read CAN succeed for this tenant right now:
 * config enabled AND an authorized grant actually carrying the scope. */
export async function gbpReviewsCanSucceed(env:Env,actor:Actor):Promise<boolean>{
 try{
  if(!gbpReviewsAvailability(env).available)return false;
  return (await googleGrants(env,actor)).some(grantHasBusinessReviews);
 }catch{return false;}
}

async function grantAvailability(env:Env,actor:Actor):Promise<{grant:GrantRow|null;unavailable:GbpReviewsAvailability|null}>{
 const config=gbpReviewsAvailability(env);
 if(!config.available)return {grant:null,unavailable:config};
 const grants=await googleGrants(env,actor);
 const grant=grants.find(grantHasBusinessReviews);
 if(grant)return {grant,unavailable:null};
 if(grants.some(g=>g.status==='authorized')){
  return {grant:null,unavailable:{available:false,reason:'scope_not_granted',
   missing:[`OAuth scope ${GBP_BUSINESS_SCOPE} on an authorized Google grant for this business`],
   message:'Reviews are not readable yet: the connected Google account did not grant the Business Profile permission. Reconnect Google and approve the Business Profile access to turn reviews on.'}};
 }
 return {grant:null,unavailable:{available:false,reason:'grant_missing',missing:['An authorized Google grant for this business'],
  message:'Reviews are not readable yet: no Google account is connected for this business. Connect Google first.'}};
}

/* --------------------------- snapshot cache --------------------------- */

export interface GbpSnapshot{
 fetchedAt:string;
 locations:GbpLocation[];
 reviews:GbpReviewsSummary;
}

async function readCachedSnapshot(env:Env,tenantId:string):Promise<GbpSnapshot|null>{
 try{
  const row=await env.AGENT_DB.prepare('SELECT snapshot_json FROM mayor_gbp_snapshot WHERE tenant_id=?')
   .bind(tenantId).first<{snapshot_json:string}>();
  if(!row)return null;
  const parsed=JSON.parse(row.snapshot_json) as GbpSnapshot;
  return typeof parsed?.fetchedAt==='string'&&Array.isArray(parsed.locations)&&parsed.reviews?parsed:null;
 }catch{return null;}
}

async function storeSnapshot(env:Env,tenantId:string,grantId:string,snapshot:GbpSnapshot):Promise<void>{
 await env.AGENT_DB.prepare(`INSERT INTO mayor_gbp_snapshot(tenant_id,grant_id,snapshot_json,fetched_at)
  VALUES(?,?,?,?)
  ON CONFLICT(tenant_id) DO UPDATE SET grant_id=excluded.grant_id,snapshot_json=excluded.snapshot_json,fetched_at=excluded.fetched_at`)
  .bind(tenantId,grantId,JSON.stringify(snapshot),snapshot.fetchedAt).run();
}

/* --------------------------- live provider read --------------------------- */

async function boundedJson(response:Response):Promise<Record<string,unknown>>{
 const reader=response.body?.getReader();if(!reader)throw new Error('empty_provider_response');
 const decoder=new TextDecoder();let size=0,text='';
 for(;;){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.byteLength;
  if(size>262144){await reader.cancel();throw new Error('provider_response_too_large');}
  text+=decoder.decode(chunk.value,{stream:true});}
 const value:unknown=JSON.parse(text+decoder.decode());
 if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('invalid_provider_response');
 return value as Record<string,unknown>;
}

const apiUnavailable=(status:number):GbpReviewsAvailability=>({
 available:false,
 reason:status===403||status===404?'api_not_enabled_or_access_not_approved':'provider_read_failed',
 missing:status===403||status===404?[GBP_API_ACCESS_BLOCKER]:[],
 message:status===403||status===404
  ?'Reviews are not readable yet: Google has not enabled Business Profile API access for The Mayor\u2019s app, so Google refused the read. Nothing about your listing is wrong — this is an app approval Google has to grant first.'
  :'Reviews could not be read from Google just now. Try again in a bit; if it keeps failing, reconnect Google.',
});

/** Attempt a real live read now. On success the snapshot is cached
 * (tenant-scoped) and returned; on any blocker an honest unavailable
 * result is returned — this function does not throw for provider or
 * configuration failures, only for role/tenant failures. */
export async function refreshGbpReviews(env:Env,actor:Actor,transport:typeof fetch=fetch,now=new Date()):Promise<{
 live:boolean;availability:GbpReviewsAvailability;snapshot:GbpSnapshot|null;asOf:string|null;
}>{
 await requireMembership(env,actor,OPERATORS);
 const {grant,unavailable}=await grantAvailability(env,actor);
 if(!grant||unavailable)return {live:false,availability:unavailable!,snapshot:await readCachedSnapshot(env,actor.tenantId),asOf:null};
 let accessToken:string;
 try{
  accessToken=(await connectorCredential(env,actor,grant.id,'google',GBP_READ_OPERATION,transport)).accessToken;
 }catch(error){
  if(error instanceof HttpError&&error.code==='insufficient_scope')
   return {live:false,availability:{available:false,reason:'scope_not_granted',missing:[`OAuth scope ${GBP_BUSINESS_SCOPE}`],
     message:'Reviews are not readable yet: the connected Google account did not grant the Business Profile permission. Reconnect Google and approve the Business Profile access to turn reviews on.'},
    snapshot:await readCachedSnapshot(env,actor.tenantId),asOf:null};
  return {live:false,availability:{available:false,reason:'provider_read_failed',missing:[],
    message:'Reviews could not be read: the Google connection needs attention. Reconnect Google and try again.'},
   snapshot:await readCachedSnapshot(env,actor.tenantId),asOf:null};
 }
 const headers={authorization:`Bearer ${accessToken}`,accept:'application/json'};
 const get=async(url:string)=>{const response=await transport(url,{method:'GET',headers,redirect:'manual',signal:AbortSignal.timeout(15000)});return response;};
 try{
  const accountsRes=await get('https://mybusinessaccountmanagement.googleapis.com/v1/accounts');
  if(!accountsRes.ok){await accountsRes.body?.cancel();return {live:false,availability:apiUnavailable(accountsRes.status),snapshot:await readCachedSnapshot(env,actor.tenantId),asOf:null};}
  const accounts=await boundedJson(accountsRes);
  const accountName=(accounts.accounts as Array<{name?:unknown}>|undefined)?.find(a=>typeof a?.name==='string')?.name as string|undefined;
  if(!accountName)return {live:false,availability:{available:false,reason:'no_locations',missing:[],
    message:'No Google Business Profile account was found for the connected Google account, so there are no reviews to read.'},
   snapshot:null,asOf:null};
  const locationsRes=await get(`https://mybusinessbusinessinformation.googleapis.com/v1/${accountName}/locations?readMask=name,title,regularHours,timeZone&pageSize=100`);
  if(!locationsRes.ok){await locationsRes.body?.cancel();return {live:false,availability:apiUnavailable(locationsRes.status),snapshot:await readCachedSnapshot(env,actor.tenantId),asOf:null};}
  const locationsRaw=await boundedJson(locationsRes);
  const locations=((locationsRaw.locations as unknown[]|undefined)??[]).map(parseGbpLocation).filter((l):l is GbpLocation=>Boolean(l)).slice(0,10);
  if(!locations.length)return {live:false,availability:{available:false,reason:'no_locations',missing:[],
    message:'The connected Google account manages no business locations, so there are no reviews to read.'},
   snapshot:null,asOf:null};
  const reviews:GbpReview[]=[];
  for(const location of locations.slice(0,5)){
   const res=await get(`https://mybusiness.googleapis.com/v4/${accountName}/${location.name}/reviews?pageSize=50`);
   if(!res.ok){await res.body?.cancel();return {live:false,availability:apiUnavailable(res.status),snapshot:await readCachedSnapshot(env,actor.tenantId),asOf:null};}
   const body=await boundedJson(res);
   for(const raw of (body.reviews as unknown[]|undefined)??[]){const review=parseGbpReview(raw);if(review)reviews.push(review);}
  }
  const snapshot:GbpSnapshot={fetchedAt:now.toISOString(),locations,reviews:summarizeGbpReviews(reviews)};
  await storeSnapshot(env,actor.tenantId,grant.id,snapshot);
  await requireMembership(env,actor,OPERATORS);
  return {live:true,availability:{available:true,missing:[],message:AVAILABLE_MESSAGE},snapshot,asOf:snapshot.fetchedAt};
 }catch{
  return {live:false,availability:{available:false,reason:'provider_read_failed',missing:[],
   message:'Reviews could not be read from Google just now. Try again in a bit.'},
  snapshot:await readCachedSnapshot(env,actor.tenantId),asOf:null};
 }
}

/** Status + last real snapshot for the Connections/Today surface. Never
 * fetches live on a plain read; `live` is true only when a real read has
 * succeeded (cached snapshot present) or can succeed with the stored grant
 * AND a snapshot backs it. asOf is the snapshot's own timestamp. */
export async function getGbpReviews(env:Env,actor:Actor):Promise<{
 live:boolean;availability:GbpReviewsAvailability;snapshot:GbpSnapshot|null;asOf:string|null;canSucceed:boolean;
}>{
 await requireMembership(env,actor,OPERATORS);
 const [snapshot,{unavailable}]=await Promise.all([
  readCachedSnapshot(env,actor.tenantId),
  grantAvailability(env,actor).catch(()=>({grant:null,unavailable:gbpReviewsAvailability(env)})),
 ]);
 const availability=unavailable??{available:true,missing:[],message:AVAILABLE_MESSAGE};
 return {
  live:Boolean(snapshot),
  availability,
  snapshot,
  asOf:snapshot?.fetchedAt??null,
  canSucceed:availability.available,
 };
}
