import {z} from 'zod';
import type {Actor,Env} from './env';
import {HttpError,json,readJson} from './http';
import {requireMembership,OPERATORS} from './permissions';
import {verticalProfile} from './verticals';
import {localDayKey} from './proactive-detectors';

/** Crew 7b — content calendar + auto-posting.
 *
 * Approval model (hard rule): NOTHING publishes to a public channel without
 * explicit owner approval. Approval is per-post, or inherited from an
 * owner-approved series (campaign). The worker runDuePosts() is the only
 * writer of terminal statuses, and every attempt records publish_mode
 * honestly. The social connector layer is test-gated today, so an attempt
 * may NEVER write status='sent' from a test-gated adapter — the UI must
 * never show a fake "posted" state (compliance items 9, 12).
 */

export type SocialChannel='instagram'|'facebook'|'tiktok'|'x';
export type PostStatus='draft'|'scheduled'|'approved'|'sending'|'sent'|'failed'|'cancelled';
export type PublishMode='test-gated'|'live';

export const SOCIAL_CHANNELS:SocialChannel[]=['instagram','facebook','tiktok','x'];
export const POST_STATUSES:PostStatus[]=['draft','scheduled','approved','sending','sent','failed','cancelled'];

/* ---------------- validation ---------------- */

const channelSchema=z.enum(SOCIAL_CHANNELS);
const isoDateTime=z.string().refine(v=>!Number.isNaN(Date.parse(v)),{message:'must be an ISO-8601 datetime'});
const languageSchema=z.string().trim().min(2).max(10).default('en');
const imageIdsSchema=z.array(z.string().trim().min(1).max(256)).max(10).default([]);

export const createPostSchema=z.object({
 channel:channelSchema,
 language:languageSchema,
 copy_text:z.string().trim().max(4000).default(''),
 post_copy_id:z.string().trim().min(1).max(128).optional(),
 image_ids:imageIdsSchema,
 video_job_id:z.string().trim().min(1).max(128).optional(),
 scheduled_for:isoDateTime,
 series_id:z.uuid().optional(),
 dedupe_key:z.string().trim().min(4).max(128).optional(),
}).strict();
export type CreatePostInput=z.infer<typeof createPostSchema>;

export const editPostSchema=z.object({
 channel:channelSchema.optional(),
 language:languageSchema.optional(),
 copy_text:z.string().trim().max(4000).optional(),
 post_copy_id:z.string().trim().min(1).max(128).nullable().optional(),
 image_ids:imageIdsSchema.optional(),
 video_job_id:z.string().trim().min(1).max(128).nullable().optional(),
 scheduled_for:isoDateTime.optional(),
 series_id:z.uuid().nullable().optional(),
}).strict();
export type EditPostInput=z.infer<typeof editPostSchema>;

export const schedulePostSchema=z.object({scheduled_for:isoDateTime}).strict();

export const createSeriesSchema=z.object({
 name:z.string().trim().min(1).max(120),
 channels:z.array(channelSchema).min(1).max(4),
}).strict();

export const listQuerySchema=z.object({
 from:z.string().optional(),
 to:z.string().optional(),
 channel:channelSchema.optional(),
 status:z.enum(POST_STATUSES).optional(),
 series_id:z.uuid().optional(),
}).strict();

/* ---------------- state machine ---------------- */

const TRANSITIONS:Record<PostStatus,PostStatus[]>={
 draft:['scheduled','cancelled'],
 scheduled:['approved','cancelled'],
 approved:['sending','cancelled'],
 sending:['sent','failed'],
 failed:['approved','cancelled'],
 sent:[],
 cancelled:[],
};
export function canTransition(from:PostStatus,to:PostStatus):boolean{
 return TRANSITIONS[from]?.includes(to)??false;
}
function assertTransition(from:PostStatus,to:PostStatus,action:string):void{
 if(!canTransition(from,to))throw new HttpError(409,'invalid_transition',
  `Cannot ${action} a post in status "${from}".`);
}

/* ---------------- rows ---------------- */

export interface SocialPost{
 id:string;tenant_id:string;series_id:string|null;channel:SocialChannel;language:string;
 copy_text:string;post_copy_id:string|null;image_ids:string[];video_job_id:string|null;
 scheduled_for:string;status:PostStatus;approved_by:string|null;approved_at:string|null;
 failure_reason:string|null;retry_count:number;publish_mode:PublishMode;remote_id:string|null;
 last_attempt_at:string|null;dedupe_key:string;created_by:string;created_at:string;updated_at:string;
}
export interface SocialSeries{
 id:string;tenant_id:string;name:string;channels:SocialChannel[];status:'active'|'archived';
 approved_by:string|null;approved_at:string|null;created_by:string;created_at:string;updated_at:string;
}

const POST_COLUMNS='id,tenant_id,series_id,channel,language,copy_text,post_copy_id,image_ids_json,video_job_id,'+
 'scheduled_for,status,approved_by,approved_at,failure_reason,retry_count,publish_mode,remote_id,'+
 'last_attempt_at,dedupe_key,created_by,created_at,updated_at';
const SERIES_COLUMNS='id,tenant_id,name,channels_json,status,approved_by,approved_at,created_by,created_at,updated_at';

function parsePost(row:Record<string,unknown>):SocialPost{
 return {
  id:String(row.id),tenant_id:String(row.tenant_id),
  series_id:row.series_id==null?null:String(row.series_id),
  channel:String(row.channel) as SocialChannel,language:String(row.language??'en'),
  copy_text:String(row.copy_text??''),post_copy_id:row.post_copy_id==null?null:String(row.post_copy_id),
  image_ids:JSON.parse(String(row.image_ids_json??'[]')) as string[],
  video_job_id:row.video_job_id==null?null:String(row.video_job_id),
  scheduled_for:String(row.scheduled_for),status:String(row.status) as PostStatus,
  approved_by:row.approved_by==null?null:String(row.approved_by),
  approved_at:row.approved_at==null?null:String(row.approved_at),
  failure_reason:row.failure_reason==null?null:String(row.failure_reason),
  retry_count:Number(row.retry_count??0),publish_mode:String(row.publish_mode??'test-gated') as PublishMode,
  remote_id:row.remote_id==null?null:String(row.remote_id),
  last_attempt_at:row.last_attempt_at==null?null:String(row.last_attempt_at),
  dedupe_key:String(row.dedupe_key),created_by:String(row.created_by),
  created_at:String(row.created_at),updated_at:String(row.updated_at),
 };
}
function parseSeries(row:Record<string,unknown>):SocialSeries{
 return {
  id:String(row.id),tenant_id:String(row.tenant_id),name:String(row.name),
  channels:JSON.parse(String(row.channels_json??'[]')) as SocialChannel[],
  status:String(row.status) as 'active'|'archived',
  approved_by:row.approved_by==null?null:String(row.approved_by),
  approved_at:row.approved_at==null?null:String(row.approved_at),
  created_by:String(row.created_by),created_at:String(row.created_at),updated_at:String(row.updated_at),
 };
}

type Db=Pick<Env,'AGENT_DB'>;

/* ---------------- CRUD ---------------- */

export async function createDraft(db:Db,actor:Actor,input:CreatePostInput):Promise<SocialPost>{
 await requireMembership(db,actor,OPERATORS);
 if(input.series_id){
  const series=await db.AGENT_DB.prepare(`SELECT ${SERIES_COLUMNS} FROM mayor_social_series WHERE id=? AND tenant_id=?`)
   .bind(input.series_id,actor.tenantId).first<Record<string,unknown>>();
  if(!series)throw new HttpError(404,'series_not_found','That series does not exist.');
  if(parseSeries(series).status!=='active')throw new HttpError(409,'series_archived','That series is archived.');
 }
 const now=new Date().toISOString(),id=crypto.randomUUID();
 const dedupe=input.dedupe_key??`post-${id}`;
 try{
  await db.AGENT_DB.prepare(`INSERT INTO mayor_social_posts
   (id,tenant_id,series_id,channel,language,copy_text,post_copy_id,image_ids_json,video_job_id,
    scheduled_for,status,dedupe_key,created_by,created_at,updated_at)
   VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id,actor.tenantId,input.series_id??null,
   input.channel,input.language,input.copy_text,input.post_copy_id??null,
   JSON.stringify(input.image_ids),input.video_job_id??null,input.scheduled_for,
   'draft',dedupe,actor.userId,now,now).run();
 }catch(err){
  if(String(err).includes('UNIQUE'))throw new HttpError(409,'duplicate_post','A post with this dedupe key already exists.');
  throw err;
 }
 return getPost(db,actor,id);
}

export async function getPost(db:Db,actor:Actor,id:string):Promise<SocialPost>{
 await requireMembership(db,actor);
 const row=await db.AGENT_DB.prepare(`SELECT ${POST_COLUMNS} FROM mayor_social_posts WHERE id=? AND tenant_id=?`)
  .bind(id,actor.tenantId).first<Record<string,unknown>>();
 if(!row)throw new HttpError(404,'post_not_found','That post does not exist.');
 return parsePost(row);
}

export interface ListPostsQuery{from?:string;to?:string;channel?:SocialChannel;status?:PostStatus;series_id?:string;}
export async function listPosts(db:Db,actor:Actor,q:ListPostsQuery):Promise<SocialPost[]>{
 await requireMembership(db,actor);
 const nowMs=Date.now();
 const from=q.from&&!Number.isNaN(Date.parse(q.from))?new Date(q.from).toISOString():new Date(nowMs-7*86400_000).toISOString();
 const to=q.to&&!Number.isNaN(Date.parse(q.to))?new Date(q.to).toISOString():new Date(nowMs+30*86400_000).toISOString();
 let sql=`SELECT ${POST_COLUMNS} FROM mayor_social_posts WHERE tenant_id=? AND scheduled_for>=? AND scheduled_for<?`;
 const params:(string|number)[]=[actor.tenantId,from,to];
 if(q.channel){sql+=' AND channel=?';params.push(q.channel);}
 if(q.status){sql+=' AND status=?';params.push(q.status);}
 if(q.series_id){sql+=' AND series_id=?';params.push(q.series_id);}
 sql+=' ORDER BY scheduled_for ASC LIMIT 500';
 const rows=await db.AGENT_DB.prepare(sql).bind(...params).all<Record<string,unknown>>();
 return (rows.results??[]).map(parsePost);
}

export async function schedulePost(db:Db,actor:Actor,id:string,scheduled_for:string):Promise<SocialPost>{
 await requireMembership(db,actor,OPERATORS);
 const post=await getPost(db,actor,id);
 if(post.status!=='scheduled')assertTransition(post.status,'scheduled','schedule');
 const now=new Date().toISOString();
 await db.AGENT_DB.prepare(`UPDATE mayor_social_posts SET scheduled_for=?,status='scheduled',updated_at=? WHERE id=? AND tenant_id=?`)
  .bind(scheduled_for,now,id,actor.tenantId).run();
 return getPost(db,actor,id);
}

export async function approvePost(db:Db,actor:Actor,id:string):Promise<SocialPost>{
 await requireMembership(db,actor,OPERATORS);
 const post=await getPost(db,actor,id);
 assertTransition(post.status,'approved','approve');
 const now=new Date().toISOString();
 await db.AGENT_DB.prepare(`UPDATE mayor_social_posts SET status='approved',approved_by=?,approved_at=?,failure_reason=NULL,retry_count=0,updated_at=? WHERE id=? AND tenant_id=?`)
  .bind(actor.userId,now,now,id,actor.tenantId).run();
 return getPost(db,actor,id);
}

export async function editPost(db:Db,actor:Actor,id:string,input:EditPostInput):Promise<SocialPost>{
 await requireMembership(db,actor,OPERATORS);
 const post=await getPost(db,actor,id);
 if(post.status!=='draft'&&post.status!=='scheduled')
  throw new HttpError(409,'post_locked','Approved or published posts cannot be edited. Cancel it and create a new draft.');
 if(input.series_id!==undefined&&input.series_id!==null){
  const series=await db.AGENT_DB.prepare(`SELECT ${SERIES_COLUMNS} FROM mayor_social_series WHERE id=? AND tenant_id=?`)
   .bind(input.series_id,actor.tenantId).first<Record<string,unknown>>();
  if(!series)throw new HttpError(404,'series_not_found','That series does not exist.');
 }
 const now=new Date().toISOString();
 const sets:string[]=[],params:(string|null)[]=[];
 if(input.channel!==undefined){sets.push('channel=?');params.push(input.channel);}
 if(input.language!==undefined){sets.push('language=?');params.push(input.language);}
 if(input.copy_text!==undefined){sets.push('copy_text=?');params.push(input.copy_text);}
 if(input.post_copy_id!==undefined){sets.push('post_copy_id=?');params.push(input.post_copy_id);}
 if(input.image_ids!==undefined){sets.push('image_ids_json=?');params.push(JSON.stringify(input.image_ids));}
 if(input.video_job_id!==undefined){sets.push('video_job_id=?');params.push(input.video_job_id);}
 if(input.scheduled_for!==undefined){sets.push('scheduled_for=?');params.push(input.scheduled_for);}
 if(input.series_id!==undefined){sets.push('series_id=?');params.push(input.series_id);}
 if(!sets.length)return post;
 sets.push('updated_at=?');params.push(now);
 await db.AGENT_DB.prepare(`UPDATE mayor_social_posts SET ${sets.join(',')} WHERE id=? AND tenant_id=?`)
  .bind(...params,id,actor.tenantId).run();
 return getPost(db,actor,id);
}

export async function cancelPost(db:Db,actor:Actor,id:string):Promise<SocialPost>{
 await requireMembership(db,actor,OPERATORS);
 const post=await getPost(db,actor,id);
 assertTransition(post.status,'cancelled','cancel');
 const now=new Date().toISOString();
 await db.AGENT_DB.prepare(`UPDATE mayor_social_posts SET status='cancelled',updated_at=? WHERE id=? AND tenant_id=?`)
  .bind(now,id,actor.tenantId).run();
 return getPost(db,actor,id);
}

/** Re-approve a failed post for another attempt. Failed posts never auto-retry
 * into a send without this explicit owner action (plus backoff, in runDuePosts). */
export async function retryPost(db:Db,actor:Actor,id:string):Promise<SocialPost>{
 return approvePost(db,actor,id);
}

/* ---------------- series ---------------- */

export async function createSeries(db:Db,actor:Actor,input:{name:string;channels:SocialChannel[]}):Promise<SocialSeries>{
 await requireMembership(db,actor,OPERATORS);
 const now=new Date().toISOString(),id=crypto.randomUUID();
 await db.AGENT_DB.prepare(`INSERT INTO mayor_social_series
  (id,tenant_id,name,channels_json,status,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)`)
  .bind(id,actor.tenantId,input.name,JSON.stringify(input.channels),'active',actor.userId,now,now).run();
 const row=await db.AGENT_DB.prepare(`SELECT ${SERIES_COLUMNS} FROM mayor_social_series WHERE id=? AND tenant_id=?`)
  .bind(id,actor.tenantId).first<Record<string,unknown>>();
 if(!row)throw new HttpError(500,'series_create_failed','The series could not be read back.');
 return parseSeries(row);
}

export async function getSeries(db:Db,actor:Actor,id:string):Promise<SocialSeries>{
 await requireMembership(db,actor);
 const row=await db.AGENT_DB.prepare(`SELECT ${SERIES_COLUMNS} FROM mayor_social_series WHERE id=? AND tenant_id=?`)
  .bind(id,actor.tenantId).first<Record<string,unknown>>();
 if(!row)throw new HttpError(404,'series_not_found','That series does not exist.');
 return parseSeries(row);
}

export async function listSeries(db:Db,actor:Actor):Promise<SocialSeries[]>{
 await requireMembership(db,actor);
 const rows=await db.AGENT_DB.prepare(`SELECT ${SERIES_COLUMNS} FROM mayor_social_series WHERE tenant_id=? ORDER BY created_at DESC LIMIT 100`)
  .bind(actor.tenantId).all<Record<string,unknown>>();
 return (rows.results??[]).map(parseSeries);
}

/** Approving a series is the per-series approval path: every post in the
 * series that reaches 'scheduled' is treated as owner-approved for sending. */
export async function approveSeries(db:Db,actor:Actor,id:string):Promise<SocialSeries>{
 await requireMembership(db,actor,OPERATORS);
 const series=await getSeries(db,actor,id);
 if(series.status!=='active')throw new HttpError(409,'series_archived','That series is archived.');
 const now=new Date().toISOString();
 await db.AGENT_DB.prepare(`UPDATE mayor_social_series SET approved_by=?,approved_at=?,updated_at=? WHERE id=? AND tenant_id=?`)
  .bind(actor.userId,now,now,id,actor.tenantId).run();
 return getSeries(db,actor,id);
}

export async function archiveSeries(db:Db,actor:Actor,id:string):Promise<SocialSeries>{
 await requireMembership(db,actor,OPERATORS);
 await getSeries(db,actor,id);
 const now=new Date().toISOString();
 await db.AGENT_DB.prepare(`UPDATE mayor_social_series SET status='archived',updated_at=? WHERE id=? AND tenant_id=?`)
  .bind(now,id,actor.tenantId).run();
 return getSeries(db,actor,id);
}

async function approvedSeriesIds(db:Db,tenantId:string):Promise<Set<string>>{
 const rows=await db.AGENT_DB.prepare(`SELECT id FROM mayor_social_series WHERE tenant_id=? AND status='active' AND approved_by IS NOT NULL`)
  .bind(tenantId).all<{id:string}>();
 return new Set((rows.results??[]).map(r=>r.id));
}

/** Effective approval: status 'approved', OR 'scheduled' under an
 * owner-approved active series. Everything else is not sendable. */
export function isSendable(post:SocialPost,approvedSeries:ReadonlySet<string>):boolean{
 if(post.status==='approved')return true;
 if(post.status==='scheduled'&&post.series_id&&approvedSeries.has(post.series_id))return true;
 return false;
}

/* ---------------- publish adapters ---------------- */

export interface SocialPublishInput{
 postId:string;channel:SocialChannel;copyText:string;imageIds:string[];videoJobId:string|null;language:string;
}
export interface PublishOutcome{ok:boolean;remoteId?:string;errorCode?:string;errorDetail?:string;}
export interface SocialPublishAdapter{
 readonly publishMode:PublishMode;
 publish(input:SocialPublishInput):Promise<PublishOutcome>;
}

/** The connector layer is dark: this adapter never touches a public channel.
 * It always reports failure with errorCode 'test_gated' so runDuePosts
 * records an honest status and the UI can say so. It must NEVER resolve ok. */
export const TEST_GATED_ADAPTER:SocialPublishAdapter={
 publishMode:'test-gated',
 async publish():Promise<PublishOutcome>{
  return {ok:false,errorCode:'test_gated',
   errorDetail:'Publishing is test-gated: the social connector layer is not live. Nothing was posted to a public channel.'};
 },
};

/* ---------------- the sending worker ---------------- */

export const MAX_SEND_RETRIES=5;
export const DUE_BATCH_LIMIT=25;
/** Exponential backoff between attempts: 5min, 10min, 20min, 30min cap. */
export function sendBackoffMs(retryCount:number):number{
 return Math.min(30*60_000,5*60_000*Math.pow(2,retryCount));
}

export interface DuePostsSummary{
 attempted:number;sent:number;failed:number;skipped:number;errors:{postId:string;errorCode:string}[];
}

export async function runDuePosts(env:Pick<Env,'AGENT_DB'>,opts?:{nowMs?:number;adapter?:SocialPublishAdapter;tenantId?:string}):Promise<DuePostsSummary>{
 const nowMs=opts?.nowMs??Date.now();
 const adapter=opts?.adapter??TEST_GATED_ADAPTER;
 const nowIso=new Date(nowMs).toISOString();
 const summary:DuePostsSummary={attempted:0,sent:0,failed:0,skipped:0,errors:[]};

 // A live adapter may only post to channels the caller explicitly wires;
 // a test-gated adapter must never report success. Enforce both here.
 // 'scheduled' is included: series-gated posts reach 'scheduled' and are
 // sendable while their series is owner-approved; isSendable() re-checks.
 let sql=`SELECT ${POST_COLUMNS} FROM mayor_social_posts WHERE status IN ('approved','scheduled') AND scheduled_for<=? AND retry_count<?`;
 const params:(string|number)[]=[nowIso,MAX_SEND_RETRIES];
 if(opts?.tenantId){sql+=' AND tenant_id=?';params.push(opts.tenantId);}
 sql+=` ORDER BY scheduled_for ASC LIMIT ${DUE_BATCH_LIMIT}`;
 const dueRows=await env.AGENT_DB.prepare(sql).bind(...params).all<Record<string,unknown>>();
 const due=(dueRows.results??[]).map(parsePost);

 for(const post of due){
  // Backoff: skip until the retry window has passed.
  if(post.last_attempt_at){
   const lastMs=Date.parse(post.last_attempt_at);
   if(!Number.isNaN(lastMs)&&nowMs-lastMs<sendBackoffMs(post.retry_count)){summary.skipped++;continue;}
  }
  // Re-verify approval at send time (series may have been archived since).
  const approved=await approvedSeriesIds(env,post.tenant_id);
  if(!isSendable(post,approved)){summary.skipped++;continue;}
  // Idempotent claim: exactly one worker wins the row.
  const claimed=await env.AGENT_DB.prepare(`UPDATE mayor_social_posts
   SET status='sending',last_attempt_at=?,publish_mode=?,updated_at=?
   WHERE id=? AND tenant_id=? AND status IN ('approved','scheduled')`)
   .bind(nowIso,adapter.publishMode,nowIso,post.id,post.tenant_id).run();
  if((claimed.meta?.changes??0)!==1){summary.skipped++;continue;}
  summary.attempted++;
  let outcome:PublishOutcome;
  try{
   outcome=await adapter.publish({
    postId:post.id,channel:post.channel,copyText:post.copy_text,
    imageIds:post.image_ids,videoJobId:post.video_job_id,language:post.language,
   });
   // Never trust a success claim from a non-live adapter.
   if(outcome.ok&&adapter.publishMode!=='live'){
    outcome={ok:false,errorCode:'untrusted_success',
     errorDetail:'A test-gated adapter reported success; recorded as failure so no fake "posted" state is shown.'};
   }
  }catch(err){
   outcome={ok:false,errorCode:'adapter_threw',errorDetail:String(err).slice(0,500)};
  }
  if(outcome.ok){
   await env.AGENT_DB.prepare(`UPDATE mayor_social_posts
    SET status='sent',remote_id=?,failure_reason=NULL,updated_at=? WHERE id=? AND tenant_id=?`)
    .bind(outcome.remoteId??null,new Date().toISOString(),post.id,post.tenant_id).run();
   summary.sent++;
  }else{
   const nextRetry=post.retry_count+1;
   const exhausted=nextRetry>=MAX_SEND_RETRIES;
   const nextStatus:PostStatus=exhausted?'failed':'approved'; // approved: stays eligible after backoff
   const reason=`${outcome.errorCode??'publish_failed'}${outcome.errorDetail?': '+outcome.errorDetail:''}`.slice(0,1000);
   await env.AGENT_DB.prepare(`UPDATE mayor_social_posts
    SET status=?,retry_count=?,failure_reason=?,updated_at=? WHERE id=? AND tenant_id=?`)
    .bind(nextStatus,nextRetry,reason,new Date().toISOString(),post.id,post.tenant_id).run();
   if(exhausted)summary.failed++;
   else summary.skipped++; // will be retried after backoff
   summary.errors.push({postId:post.id,errorCode:outcome.errorCode??'publish_failed'});
  }
 }
 return summary;
}

/* ---------------- copy helpers (vertical-aware, English-first) ---------------- */

/** Tone hint for the draft composer, drawn from the vertical profile's own
 * voice guidance. English-first; the post's `language` param is threaded
 * through and stored on the post. */
export function copyToneHint(vertical:string|null|undefined):string{
 return verticalProfile(vertical)?.suggestionVoice??'Clear, friendly, and short.';
}
/** Starter templates with {business} replaced by the caller. These are
 * templates, not generated claims — safe to show as draft suggestions. */
export function starterCopyIdeas(vertical:string|null|undefined):string[]{
 const v=verticalProfile(vertical);
 const vocab=v?.vocabulary;
 const customer=vocab?.customer??'customer';
 return [
  `New week, same promise: {business} takes care of every ${customer}. Book your spot this week.`,
  `Slow day? Not here. {business} has openings this week — grab yours before they are gone.`,
  `Loved your last visit? Tell a friend about {business} and we will take care of them too.`,
 ];
}

/* ---------------- calendar view bucketing (pure) ---------------- */

export interface CalendarDayBucket{dayKey:string;label:string;posts:SocialPost[];}
export function bucketPostsByLocalDay(posts:SocialPost[],weekStartMs:number,days:number,timeZone:string):CalendarDayBucket[]{
 const buckets:CalendarDayBucket[]=[];
 for(let d=0;d<days;d++){
  const dayMs=weekStartMs+d*86400_000;
  const dayKey=localDayKey(dayMs,timeZone);
  const label=new Intl.DateTimeFormat('en-US',{timeZone,weekday:'short',month:'short',day:'numeric'}).format(dayMs);
  buckets.push({dayKey,label,posts:posts.filter(p=>localDayKey(Date.parse(p.scheduled_for),timeZone)===dayKey)});
 }
 return buckets;
}

/* ---------------- HTTP route registration ---------------- */

export type RouteMethod='GET'|'POST'|'PATCH'|'DELETE';
export interface GrowthCalendarHandlerCtx{
 request:Request;url:URL;env:Env;userId:string;
 params:{tenantId:string;postId?:string;seriesId?:string};
}
export type GrowthCalendarHandler=(ctx:GrowthCalendarHandlerCtx)=>Promise<Response>;
export interface GrowthCalendarRouteDef{method:RouteMethod;pattern:RegExp;summary:string;handle:GrowthCalendarHandler;}
/** Registrar the integrator provides. Matches the manual-regex routing style
 * of src/index.ts: patterns capture tenantId / postId / seriesId. */
export interface GrowthCalendarRegistrar{addRoute(def:GrowthCalendarRouteDef):void;}

const TENANT='([a-f0-9]{32})';
const POST_ID='([a-f0-9-]{36})';

async function handlePostRoutes(ctx:GrowthCalendarHandlerCtx):Promise<Response>{
 const {request,url,env,userId,params}=ctx;
 const actor:Actor={tenantId:params.tenantId,userId};
 const action=url.pathname.match(/\/social-posts\/[a-f0-9-]{36}\/([a-z]+)$/)?.[1];
 if(request.method==='GET'&&!params.postId){
  const q=listQuerySchema.parse(Object.fromEntries(url.searchParams));
  return json({posts:await listPosts(env,actor,q)});
 }
 if(request.method==='POST'&&!params.postId&&!action){
  const input=createPostSchema.parse(await readJson(request,8192));
  return json({post:await createDraft(env,actor,input)},201);
 }
 if(params.postId&&!action){
  if(request.method==='GET')return json({post:await getPost(env,actor,params.postId)});
  if(request.method==='PATCH'){
   const input=editPostSchema.parse(await readJson(request,8192));
   return json({post:await editPost(env,actor,params.postId,input)});
  }
 }
 if(params.postId&&action==='schedule'&&request.method==='POST'){
  const {scheduled_for}=schedulePostSchema.parse(await readJson(request,1024));
  return json({post:await schedulePost(env,actor,params.postId,scheduled_for)});
 }
 if(params.postId&&action==='approve'&&request.method==='POST')return json({post:await approvePost(env,actor,params.postId)});
 if(params.postId&&action==='cancel'&&request.method==='POST')return json({post:await cancelPost(env,actor,params.postId)});
 if(params.postId&&action==='retry'&&request.method==='POST')return json({post:await retryPost(env,actor,params.postId)});
 throw new HttpError(405,'method_not_allowed','That method is not supported here.');
}

async function handleSeriesRoutes(ctx:GrowthCalendarHandlerCtx):Promise<Response>{
 const {request,url,env,userId,params}=ctx;
 const actor:Actor={tenantId:params.tenantId,userId};
 const action=url.pathname.match(/\/social-series\/[a-f0-9-]{36}\/([a-z]+)$/)?.[1];
 if(request.method==='GET'&&!params.seriesId)return json({series:await listSeries(env,actor)});
 if(request.method==='POST'&&!params.seriesId){
  const input=createSeriesSchema.parse(await readJson(request,2048));
  return json({series:await createSeries(env,actor,input)},201);
 }
 if(params.seriesId&&request.method==='GET'&&!action)return json({series:await getSeries(env,actor,params.seriesId)});
 if(params.seriesId&&action==='approve'&&request.method==='POST')return json({series:await approveSeries(env,actor,params.seriesId)});
 if(params.seriesId&&action==='archive'&&request.method==='POST')return json({series:await archiveSeries(env,actor,params.seriesId)});
 throw new HttpError(405,'method_not_allowed','That method is not supported here.');
}

/** Operator-only manual trigger for the due-post worker (the integrator also
 * wires runDuePosts() to the scheduled cron trigger). Never posts without
 * approval; the worker enforces that again internally. */
async function handleRunDue(ctx:GrowthCalendarHandlerCtx):Promise<Response>{
 const {env,userId,params}=ctx;
 await requireMembership(env,{tenantId:params.tenantId,userId},OPERATORS);
 return json({summary:await runDuePosts(env,{tenantId:params.tenantId})});
}

export const GROWTH_CALENDAR_ROUTES:GrowthCalendarRouteDef[]=[
 {method:'GET',pattern:new RegExp(`^/api/businesses/${TENANT}/social-posts(?:/${POST_ID}(?:/(schedule|approve|cancel|retry))?)?$`),
  summary:'Content calendar: list / create / read / edit / schedule / approve / cancel / retry posts.',handle:handlePostRoutes},
 {method:'POST',pattern:new RegExp(`^/api/businesses/${TENANT}/social-posts(?:/${POST_ID}(?:/(schedule|approve|cancel|retry))?)?$`),
  summary:'Content calendar: list / create / read / edit / schedule / approve / cancel / retry posts.',handle:handlePostRoutes},
 {method:'PATCH',pattern:new RegExp(`^/api/businesses/${TENANT}/social-posts/${POST_ID}$`),
  summary:'Content calendar: edit a draft/scheduled post (locked once approved).',handle:handlePostRoutes},
 {method:'GET',pattern:new RegExp(`^/api/businesses/${TENANT}/social-series(?:/${POST_ID}(?:/(approve|archive))?)?$`),
  summary:'Content calendar series: list / create / approve / archive (per-series approval).',handle:handleSeriesRoutes},
 {method:'POST',pattern:new RegExp(`^/api/businesses/${TENANT}/social-series(?:/${POST_ID}(?:/(approve|archive))?)?$`),
  summary:'Content calendar series: list / create / approve / archive (per-series approval).',handle:handleSeriesRoutes},
 {method:'POST',pattern:new RegExp(`^/api/businesses/${TENANT}/social-posts/run$`),
  summary:'Operator manual trigger for the due-post worker.',handle:handleRunDue},
];

/** Wire the growth-calendar routes into the app's router. The integrator's
 * registrar maps each def to its URL-matching style (manual regex in
 * src/index.ts, or an adapter); patterns expose params.tenantId,
 * params.postId, params.seriesId and the caller's session user id as userId. */
export function registerGrowthCalendarRoutes(app:GrowthCalendarRegistrar):void{
 for(const def of GROWTH_CALENDAR_ROUTES)app.addRoute(def);
}
