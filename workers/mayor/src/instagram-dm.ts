import {z} from 'zod';
import type {Env} from './env';
import {HttpError,json,readJson} from './http';

/** Crew 6f: Instagram DM → lead ingestion, DARK behind INSTAGRAM_DM_ENABLED.
 *
 * Meta App Review for the required permissions (instagram_manage_messages) is
 * still pending on the owner's FB session, so this entire path MUST stay dark
 * in production. When the flag is off (the default), the webhook route returns
 * 404 — it must NOT verify with Meta (a 200 verify would hand Meta a live
 * subscription we are not allowed to hold) and NO DM code path executes.
 *
 * What this builds (dark): webhook verification handshake, inbound DM event
 * parsing (text / attachments / echoes), and ingestion as an inbound
 * `mayor_sms_log` row in the EXACT shape `detectUnansweredLeads` already
 * consumes ({id,from_number,body,created_at}). Nothing is forked: a DM older
 * than the vertical's `unansweredLeadMinutes` flows through the existing
 * detector → `createSuggestionCard` (kind 'lead_reply') → [Send][Edit][Dismiss]
 * pipeline, same as every other unanswered lead.
 *
 * What remains to light it up (documented, not built):
 *  1. Meta App Review approval for instagram_manage_messages.
 *  2. D1-backed page→tenant connection table + OAuth connect flow, replacing
 *     the dark-stage INSTAGRAM_DM_TENANT_MAP env mapping below.
 *  3. Owner flips INSTAGRAM_DM_ENABLED=1 (and sets the secrets).
 *  4. Outbound transport: `sendSuggestionCard` currently sends SMS via Telnyx;
 *     a lit IG path needs the Graph API reply endpoint instead, and outbound
 *     IG replies recorded into mayor_sms_log (direction='outbound',
 *     to_number='ig:<senderId>') so the detector's reply check resolves DMs. */

/** Feature flag. '1' = enabled. Anything else (including unset) = DARK. */
export function isInstagramDmEnabled(env:Env):boolean{
 return env.INSTAGRAM_DM_ENABLED==='1';
}

/** Never let a secret value reach a log line or error message: callers log the
 * presence, never the value. Exported so tests can assert the contract. */
export function redactSecret(value:string|undefined|null):'set'|'unset'{
 return value?'set':'unset';
}

const tenantMapSchema=z.record(z.string(),z.string().regex(/^[a-f0-9]{32}$/))
 .refine(m=>Object.keys(m).length<=50,{message:'tenant map too large'});

/** Dark-stage page → tenant resolution. Light-up replaces this with a D1
 * connection table managed by the OAuth connect flow; until then the owner
 * sets INSTAGRAM_DM_TENANT_MAP='{"<pageId>":"<tenantId>"}' in test/dev only.
 * Unknown pages are skipped (logged, no retry storm). */
export function resolveTenantForPage(env:Env,pageId:string):string|null{
 const raw=env.INSTAGRAM_DM_TENANT_MAP;
 if(!raw)return null;
 let parsed:unknown;
 try{parsed=JSON.parse(raw);}catch{return null;}
 const map=tenantMapSchema.safeParse(parsed);
 if(!map.success)return null;
 const tenantId=map.data[pageId];
 return tenantId??null;
}

/** Constant-time-ish string compare for the verify token. */
function safeEqual(a:string,b:string):boolean{
 const ab=new TextEncoder().encode(a),bb=new TextEncoder().encode(b);
 if(ab.length!==bb.length)return false;
 let diff=0;
 for(let i=0;i<ab.length;i++)diff|=ab[i]^bb[i];
 return diff===0;
}

/* ---------------- Meta webhook payloads ---------------- */

const messagingEventSchema=z.object({
 sender:z.object({id:z.string().min(1).max(64)}),
 recipient:z.object({id:z.string().min(1).max(64)}),
 timestamp:z.number().int().positive(),
 message:z.object({
  mid:z.string().min(1).max(128),
  text:z.string().max(2000).optional(),
  attachments:z.array(z.object({type:z.string().max(32)})).max(10).optional(),
  is_echo:z.boolean().optional(),
 }).optional(),
 postback:z.object({mid:z.string().max(128).optional(),payload:z.string().max(512).optional()}).optional(),
}).passthrough();
type MessagingEvent=z.infer<typeof messagingEventSchema>;

const webhookSchema=z.object({
 object:z.literal('instagram'),
 entry:z.array(z.object({
  id:z.string().min(1).max(64),
  time:z.number().int().optional(),
  messaging:z.array(messagingEventSchema).max(100).optional().default([]),
 })).max(50),
});

export interface ParsedInstagramDm{
 /** True for our own sends / echoes — must be ignored, never ingested. */
 isEcho:boolean;
 senderId:string;
 pageId:string;
 mid:string;
 timestampMs:number;
 /** Null for attachment-only messages. */
 text:string|null;
 hasAttachment:boolean;
}

/** Parse one Meta messaging event into the DM shape the pipeline consumes.
 * Exported pure for tests. Read-receipts, deliveries, and postbacks carry no
 * message → return null (nothing to ingest). */
export function parseInstagramEvent(entryId:string,event:unknown):ParsedInstagramDm|null{
 const parsed=messagingEventSchema.safeParse(event);
 if(!parsed.success)return null;
 const e:MessagingEvent=parsed.data;
 if(!e.message)return null;
 const isEcho=e.message.is_echo===true||e.sender.id===e.recipient.id;
 return {
  isEcho,
  senderId:e.sender.id,
  pageId:entryId,
  mid:e.message.mid,
  timestampMs:e.timestamp,
  text:typeof e.message.text==='string'&&e.message.text.length?e.message.text:null,
  hasAttachment:(e.message.attachments?.length??0)>0,
 };
}

/* ---------------- unanswered-lead detector input ---------------- */

/** The exact shape `detectUnansweredLeads` (proactive-detectors.ts) consumes
 * from mayor_sms_log: it SELECTs id, from_number, body, created_at for
 * direction='inbound' rows. A DM is recorded with a namespaced from_number
 * ('ig:<senderId>') so it never collides with phone leads. */
export interface UnansweredLeadDmRow{
 id:string;
 tenant_id:string;
 direction:'inbound';
 to_number:string;
 from_number:string;
 body:string;
 provider_message_id:string;
 status:'received';
 created_at:string;
}

export function buildUnansweredLeadRow(tenantId:string,dm:ParsedInstagramDm):UnansweredLeadDmRow{
 return {
  id:`igdm:${dm.mid}`,
  tenant_id:tenantId,
  direction:'inbound',
  to_number:`ig:${dm.pageId}`,
  from_number:`ig:${dm.senderId}`,
  body:dm.text??'[attachment received]',
  provider_message_id:dm.mid,
  status:'received',
  created_at:new Date(dm.timestampMs).toISOString(),
 };
}

/** Record the inbound DM idempotently. Returns true when a new row was
 * written. The existing 5-minute proactive cycle picks the row up via
 * `detectUnansweredLeads` → `createSuggestionCard` (kind 'lead_reply') once
 * it is older than the vertical's unansweredLeadMinutes. */
export async function ingestInstagramDm(env:Env,tenantId:string,dm:ParsedInstagramDm):Promise<boolean>{
 if(dm.isEcho)return false;
 const row=buildUnansweredLeadRow(tenantId,dm);
 const result=await env.AGENT_DB.prepare(
  `INSERT INTO mayor_sms_log(id,tenant_id,direction,to_number,from_number,body,provider_message_id,status,created_at)
   SELECT ?,?,?,?,?,?,?,?,?
   WHERE NOT EXISTS(SELECT 1 FROM mayor_sms_log WHERE tenant_id=? AND id=?)`)
  .bind(row.id,row.tenant_id,row.direction,row.to_number,row.from_number,row.body,
   row.provider_message_id,row.status,row.created_at,row.tenant_id,row.id).run();
 const inserted=(result as unknown as {meta?:{changes?:number}}).meta?.changes??1;
 if(inserted>0){
  console.log(JSON.stringify({event:'instagram_dm_ingested',tenant:tenantId,dedupe_key:row.id,has_text:dm.text!==null,has_attachment:dm.hasAttachment}));
 }
 return inserted>0;
}

/* ---------------- HTTP handler ---------------- */

/** GET: Meta's verification handshake. Never reached while dark. */
function verifyHandshake(request:Request,env:Env):Response{
 const params=new URL(request.url).searchParams;
 const mode=params.get('hub.mode'),token=params.get('hub.verify_token'),challenge=params.get('hub.challenge');
 const expected=env.INSTAGRAM_VERIFY_TOKEN;
 if(mode!=='subscribe'||!token||!challenge||!expected||!safeEqual(token,expected)){
  console.warn(JSON.stringify({event:'instagram_verify_rejected',verify_token:redactSecret(expected)}));
  throw new HttpError(403,'verify_failed','Instagram webhook verification failed.');
 }
 // Plain-text challenge per Meta's docs; no secrets in the response.
 return new Response(challenge,{status:200,headers:{'content-type':'text/plain','cache-control':'no-store'}});
}

/** The single entry point, registered at POST|GET /api/webhooks/instagram.
 * Flag-gated FIRST: dark → 404, before any verification or parsing runs. */
export async function handleInstagramWebhook(request:Request,env:Env):Promise<Response>{
 if(!isInstagramDmEnabled(env)){
  // DARK: must not verify with Meta while the review is pending.
  throw new HttpError(404,'not_found','Not found.');
 }
 if(request.method==='GET')return verifyHandshake(request,env);
 if(request.method!=='POST')throw new HttpError(405,'method_not_allowed','Use GET to verify or POST for events.');
 const data=await readJson(request,65536);
 const parsed=webhookSchema.safeParse(data);
 if(!parsed.success)throw new HttpError(400,'invalid_webhook','Expected an Instagram webhook event.');
 let ingested=0,skipped=0;
 for(const entry of parsed.data.entry){
  for(const raw of entry.messaging){
   const dm=parseInstagramEvent(entry.id,raw);
   if(!dm){skipped++;continue;}
   if(dm.isEcho){skipped++;continue;} // our own sends / echoes are never leads
   const tenantId=resolveTenantForPage(env,dm.pageId);
   if(!tenantId){
    console.warn(JSON.stringify({event:'instagram_dm_unmapped_page',page_configured:false}));
    skipped++;continue;
   }
   if(await ingestInstagramDm(env,tenantId,dm))ingested++;else skipped++;
  }
 }
 return json({received:true,ingested,skipped});
}
