import {z} from 'zod';
import {generateText} from 'ai';
import type {Actor,Env} from './env';
import {HttpError} from './http';
import {OPERATORS,requireMembership} from './permissions';
import {billingUsageContext} from './billing/state';
import {loadProactiveContext,localDayKey,shiftLocalDate} from './proactive-detectors';
import {verticalProfile,type Vertical} from './verticals';
import {mayorModel} from './ai-model';

/**
 * Trendpost (Mayor feature order via R&D, 2026-10-14): "what should we post
 * next?" — a 7-day posting plan for the business: per day an angle, a
 * ready-to-use draft in the business's voice, and a best-time slot.
 * REVIEW-GATED like every Mayor action: nothing posts from here. Approving
 * a post marks it ready; channel dispatch stays behind the existing
 * connector state (Meta posting is dark pending App Review), so approved
 * posts are copy-ready deliverables until a live channel exists.
 *
 * Generation is deterministic-first (vertical templates, the same pattern
 * as the proactive engine) with an AI polish pass when the model is
 * reachable; any AI failure or validation miss keeps the templates.
 * The plan is framed as revenue work (money-loop summary): the owner sees
 * "2 promos, 1 review ask, 1 reactivation..." not "7 posts".
 */

export type TrendpostKind='promo'|'education'|'review_ask'|'community'|'reactivation';
export type TrendpostPostState='pending'|'edited'|'approved'|'skipped';

export const KIND_LABELS:Record<TrendpostKind,string>={
 promo:'Promo',education:'Helpful post',review_ask:'Review ask',community:'Community',reactivation:'Reactivation',
};
/** The weekly rotation: revenue work first, filler never. */
const WEEK_KINDS:TrendpostKind[]=['promo','education','review_ask','promo','community','reactivation','education'];
const DAY_NAMES=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
/** Best-time slot per kind (business-local labels). Verticals that close
 * early still post when their customers scroll, so slots key off the kind. */
const KIND_SLOTS:Record<TrendpostKind,string>={promo:'11:30 AM',education:'9:00 AM',review_ask:'5:30 PM',community:'12:30 PM',reactivation:'4:00 PM'};

const ANGLES:Record<TrendpostKind,{en:string;es:string}>={
 promo:{en:'A reason to book this week — lead with an open slot or a seasonal service.',es:'Un motivo para reservar esta semana.'},
 education:{en:'A useful tip your customers will save and share.',es:'Un consejo útil que tus clientes guardarán.'},
 review_ask:{en:'Ask recent happy customers for a Google review — make it effortless.',es:'Pide una reseña en Google a clientes contentos.'},
 community:{en:'Show the people and the place — the face behind the counter.',es:'Muestra a las personas detrás del negocio.'},
 reactivation:{en:'Win back customers you have not seen in a while, with a warm hello.',es:'Recupera clientes que no has visto en un tiempo.'},
};

interface DraftKit{business:string;service:string;customer:string;booking:string}
function draftsFor(kind:TrendpostKind,variant:number,kit:DraftKit,es:boolean):string{
 const b=kit.business,s=kit.service,c=kit.customer;
 if(es){
  switch(kind){
   case 'promo':return variant?`Esta semana en ${b} tenemos espacio para ti. Reserva tu ${s} y sal listo/a. ¡Te esperamos!`:`¿Necesitas un ${s}? En ${b} esta semana hay lugares. Mándanos un mensaje y te agendamos.`;
   case 'education':return variant?`Consejo rápido de ${b}: cuidar tu ${s} entre visitas hace que dure más y se vea mejor. ¿Dudas? Pregúntanos.`:`Lo que le decimos a cada ${c} en ${b}: no esperes a que el problema crezca. Atiéndelo a tiempo y ahorra.`;
   case 'review_ask':return `¿Te atendimos bien en ${b}? Una reseña en Google nos ayuda muchísimo y toma un minuto. ¡Gracias por apoyarnos!`;
   case 'community':return variant?`Detrás de ${b} hay personas de tu barrio que aman lo que hacen. Pasa a saludar esta semana.`:`Así se ve un día en ${b}: trabajo honesto, clientes contentos. Gracias por ser parte.`;
   case 'reactivation':return `¡Te extrañamos en ${b}! Ha pasado un tiempo desde tu última visita. Cuando quieras, aquí estamos — reserva tu ${s} cuando te convenga.`;
  }
 }
 switch(kind){
  case 'promo':return variant?`This week at ${b}, we've got room for you. Book your ${s} and leave taken care of — message us and we'll find your time.`:`Need a ${s}? ${b} has openings this week. Send us a message and we'll get you on the book.`;
  case 'education':return variant?`Quick tip from ${b}: a little care between visits keeps your ${s} looking its best longer. Questions? Just ask us.`:`What we tell every ${c} at ${b}: don't wait for the small thing to become the big thing. Catch it early, save the money.`;
  case 'review_ask':return `Did we take good care of you at ${b}? A quick Google review helps our small business more than you'd believe — it takes a minute. Thank you!`;
  case 'community':return variant?`Behind ${b} are neighbors who love this work. Stop by and say hello this week.`:`A day at ${b}: honest work, happy ${c}s. Thanks for being part of it.`;
  case 'reactivation':return `We've missed you at ${b}! It's been a while since your last visit. Whenever you're ready, we're here — book your ${s} whenever it suits you.`;
 }
}

/** Money-loop rollup: counts by kind, in owner language. */
export function planSummary(kinds:TrendpostKind[]){
 const counts:Record<string,number>={};
 for(const k of kinds)counts[k]=(counts[k]??0)+1;
 const parts: string[]=[];
 const phrase=(n:number,en:string)=>`${n} ${en}${n===1?'':'s'}`;
 if(counts.promo)parts.push(phrase(counts.promo,'promo'));
 if(counts.review_ask)parts.push(phrase(counts.review_ask,'review ask'));
 if(counts.reactivation)parts.push(phrase(counts.reactivation,'reactivation'));
 if(counts.education)parts.push(phrase(counts.education,'helpful post'));
 if(counts.community)parts.push(phrase(counts.community,'community post'));
 return {counts,text:`This week's posts: ${parts.join(', ')}.`};
}

function mondayOf(dayKey:string):string{
 const dow=new Date(`${dayKey}T12:00:00Z`).getUTCDay(); // 0=Sun..6=Sat
 const back=(dow+6)%7; // days since Monday
 return shiftLocalDate(dayKey,-back);
}

/** TRENDPOST ADD-ON GATE — the single swap point for the $39 add-on.
 * Trendpost was specced as a $39/mo add-on (R&D, 2026-10-14), but The
 * Mayor's $39 pricing is blocked on Stripe access, so v1 ships inside the
 * existing plan structure: Pro includes weekly plans; Free may generate
 * ONE sample plan, then the gate closes with an upgrade note. When the
 * add-on lands, replace the body of this function with the add-on
 * entitlement check — routes and UI already key off its result. */
export async function trendpostAccess(env:Env,actor:Actor):Promise<{planId:string;included:boolean;sampleAvailable:boolean}>{
 const usage=await billingUsageContext(env,actor);
 if(usage.planId==='pro')return {planId:'pro',included:true,sampleAvailable:false};
 const prior=await env.AGENT_DB.prepare('SELECT COUNT(*) AS n FROM mayor_trendpost_plans WHERE tenant_id=?').bind(actor.tenantId).first<{n:number}>();
 return {planId:'free',included:false,sampleAvailable:(prior?.n??0)===0};
}

/** What the client needs beside any plan: who you are, and whether
 * "generate this week's plan" will run for you right now. */
export async function trendpostAccessView(env:Env,actor:Actor){
 await requireMembership(env,actor,OPERATORS);
 const a=await trendpostAccess(env,actor);
 return {planId:a.planId,included:a.included,sampleAvailable:a.sampleAvailable,canGenerate:a.included||a.sampleAvailable};
}

export interface TrendpostPostView{id:string;dayIndex:number;dayLabel:string;slot:string;kind:TrendpostKind;kindLabel:string;angle:string;draft:string;state:TrendpostPostState}
export interface TrendpostPlanView{id:string;weekStart:string;summary:string;source:string;posts:TrendpostPostView[]}

interface PostRow{id:string;day_index:number;slot:string;kind:TrendpostKind;angle:string;draft:string;state:TrendpostPostState}

async function planView(env:Env,actor:Actor,planId:string):Promise<TrendpostPlanView>{
 const plan=await env.AGENT_DB.prepare('SELECT * FROM mayor_trendpost_plans WHERE id=? AND tenant_id=?').bind(planId,actor.tenantId).first<{week_start:string;summary_json:string;source:string}>();
 if(!plan)throw new HttpError(404,'trendpost_plan_not_found','That posting plan is not available.');
 const rows=await env.AGENT_DB.prepare('SELECT id,day_index,slot,kind,angle,draft,state FROM mayor_trendpost_posts WHERE plan_id=? ORDER BY day_index').bind(planId).all<PostRow>();
 const summary=JSON.parse(plan.summary_json) as {text:string};
 return {
  id:planId,weekStart:plan.week_start,summary:summary.text,source:plan.source,
  posts:(rows.results??[]).map(r=>({id:r.id,dayIndex:r.day_index,dayLabel:DAY_NAMES[r.day_index]??'',slot:`${DAY_NAMES[r.day_index]??''} ${r.slot}`,kind:r.kind,kindLabel:KIND_LABELS[r.kind],angle:r.angle,draft:r.draft,state:r.state})),
 };
}

/** The current (latest active) plan for the tenant, or null before the first. */
export async function getTrendpostPlan(env:Env,actor:Actor):Promise<TrendpostPlanView|null>{
 await requireMembership(env,actor,OPERATORS);
 const row=await env.AGENT_DB.prepare("SELECT id FROM mayor_trendpost_plans WHERE tenant_id=? AND state='active' ORDER BY created_at DESC LIMIT 1").bind(actor.tenantId).first<{id:string}>();
 if(!row)return null;
 return planView(env,actor,row.id);
}

/** Optional AI polish: rewrite the template drafts in the business's voice.
 * Strictly validated (7 drafts, bounded length, no invented prices) — any
 * miss keeps the templates. Returns null to keep templates. */
async function aiPolish(env:Env,businessName:string,vertical:Vertical,drafts:string[]):Promise<string[]|null>{
 try{
  const v=verticalProfile(vertical);
  const {text}=await generateText({model:mayorModel(env),temperature:0.4,maxOutputTokens:1200,abortSignal:AbortSignal.timeout(20000),
   prompt:`You write social posts for ${businessName}, a local ${v.label.toLowerCase()} business. Rewrite each draft below in the business's warm, plain voice. Rules: keep each under 280 characters; never invent prices, discounts, dates, or claims that are not in the draft; keep any call to action; return ONLY a JSON array of the ${drafts.length} rewritten strings, same order.\n\n${JSON.stringify(drafts)}`});
  const parsed=JSON.parse(text.slice(text.indexOf('['),text.lastIndexOf(']')+1)) as unknown;
  if(!Array.isArray(parsed)||parsed.length!==drafts.length)return null;
  const out=parsed.map(x=>String(x).trim());
  if(out.some(x=>x.length<10||x.length>400||x.includes('$')))return null;
  return out;
 }catch{return null;}
}

export async function generateTrendpostPlan(env:Env,actor:Actor,nowMs=Date.now()):Promise<TrendpostPlanView>{
 await requireMembership(env,actor,OPERATORS);
 const access=await trendpostAccess(env,actor);
 if(!access.included&&!access.sampleAvailable){
  throw new HttpError(402,'trendpost_plan_required','Trendpost weekly plans are part of Pro. Your free sample plan is ready above — upgrade to generate a fresh plan every week.');
 }
 const ctx=await loadProactiveContext(env,actor.tenantId,nowMs);
 const profile=verticalProfile(ctx.vertical);
 const es=ctx.language==='es';
 const kit:DraftKit={business:ctx.businessName,service:profile.vocabulary.service,customer:profile.vocabulary.customer,booking:profile.vocabulary.booking};
 const weekStart=mondayOf(localDayKey(nowMs,ctx.timeZone));
 let drafts=WEEK_KINDS.map((kind,i)=>draftsFor(kind,i%2,kit,es));
 let source='generated';
 const polished=env.AI?await aiPolish(env,ctx.businessName,ctx.vertical,drafts):null;
 if(polished){drafts=polished;source='ai';}
 const summary=planSummary(WEEK_KINDS);
 const planId=crypto.randomUUID().replace(/-/g,'');
 const now=Date.now();
 await env.AGENT_DB.prepare("UPDATE mayor_trendpost_plans SET state='archived' WHERE tenant_id=? AND state='active'").bind(actor.tenantId).run();
 await env.AGENT_DB.prepare('INSERT INTO mayor_trendpost_plans(id,tenant_id,week_start,summary_json,state,source,created_at) VALUES(?,?,?,?,?,?,?)')
  .bind(planId,actor.tenantId,weekStart,JSON.stringify(summary),'active',source,now).run();
 for(let i=0;i<WEEK_KINDS.length;i++){
  const kind=WEEK_KINDS[i];
  await env.AGENT_DB.prepare('INSERT INTO mayor_trendpost_posts(id,plan_id,tenant_id,day_index,slot,kind,angle,draft,state,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
   .bind(crypto.randomUUID().replace(/-/g,''),planId,actor.tenantId,i,KIND_SLOTS[kind],kind,es?ANGLES[kind].es:ANGLES[kind].en,drafts[i],'pending',now).run();
 }
 return planView(env,actor,planId);
}

export const editTrendpostPostSchema=z.object({draft:z.string().trim().min(1).max(500)});

/** Review-gate decisions. Approve = ready to post (copy-ready until a live
 * channel exists); edit replaces the draft and keeps it in review; skip
 * parks it. All tenant-scoped and state-guarded, like suggestion cards. */
export async function decideTrendpostPost(env:Env,actor:Actor,postId:string,action:'approve'|'skip'):Promise<TrendpostPlanView>{
 await requireMembership(env,actor,OPERATORS);
 const post=await env.AGENT_DB.prepare('SELECT plan_id FROM mayor_trendpost_posts WHERE id=? AND tenant_id=?').bind(postId,actor.tenantId).first<{plan_id:string}>();
 if(!post)throw new HttpError(404,'trendpost_post_not_found','That post is not available.');
 const next=action==='approve'?'approved':'skipped';
 const res=await env.AGENT_DB.prepare("UPDATE mayor_trendpost_posts SET state=?,decided_at=? WHERE id=? AND tenant_id=? AND state IN ('pending','edited')").bind(next,Date.now(),postId,actor.tenantId).run();
 if(!res.success)throw new HttpError(500,'trendpost_update_failed','The decision could not be saved.');
 return planView(env,actor,post.plan_id);
}

export async function editTrendpostPost(env:Env,actor:Actor,postId:string,draft:string):Promise<TrendpostPlanView>{
 await requireMembership(env,actor,OPERATORS);
 const parsed=editTrendpostPostSchema.parse({draft});
 const post=await env.AGENT_DB.prepare('SELECT plan_id FROM mayor_trendpost_posts WHERE id=? AND tenant_id=?').bind(postId,actor.tenantId).first<{plan_id:string}>();
 if(!post)throw new HttpError(404,'trendpost_post_not_found','That post is not available.');
 await env.AGENT_DB.prepare("UPDATE mayor_trendpost_posts SET draft=?,state='edited' WHERE id=? AND tenant_id=? AND state IN ('pending','edited')").bind(parsed.draft,postId,actor.tenantId).run();
 return planView(env,actor,post.plan_id);
}
