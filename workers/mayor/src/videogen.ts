/* ============================================================================
 * Crew 7e — Video studio: owner-approved AI video job lifecycle.
 *
 * THE WORKER NEVER GENERATES VIDEO. The worker does not call Muse's media
 * pipeline and never calls a third-party video API. Instead, this module owns
 * the JOB LIFECYCLE and a clean handoff contract:
 *
 *   HANDOFF CONTRACT (runner side, outside this worker):
 *   1. Poll `claimVideoJob(env, {workerId})` on a loop/cron. It atomically
 *      moves ONE job from `queued` to `generating` (or reclaims one whose
 *      lease expired) and returns the full job record, or null when nothing
 *      is queued.
 *   2. Generate the video via Muse's media pipeline (native text-to-video,
 *      every clip ffprobe-verified 1280x720 — per the standing video
 *      generation ownership rule). Burn in the captions carried on
 *      `job.caption_text`, styled with `job.brand.primaryColor` /
 *      `job.brand.secondaryColor` on `job.brand.backgroundColor`.
 *      Synthesize the voiceover from `job.voiceover_text` if the job has no
 *      spoken track; follow the approved `job.storyboard` shot list exactly.
 *   3. Host the finished file (e.g. R2 with a public URL) and call
 *      `completeVideoJob(env, job.id, assetUrl)` — the URL must be https.
 *      On failure, call `failVideoJob(env, job.id, reason)` with a human
 *      readable reason; the owner sees it in the studio and can retry.
 *
 *   JOB LIFECYCLE (owner side):
 *     draft -> script_pending -> script_approved -> storyboard_pending
 *       -> storyboard_approved -> queued -> generating -> ready | failed
 *   The owner approves the SCRIPT first, then the STORYBOARD, each explicitly.
 *   `queued` is only reachable through storyboard approval, so generation
 *   never starts without both approvals on record (who + when).
 *
 * INTEGRATION: the index.ts owner wires `handleVideogenRequest(request, env,
 * actor)` inside the authenticated business block (same pattern as
 * handleOperationsRequest), or registers patterns via registerVideogenRoutes.
 * ========================================================================== */

import {z} from 'zod';
import type {Actor,Env} from './env';
import {HttpError,json,readJson,requireOrigin} from './http';
import {OPERATORS,requireMembership} from './permissions';
import {verticalProfile,verticalSchema} from './verticals';

/* ---------------- types ---------------- */

export const VIDEO_TYPES={
 service_promo_15s:{label:'Service promo',durationSeconds:15},
 offer_announcement_30s:{label:'Offer announcement',durationSeconds:30},
} as const;
export type VideoJobType=keyof typeof VIDEO_TYPES;
export const VIDEO_JOB_TYPES=Object.keys(VIDEO_TYPES) as VideoJobType[];

export const VIDEO_JOB_STATUSES=[
 'draft','script_pending','script_approved',
 'storyboard_pending','storyboard_approved',
 'queued','generating','ready','failed',
] as const;
export type VideoJobStatus=(typeof VIDEO_JOB_STATUSES)[number];

/** One approved storyboard shot. durations_s must sum to the job duration. */
export const storyboardShotSchema=z.object({
 n:z.number().int().min(1).max(12),
 duration_s:z.number().min(1).max(30),
 scene:z.string().min(8).max(600),
 onscreen_text:z.string().max(220),
});
export type StoryboardShot=z.infer<typeof storyboardShotSchema>;

const brandSchema=z.object({
 name:z.string().min(1).max(160).optional(),
 primaryColor:z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
 secondaryColor:z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
 backgroundColor:z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
 logoUrl:z.string().url().optional(),
});
export type VideoBrand=z.infer<typeof brandSchema>;

const createJobSchema=z.object({
 type:z.enum(VIDEO_JOB_TYPES as [VideoJobType,...VideoJobType[]]),
 businessName:z.string().trim().min(1).max(160).optional(),
 vertical:verticalSchema.optional(),
 offer:z.string().trim().min(1).max(300).optional(),
 services:z.string().trim().min(1).max(600).optional(),
 brand:brandSchema.optional(),
});
const approveScriptSchema=z.object({script:z.string().trim().min(10).max(4000)});
const approveStoryboardSchema=z.object({shots:z.array(storyboardShotSchema).min(1).max(12)});


export interface VideoJobView{
 id:string;type:VideoJobType;status:VideoJobStatus;
 businessName:string|null;vertical:string;
 script:string|null;scriptApproved:{by:string;at:string}|null;
 storyboard:StoryboardShot[]|null;storyboardApproved:{by:string;at:string}|null;
 voiceoverText:string|null;captionText:string|null;brand:VideoBrand|null;
 resultAssetUrl:string|null;failureReason:string|null;
 canceled:boolean;
 createdAt:string;updatedAt:string;
}

/* ---------------- compliance guardrails (items 11-12) ----------------
 * No fake reviews/testimonials and no unsupported claims may enter an
 * owner-approved script, an offer line, or storyboard on-screen text.
 * These patterns reject invented endorsements ("Our clients love us"),
 * quoted customer attributions, and guaranteed-results language.          */
const CLAIM_PATTERNS:{pattern:RegExp;label:string}[]=[
 {pattern:/guarantee[ds]?(?![a-z])/i,label:'guaranteed-results language'},
 {pattern:/results?\s+(guaranteed|promised|assured)/i,label:'promised results'},
 {pattern:/(?:^|[^0-9a-zA-Z])#1(?:[^0-9a-zA-Z]|$)/,label:'"#1" superlative'},
 {pattern:/number\s+one/i,label:'"number one" superlative'},
 {pattern:/best\s+in\s+(town|city|brooklyn|the\s+area|america|the\s+country)/i,label:'unsupported "best in" claim'},
 {pattern:/our\s+(customers|clients|guests|patients)\s+(say|love|agree|rave|swear)/i,label:'invented customer endorsement'},
 {pattern:/(clients|customers|guests|patients)\s+(love|rave\s+about|can't\s+stop)/i,label:'invented customer endorsement'},
 {pattern:/5[-\s]?star/i,label:'star-rating claim'},
 {pattern:/five[-\s]?star/i,label:'star-rating claim'},
 {pattern:/reviews?\s+(say|prove|show|confirm)/i,label:'unsupported review claim'},
 {pattern:/testimonial/i,label:'testimonial language'},
 {pattern:/everyone\s+(says|loves|agrees|knows)/i,label:'invented consensus'},
 {pattern:/"[^"]{5,140}"\s*[—–-]\s*[A-Z][a-z]+/u,label:'quoted customer attribution'},
 {pattern:/you('ll| will)\s+save\b/i,label:'unsupported savings claim'},
 {pattern:/\b\d+\s*%\s*(more\s+customers|guaranteed)/i,label:'unsupported percentage claim'},
];
/** Returns the labels of the first unsupported-claim matches found, or []. */
export function findUnsupportedClaims(text:string):string[]{
 const found:string[]=[];
 for(const {pattern,label}of CLAIM_PATTERNS){
  pattern.lastIndex=0;
  if(pattern.test(text))found.push(label);
 }
 return [...new Set(found)];
}
function assertCleanCopy(field:string,text:string){
 const hits=findUnsupportedClaims(text);
 if(hits.length)throw new HttpError(422,'unsupported_claims',`This ${field} cannot be approved: ${hits.join('; ')}. Rewrite it with claims you can stand behind.`);
}

/* ---------------- deterministic vertical-voiced drafting ----------------
 * Deterministic brief injection (the assistant-persona pattern): explicit
 * vertical vocabulary + tone baked into the draft template, not hoped for
 * from a model call. Owner-editable at every approval step.              */

const HOOK_BY_VERTICAL:Record<string,string>={
 salon:'Cuts, color, and styling from stylists who listen.',
 restaurant:'Great food, served warm and on time.',
 plumbing_hvac:'Repairs and installs done right, the first time.',
 dental:'Gentle care for the whole family.',
 auto_repair:'Honest repairs from technicians you can trust.',
 other:'Local service you can count on.',
};
const CTA_BY_VERTICAL:Record<string,string>={
 salon:'Walk in or book ahead — we will save you a chair.',
 restaurant:'Book your table tonight.',
 plumbing_hvac:'Call now — help is on the way.',
 dental:'Call to schedule your visit.',
 auto_repair:'Stop by or book your service appointment online.',
 other:'Call or book online today.',
};

export interface ScriptBrief{
 businessName:string;
 vertical:string;
 type:VideoJobType;
 offer?:string;
 services?:string;
}
function briefContext(brief:ScriptBrief){
 const vp=verticalProfile(brief.vertical);
 const hook=HOOK_BY_VERTICAL[vp.vertical]??HOOK_BY_VERTICAL.other;
 const cta=CTA_BY_VERTICAL[vp.vertical]??CTA_BY_VERTICAL.other;
 const name=brief.businessName;
 const v=vp.vocabulary;
 return {vp,hook,cta,name,v};
}
/** Deterministic script draft: one beat per line. Owner edits before approving. */
export function draftScriptText(brief:ScriptBrief):string{
 const {hook,cta,name,v}=briefContext(brief);
 const serviceLine=brief.services?`We do ${brief.services}.`:`${hook}`;
 const bookingLine=`Booking your ${v.booking} takes less than a minute.`;
 if(brief.type==='service_promo_15s'){
  return [`${name} — ${serviceLine}`,bookingLine,cta].join('\n');
 }
 const offerLine=brief.offer?`Right now: ${brief.offer}.`:`Right now we have something special for you.`;
 return [
  `${name} — ${hook}`,
  offerLine,
  `Spots are limited — call or book your ${v.booking} online to lock yours in.`,
  cta,
 ].join('\n');
}
/** Deterministic storyboard draft derived from the approved script beats. */
export function draftStoryboard(brief:ScriptBrief,script:string):StoryboardShot[]{
 const {name}=briefContext(brief);
 const duration=VIDEO_TYPES[brief.type].durationSeconds;
 const beats=script.split('\n').map(b=>b.trim()).filter(Boolean);
 const shotCount=brief.type==='service_promo_15s'?3:5;
 const each=duration/shotCount;
 const scenes=[
  `Exterior storefront of ${name} in warm morning light; bold on-screen text appears.`,
  `Friendly ${briefContext(brief).v.staff} at work inside ${name}; on-screen text names the offer.`,
  `Close-up of hands doing the work at ${name}; on-screen text reinforces the booking line.`,
  `Smiling ${briefContext(brief).v.customer} walking out of ${name}; on-screen text shows the call to action.`,
  `${name} storefront at dusk with logo and contact info on screen.`,
 ];
 return Array.from({length:shotCount},(_,i)=>({
  n:i+1,
  duration_s:Math.round(each*10)/10,
  scene:scenes[i]??`Continuing shot at ${name}.`,
  onscreen_text:beats[i]??beats[beats.length-1]??name,
 }));
}
/** Voiceover = beats joined; captions = beats wrapped to ~44 chars per line. */
export function scriptVoiceover(script:string):string{
 return script.split('\n').map(b=>b.trim()).filter(Boolean).join(' ');
}
export function scriptCaptions(script:string):string{
 const out:string[]=[];
 for(const beat of script.split('\n')){
  const words=beat.trim().split(/\s+/).filter(Boolean);
  let line='';
  for(const word of words){
   const next=line?`${line} ${word}`:word;
   if(next.length>44&&line){out.push(line);line=word;}
   else line=next;
  }
  if(line)out.push(line);
 }
 return out.join('\n');
}
/** Shot durations must sum to the job duration (±1.5s). */
export function assertStoryboardFits(type:VideoJobType,shots:StoryboardShot[]){
 const target=VIDEO_TYPES[type].durationSeconds;
 const total=shots.reduce((sum,s)=>sum+s.duration_s,0);
 if(Math.abs(total-target)>1.5)
  throw new HttpError(422,'storyboard_duration',`Shots total ${total.toFixed(1)}s but this video is ${target}s. Adjust the shot durations.`);
 const seen=new Set<number>();
 for(const shot of shots){
  if(seen.has(shot.n))throw new HttpError(422,'storyboard_shots',`Shot ${shot.n} is listed twice.`);
  seen.add(shot.n);
  assertCleanCopy('on-screen text',shot.onscreen_text);
 }
}

/* ---------------- storage ---------------- */

type JobRow={
 id:string;tenant_id:string;type:string;vertical:string;offer:string|null;services:string|null;status:string;
 script:string|null;script_approved_by:string|null;script_approved_at:string|null;
 storyboard_json:string|null;storyboard_approved_by:string|null;storyboard_approved_at:string|null;
 voiceover_text:string|null;caption_text:string|null;brand_json:string|null;
 result_asset_url:string|null;failure_reason:string|null;
 claimed_by:string|null;claimed_at:string|null;lease_until:string|null;
 created_at:string;updated_at:string;
};

const INSERT_SQL=`INSERT INTO video_jobs(id,tenant_id,type,vertical,offer,services,status,script,script_approved_by,script_approved_at,storyboard_json,storyboard_approved_by,storyboard_approved_at,voiceover_text,caption_text,brand_json,result_asset_url,failure_reason,claimed_by,claimed_at,lease_until,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;
const READ_SQL=`SELECT * FROM video_jobs WHERE id=? AND tenant_id=?`;
const LIST_SQL=`SELECT * FROM video_jobs WHERE tenant_id=? ORDER BY created_at DESC LIMIT ?`;
const UPDATE_SQL=`UPDATE video_jobs SET status=?,script=?,script_approved_by=?,script_approved_at=?,storyboard_json=?,storyboard_approved_by=?,storyboard_approved_at=?,voiceover_text=?,caption_text=?,result_asset_url=?,failure_reason=?,claimed_by=?,claimed_at=?,lease_until=?,updated_at=? WHERE id=? AND tenant_id=?`;
const CLAIM_SQL=`UPDATE video_jobs SET status='generating',claimed_by=?,claimed_at=?,lease_until=? WHERE id=(SELECT id FROM video_jobs WHERE status='queued' OR (status='generating' AND lease_until<=?) ORDER BY created_at ASC LIMIT 1)`;

function rowToView(row:JobRow):VideoJobView{
 const storyboard=row.storyboard_json?JSON.parse(row.storyboard_json) as StoryboardShot[]:null;
 return {
  id:row.id,type:row.type as VideoJobType,status:row.status as VideoJobStatus,
  businessName:row.brand_json?(JSON.parse(row.brand_json) as VideoBrand).name??null:null,
  vertical:row.vertical,
  script:row.script,
  scriptApproved:row.script_approved_by?{by:row.script_approved_by,at:row.script_approved_at??''}:null,
  storyboard,
  storyboardApproved:row.storyboard_approved_by?{by:row.storyboard_approved_by,at:row.storyboard_approved_at??''}:null,
  voiceoverText:row.voiceover_text,captionText:row.caption_text,
  brand:row.brand_json?JSON.parse(row.brand_json) as VideoBrand:null,
  resultAssetUrl:row.result_asset_url,failureReason:row.failure_reason,
  canceled:row.failure_reason==='canceled_by_owner',
  createdAt:row.created_at,updatedAt:row.updated_at,
 };
}
const nowIso=()=>new Date().toISOString();

async function readJob(env:Env,actor:Actor,id:string):Promise<JobRow>{
 const row=await env.AGENT_DB.prepare(READ_SQL).bind(id,actor.tenantId).first<JobRow>();
 if(!row)throw new HttpError(404,'video_job_not_found','This video job is not available.');
 return row;
}
async function writeJob(env:Env,row:JobRow):Promise<void>{
 const res=await env.AGENT_DB.prepare(UPDATE_SQL).bind(
  row.status,row.script,row.script_approved_by,row.script_approved_at,
  row.storyboard_json,row.storyboard_approved_by,row.storyboard_approved_at,
  row.voiceover_text,row.caption_text,row.result_asset_url,row.failure_reason,
  row.claimed_by,row.claimed_at,row.lease_until,row.updated_at,
  row.id,row.tenant_id,
 ).run();
 if((res.meta?.changes??0)!==1)throw new HttpError(409,'video_job_conflict','This video job changed while you were editing. Refresh and try again.');
}

type Transition={from:VideoJobStatus[];to:VideoJobStatus};
const TRANSITIONS:Record<string,Transition>={
 draft_script:{from:['draft'],to:'script_pending'},
 approve_script:{from:['script_pending'],to:'script_approved'},
 draft_storyboard:{from:['script_approved'],to:'storyboard_pending'},
 approve_storyboard:{from:['storyboard_pending'],to:'queued'},
};
function move(row:JobRow,action:keyof typeof TRANSITIONS){
 const t=TRANSITIONS[action];
 if(!(t.from as string[]).includes(row.status))
  throw new HttpError(409,'video_job_state',`This job is ${row.status}; "${String(action)}" is not available now.`);
 row.status=t.to;row.updated_at=nowIso();
}

/* ---------------- contract helpers (runner side) ---------------- */

/**
 * HANDOFF — runner claims the next queued job (or a job whose lease expired,
 * i.e. a crashed runner's work). Atomically moves it to `generating` with a
 * lease; returns the full job view, or null when the queue is empty.
 * The worker that runs this is NOT the Mayor worker's request path — it is
 * an agent-side poller with service credentials on D1.
 */
export async function claimVideoJob(env:Pick<Env,'AGENT_DB'>,opts:{workerId:string;leaseMinutes?:number}={workerId:'runner'}):Promise<VideoJobView|null>{
 if(!opts.workerId.trim())throw new HttpError(400,'worker_id_required','A worker id is required to claim a job.');
 const leaseMs=Math.max(1,Math.min(opts.leaseMinutes??15,120))*60_000;
 const at=nowIso(),token=`${opts.workerId}:${at}`;
 const until=new Date(Date.now()+leaseMs).toISOString();
 const res=await env.AGENT_DB.prepare(CLAIM_SQL).bind(token,at,until,at).run();
 if((res.meta?.changes??0)!==1)return null;
 const row=await env.AGENT_DB.prepare(`SELECT * FROM video_jobs WHERE claimed_by=? AND status='generating' ORDER BY claimed_at DESC LIMIT 1`).bind(token).first<JobRow>();
 if(!row)throw new HttpError(500,'video_job_claim_lost','The job was claimed but could not be read back.');
 return rowToView(row);
}

/**
 * HANDOFF — runner marks a `generating` job complete with the hosted asset
 * URL (https only). The studio then shows the delivered video player.
 */
export async function completeVideoJob(env:Pick<Env,'AGENT_DB'>,id:string,assetUrl:string):Promise<VideoJobView>{
 let url:URL;
 try{url=new URL(assetUrl);}catch{throw new HttpError(400,'asset_url_invalid','The finished video needs a valid address.');}
 if(url.protocol!=='https:'||url.username||url.password)
  throw new HttpError(400,'asset_url_invalid','The finished video needs an https address without credentials.');
 const row=await env.AGENT_DB.prepare(`SELECT * FROM video_jobs WHERE id=?`).bind(id).first<JobRow>();
 if(!row)throw new HttpError(404,'video_job_not_found','This video job is not available.');
 if(row.status!=='generating')throw new HttpError(409,'video_job_state',`This job is ${row.status}; only a generating job can be completed.`);
 row.status='ready';row.result_asset_url=assetUrl;
 row.claimed_by=null;row.claimed_at=null;row.lease_until=null;row.updated_at=nowIso();
 await env.AGENT_DB.prepare(UPDATE_SQL).bind(
  row.status,row.script,row.script_approved_by,row.script_approved_at,
  row.storyboard_json,row.storyboard_approved_by,row.storyboard_approved_at,
  row.voiceover_text,row.caption_text,row.result_asset_url,row.failure_reason,
  row.claimed_by,row.claimed_at,row.lease_until,row.updated_at,
  row.id,row.tenant_id,
 ).run();
 return rowToView(row);
}

/**
 * HANDOFF — runner marks a claimed/queued job failed with a human-readable
 * reason. The owner sees the reason in the studio and can re-queue by
 * re-approving the storyboard.
 */
export async function failVideoJob(env:Pick<Env,'AGENT_DB'>,id:string,reason:string):Promise<VideoJobView>{
 const clean=reason.trim().slice(0,500)||'The video could not be generated.';
 const row=await env.AGENT_DB.prepare(`SELECT * FROM video_jobs WHERE id=?`).bind(id).first<JobRow>();
 if(!row)throw new HttpError(404,'video_job_not_found','This video job is not available.');
 if(row.status!=='generating'&&row.status!=='queued')
  throw new HttpError(409,'video_job_state',`This job is ${row.status}; only a queued or generating job can be marked failed.`);
 row.status='failed';row.failure_reason=clean;
 row.claimed_by=null;row.claimed_at=null;row.lease_until=null;row.updated_at=nowIso();
 await env.AGENT_DB.prepare(UPDATE_SQL).bind(
  row.status,row.script,row.script_approved_by,row.script_approved_at,
  row.storyboard_json,row.storyboard_approved_by,row.storyboard_approved_at,
  row.voiceover_text,row.caption_text,row.result_asset_url,row.failure_reason,
  row.claimed_by,row.claimed_at,row.lease_until,row.updated_at,
  row.id,row.tenant_id,
 ).run();
 return rowToView(row);
}

/* ---------------- HTTP routes ---------------- */

export type VideogenRouteHandler=(request:Request,env:Env,actor:Actor)=>Promise<Response|null>;
export interface VideogenRouter{add(method:'GET'|'POST',pattern:RegExp,handler:VideogenRouteHandler):void;}
export function registerVideogenRoutes(router:VideogenRouter){
 router.add('GET',/^\/api\/businesses\/[a-f0-9]{32}\/videos(?:\/[a-f0-9-]{36})?\/?$/,handleVideogenRequest);
 router.add('POST',/^\/api\/businesses\/[a-f0-9]{32}\/videos(?:\/[a-f0-9-]{36}(?:\/(?:(?:script|storyboard)\/(?:draft|approve)|cancel))?)?\/?$/,handleVideogenRequest);
}

/** Entry point for index.ts: call inside the authenticated business block. */
export async function handleVideogenRequest(request:Request,env:Env,actor:Actor):Promise<Response|null>{
 const url=new URL(request.url);
 const match=url.pathname.match(/^\/api\/businesses\/([a-f0-9]{32})\/videos(?:\/([a-f0-9-]{36})(?:\/((script|storyboard)\/(draft|approve)|cancel))?)?\/?$/);
 if(!match)return null;
 if(match[1]!==actor.tenantId)throw new HttpError(404,'workspace_not_found','This workspace is not available.');
 await requireMembership(env,actor,OPERATORS); // owner-only mutations AND reads
 const jobId=match[2],tail=match[3],section=match[4],action=match[5];
 const method=request.method;
 if(method==='POST'){
  requireOrigin(request,env.APP_ORIGIN);
  if(!jobId){
   if(tail)throw new HttpError(404,'video_job_not_found','This video job is not available.');
   return createJob(request,env,actor);
  }
  if(tail==='cancel')return cancelJob(env,actor,jobId);
  if(section==='script'&&action==='draft')return draftScript(request,env,actor,jobId);
  if(section==='script'&&action==='approve')return approveScript(request,env,actor,jobId);
  if(section==='storyboard'&&action==='draft')return draftStoryboardRoute(env,actor,jobId);
  if(section==='storyboard'&&action==='approve')return approveStoryboard(request,env,actor,jobId);
  throw new HttpError(404,'video_job_not_found','This video job is not available.');
 }
 if(method==='GET'){
  if(jobId&&!section)return jobStatus(env,actor,jobId);
  if(!jobId)return listJobs(env,actor,url);
  throw new HttpError(404,'video_job_not_found','This video job is not available.');
 }
 throw new HttpError(405,'method_not_allowed','This request is not supported here.');
}

async function createJob(request:Request,env:Env,actor:Actor){
 const input=createJobSchema.parse(await readJson(request));
 if(input.offer)assertCleanCopy('offer line',input.offer);
 if(input.services)assertCleanCopy('services line',input.services);
 const businessName=input.businessName?.trim()||null;
 const vertical=input.vertical??'other';
 const brand:VideoBrand={...(input.brand??{}),...(businessName?{name:businessName}:{})};
 const at=nowIso();
 const id=crypto.randomUUID();
 await env.AGENT_DB.prepare(INSERT_SQL).bind(
  id,actor.tenantId,input.type,vertical,input.offer??null,input.services??null,'draft',
  null,null,null,null,null,null,null,null,
  Object.keys(brand).length?JSON.stringify(brand):null,
  null,null,null,null,null,at,at,
 ).run();
 const row=await env.AGENT_DB.prepare(READ_SQL).bind(id,actor.tenantId).first<JobRow>();
 return json({job:rowToView(row!)});
}
async function draftScript(request:Request,env:Env,actor:Actor,jobId:string){
 const row=await readJob(env,actor,jobId);
 move(row,'draft_script');
 const brand=row.brand_json?JSON.parse(row.brand_json) as VideoBrand:{};
 const script=draftScriptText({
  businessName:brand.name??'Your business',
  vertical:row.vertical,
  type:row.type as VideoJobType,
  ...(row.offer?{offer:row.offer}:{}),
  ...(row.services?{services:row.services}:{}),
 });
 assertCleanCopy('drafted script',script);
 row.script=script;row.updated_at=nowIso();
 await writeJob(env,row);
 return json({job:rowToView(row)});
}
async function approveScript(request:Request,env:Env,actor:Actor,jobId:string){
 const {script}=approveScriptSchema.parse(await readJson(request));
 assertCleanCopy('script',script);
 const row=await readJob(env,actor,jobId);
 move(row,'approve_script');
 const at=nowIso();
 row.script=script;
 row.script_approved_by=actor.userId;row.script_approved_at=at;
 row.voiceover_text=scriptVoiceover(script);
 row.caption_text=scriptCaptions(script);
 row.updated_at=at;
 await writeJob(env,row);
 return json({job:rowToView(row)});
}
async function draftStoryboardRoute(env:Env,actor:Actor,jobId:string){
 const row=await readJob(env,actor,jobId);
 move(row,'draft_storyboard');
 if(!row.script)throw new HttpError(409,'video_job_state','Approve a script before drafting the storyboard.');
 const brand=row.brand_json?JSON.parse(row.brand_json) as VideoBrand:{};
 const shots=draftStoryboard(
  {businessName:brand.name??'Your business',vertical:row.vertical,type:row.type as VideoJobType},
  row.script,
 );
 assertStoryboardFits(row.type as VideoJobType,shots);
 row.storyboard_json=JSON.stringify(shots);
 row.updated_at=nowIso();
 await writeJob(env,row);
 return json({job:rowToView(row)});
}
async function approveStoryboard(request:Request,env:Env,actor:Actor,jobId:string){
 const {shots}=approveStoryboardSchema.parse(await readJson(request));
 const row=await readJob(env,actor,jobId);
 assertStoryboardFits(row.type as VideoJobType,shots);
 move(row,'approve_storyboard');
 const at=nowIso();
 row.storyboard_json=JSON.stringify(shots);
 row.storyboard_approved_by=actor.userId;row.storyboard_approved_at=at;
 row.updated_at=at;
 await writeJob(env,row);
 return json({job:rowToView(row)});
}
async function jobStatus(env:Env,actor:Actor,jobId:string){
 const row=await readJob(env,actor,jobId);
 return json({job:rowToView(row)});
}
async function listJobs(env:Env,actor:Actor,url:URL){
 const limit=Math.max(1,Math.min(Number(url.searchParams.get('limit'))||20,100));
 const rows=await env.AGENT_DB.prepare(LIST_SQL).bind(actor.tenantId,limit).all<JobRow>();
 return json({jobs:(rows.results??[]).map(rowToView)});
}
async function cancelJob(env:Env,actor:Actor,jobId:string){
 const row=await readJob(env,actor,jobId);
 if(row.status==='ready'||row.status==='generating')
  throw new HttpError(409,'video_job_state','This job is already past the point where it can be canceled.');
 row.status='failed';row.failure_reason='canceled_by_owner';
 row.claimed_by=null;row.claimed_at=null;row.lease_until=null;row.updated_at=nowIso();
 await writeJob(env,row);
 return json({job:rowToView(row)});
}
