import {z} from 'zod';
import type {Actor,Env,Role} from './env';
import {HttpError,json,readJson,requireOrigin} from './http';
import {requireMembership} from './permissions';
import {verticalProfile} from './verticals';
import {knownVerticalProfile} from './assistant-persona';
import {gatewayRun} from './ai-gateway';
import {remapReasoningContent} from './ai-model';

/**
 * Workstream 7f — Ad Generation for The Mayor (mayor.mehyar.us).
 *
 * Meta ad creative + copy generation. DRAFTS ONLY, always:
 * - Zero Meta API calls. No campaign creation, no budget setting, no publishing.
 * - Launching/spending stays a human tap in Ads Manager. Every surface that
 *   shows a package also shows SPEND_NOTICE.
 * - Copy passes validateAdCopy() before a draft is saved; a draft can only
 *   move to `approved` when there are no error-severity flags.
 *
 * Media: adgen composes the package (copy + creative refs). It never
 * generates images or video itself — it references asset records from the
 * image-generation and video workstreams by id (CreativeRef, types only).
 */

/** Owner-only: ads touch the business's money and public voice. */
const OWNER_ONLY:readonly Role[]=['owner'];

/** Shown on every surface that renders an ad package. */
export const SPEND_NOTICE='Drafts only — nothing here spends money. You will launch this yourself in Meta Ads Manager; nothing is published, budgeted, or created on Meta from this page.';

/** Meta call-to-action buttons relevant to local businesses. */
export const META_CTAS=[
 'Shop Now','Book Now','Learn More','Sign Up','Call Now','Get Offer','Get Quote',
 'Send Message','Contact Us','Apply Now','Subscribe','Watch More','Order Now',
 'See Menu','Request Time','Download','Get Directions',
] as const;
export type MetaCta=(typeof META_CTAS)[number];

export const adGoalSchema=z.enum(['bookings','sales','leads','awareness']);
export type AdGoal=z.infer<typeof adGoalSchema>;

/** Deterministic CTA pick per business goal; owner can override from META_CTAS. */
export function pickCtaForGoal(goal:AdGoal):MetaCta{
 switch(goal){
  case 'bookings':return 'Book Now';
  case 'sales':return 'Shop Now';
  case 'leads':return 'Get Quote';
  case 'awareness':return 'Learn More';
 }
}

const creativeRefSchema=z.object({
 kind:z.enum(['image','video']),
 /** Asset record id from the image or video workstream. Type-only reference;
  * adgen never reads the media bytes, it only pairs the id with copy. */
 id:z.string().min(1).max(128),
 label:z.string().min(1).max(120).optional(),
 url:z.string().url().max(2048).optional(),
});
export type CreativeRef=z.infer<typeof creativeRefSchema>;

export const adGenerateRequestSchema=z.object({
 businessName:z.string().trim().min(1).max(160),
 /** Vertical key; anything unknown falls back to the 'other' profile. */
 vertical:z.string().max(64).optional().nullable(),
 offer:z.string().trim().min(1).max(500),
 goal:adGoalSchema,
 /** BCP-47 tag; English-first. */
 language:z.string().regex(/^[a-z]{2}(?:-[A-Z]{2})?$/,'Use a language tag like en or es.').default('en'),
 services:z.array(z.string().trim().min(1).max(120)).max(12).default([]),
 location:z.string().trim().max(160).optional(),
 /** Owner confirms the urgency/scarcity in the offer is real — lifts the
  * fake-urgency rule for this package. */
 verifiedUrgency:z.boolean().default(false),
 /** Owner confirms testimonials/ratings used are real and attributable —
  * lifts the unverified-testimonial rule for this package. */
 verifiedTestimonials:z.boolean().default(false),
 creativeRefs:z.array(creativeRefSchema).max(8).default([]),
 cta:z.enum(META_CTAS).optional(),
}).strict();
export type AdGenerateRequest=z.infer<typeof adGenerateRequestSchema>;

export const adPackageSchema=z.object({
 hooks:z.array(z.string().trim().min(1).max(280)).min(3).max(5),
 primaryTexts:z.array(z.string().trim().min(1).max(2000)).min(2).max(3),
 headlines:z.array(z.string().trim().min(1).max(255)).min(3).max(5),
 description:z.string().trim().min(1).max(500),
 cta:z.enum(META_CTAS),
});
export type AdPackage=z.infer<typeof adPackageSchema>;

export type ValidationSeverity='error'|'warn';
export interface ValidationFlag{
 rule:string;
 severity:ValidationSeverity;
 field:'hooks'|'primaryTexts'|'headlines'|'description';
 index:number;
 match:string;
 message:string;
 fix:string;
}

/** A model text-completion function, injected so tests never call a real model. */
export type AdModelFn=(prompt:string)=>Promise<string>;

/** Defensive read of the vertical profile's ad voice. Unknown verticals fall
 * back to the 'other' profile (same defensive pattern as assistant-persona). */
function adVoiceLine(vertical:string|null|undefined):string{
 const vp=verticalProfile(typeof vertical==='string'?vertical:undefined);
 const v=vp.vocabulary;
 const known=knownVerticalProfile({vertical:vp.vertical});
 const tone=known&&(known as {suggestionVoice?:unknown}).suggestionVoice;
 const toneLine=typeof tone==='string'&&tone.trim()?` Tone: ${tone.trim()}`:'';
 const nouns=(known as {briefingNouns?:{appointments?:unknown;customers?:unknown}|null}|null)?.briefingNouns;
 const nounsLine=nouns&&typeof nouns.appointments==='string'&&typeof nouns.customers==='string'
  ?` Say “${nouns.appointments}” and “${nouns.customers}”, never generic “bookings” or “customers”.`:'';
 return `This business is a ${vp.label.toLowerCase()}. Its customers are “${v.customer}”, bookings are “${v.booking}”, staff are “${v.staff}”, services are “${v.service}” — use these words, never another trade's jargon.${toneLine}${nounsLine}`;
}

/** Deterministic brief injection: vertical vocab, tone, KPIs-as-benefit-anchors,
 * plus the compliance guardrails block. Follows the assistant-persona.ts pattern
 * of explicit vocab/tone/KPIs in the prompt. */
export function buildAdBrief(input:AdGenerateRequest):string{
 const vp=verticalProfile(typeof input.vertical==='string'?input.vertical:undefined);
 const kpis=Array.isArray((vp as {kpis?:unknown}).kpis)
  ?(vp as {kpis:{label:string;hint:string}[]}).kpis.filter(k=>k&&typeof k.label==='string')
  :[];
 const kpiLine=kpis.length?`\nBenefits should ladder to what this trade measures: ${kpis.map(k=>`${k.label} (${k.hint})`).join('; ')}.`:'';
 const servicesLine=input.services.length?`\nServices on offer: ${input.services.join(', ')}.`:'';
 const locationLine=input.location?`\nLocation: ${input.location}.`:'';
 const langLine=input.language==='en'?'Write all copy in English.':`Write all copy in language ${input.language}. English business terms only where the audience would expect them.`;
 const goalLine={bookings:'drive bookings',sales:'drive purchases',leads:'generate quote/inquiry leads',awareness:'build local awareness'}[input.goal];
 return `You write Meta ad copy for a local business. Business: ${input.businessName}. Offer: ${input.offer}.${servicesLine}${locationLine}\nGoal: ${goalLine}. Call to action: ${input.cta??pickCtaForGoal(input.goal)}.\n\n${adVoiceLine(input.vertical)}${kpiLine}\n${langLine}\n\nProduce ONLY valid JSON with these keys (no markdown fences, no commentary):\n{\n "hooks": ["3-5 short scroll-stopping hooks, max 120 chars each"],\n "primaryTexts": ["2-3 primary text variants, 2-4 sentences each"],\n "headlines": ["3-5 headlines, max 40 chars each"],\n "description": "one supporting description line, max 125 chars"\n}\n\nMETA + COMPLIANCE GUARDRAILS (hard rules — the copy is validated against these after generation):\n- Never promise guaranteed outcomes: no "guaranteed results", "100% success", "we guarantee more customers", "#1" claims, or unverifiable superlatives ("best X in town"). Claims must be defensible.\n- No fake urgency or scarcity: no "only 2 left", "offer ends tonight", "last chance", "act now" countdowns unless the offer genuinely has that constraint.\n- No testimonials, star ratings, or review quotes unless they are real and attributable.\n- No before/after claims and no rapid-transformation promises ("in just 7 days").\n- Never target or imply protected attributes: no race, religion, age-bracket, or disability targeting language.\n- Never assert the reader's personal attributes: no "Are you a busy mom...?", "Tired of being overweight?", "Do you suffer from..." style copy. Meta rejects this.\n- One idea per line. No hashtags in primary text.`;
}

/** Pulls a JSON object out of model text, tolerating fences and prose. */
function extractJsonObject(text:string):unknown{
 const fence=text.match(/```(?:json)?\s*([\s\S]*?)```/i);
 const candidate=(fence?fence[1]:text).trim();
 try{return JSON.parse(candidate);}catch{/* fall through to brace scan */}
 const start=candidate.indexOf('{');
 if(start<0)throw new Error('model_no_json');
 let depth=0,inStr=false,esc=false;
 for(let i=start;i<candidate.length;i++){
  const ch=candidate[i];
  if(inStr){if(esc)esc=false;else if(ch==='\\')esc=true;else if(ch==='"')inStr=false;continue;}
  if(ch==='"'){inStr=true;continue;}
  if(ch==='{')depth++;
  if(ch==='}'){depth--;if(depth===0){try{return JSON.parse(candidate.slice(start,i+1));}catch{throw new Error('model_bad_json');}}}
 }
 throw new Error('model_bad_json');
}

/** Model output shape before CTA is attached deterministically. */
const modelOutputSchema=z.object({
 hooks:z.array(z.string()).min(1),
 primaryTexts:z.array(z.string()).min(1),
 headlines:z.array(z.string()).min(1),
 description:z.string(),
});
const clampStrings=(values:string[],min:number,max:number)=>values
 .map(v=>v.trim()).filter(v=>v.length>0).slice(0,max);

/** Generates an ad package through an injected model function. Counts are
 * clamped into the contract (3-5 hooks, 2-3 primary texts, 3-5 headlines);
 * CTA is picked deterministically from the goal unless explicitly overridden. */
export async function generateAdPackage(input:AdGenerateRequest,model:AdModelFn):Promise<{pkg:AdPackage;flags:ValidationFlag[];blocked:boolean;brief:string}>{
 const parsed=adGenerateRequestSchema.parse(input);
 const brief=buildAdBrief(parsed);
 let raw:string;
 try{raw=await model(brief);}catch{throw new HttpError(502,'ad_model_unavailable','Ad generation is temporarily unavailable. Try again.');}
 const output=modelOutputSchema.parse(extractJsonObject(raw));
 const pkg:AdPackage={
  hooks:clampStrings(output.hooks,3,5),
  primaryTexts:clampStrings(output.primaryTexts,2,3),
  headlines:clampStrings(output.headlines,3,5),
  description:output.description.trim(),
  cta:parsed.cta??pickCtaForGoal(parsed.goal),
 };
 const validated=adPackageSchema.parse(pkg);
 const {flags,blocked}=validateAdCopy(validated,{
  verifiedUrgency:parsed.verifiedUrgency,
  verifiedTestimonials:parsed.verifiedTestimonials,
 });
 return {pkg:validated,flags,blocked,brief};
}

/* ---------------- validateAdCopy ---------------- */

interface CopyRule{
 rule:string;
 severity:ValidationSeverity;
 patterns:RegExp[];
 message:string;
 fix:string;
 /** Skip the rule when the owner verified the underlying fact. */
 skipWhen?:'urgency'|'testimonial';
}

const COPY_RULES:CopyRule[]=[
 {
  rule:'guaranteed-results',severity:'error',
  patterns:[
   /\bguarantee[sd]?\s+(you(['’]ll)?|your|our|we(['’]ll)?)?\s*(results?|outcomes?|success|rankings?|growth|more\s+(customers?|clients?|guests?|patients?|bookings?|reservations?|jobs?|sales)|a\s+full\s+book)/i,
   /\b100%\s+(guarantee[sd]?|results?|success|satisfaction)\b/i,
   /\b(results?|success)\s+guarantee[sd]?\b/i,
  ],
  message:'Promises a guaranteed outcome. Meta rejects guaranteed-results claims and compliance item 12 requires defensible claims.',
  fix:'Soften to what the business actually does, e.g. “we work until you are happy” is still a guarantee — prefer concrete service facts.',
 },
 {
  rule:'fake-urgency',severity:'warn',skipWhen:'urgency',
  patterns:[
   /\bonly\s+\d+\s+(left|spots?|slots?|seats?|remaining)\b/i,
   /\b(ends?|expir\w+)\s+(tonight|today|at\s+midnight|this\s+(weekend|sunday))\b/i,
   /\blast\s+chance\b/i,
   /\bact\s+now\b/i,
   /\bdon['’]t\s+miss\s+(out|this)\b/i,
  ],
  message:'Urgency/scarcity language. Only real if the business confirms it; fake urgency is a dark pattern (compliance item 9).',
  fix:'Remove, or have the owner confirm the constraint is real (verifiedUrgency).',
 },
 {
  rule:'unverified-testimonial',severity:'warn',skipWhen:'testimonial',
  patterns:[
   /\brated?\s+\d+(\.\d+)?\s*(out\s+of\s+\d+\s*)?stars?\b/i,
   /\u2605{3,}/,
   /\b\d+[-\s]?star\s+(rated|reviews?)\b/i,
   /"[^"\n]{10,140}"\s*[-—–]\s*[\p{Lu}][\p{L}.]+/u,
  ],
  message:'Looks like a testimonial, rating, or review quote. Compliance item 11: every testimonial must be real and attributable — never invent them.',
  fix:'Remove, or have the owner confirm it is a real, attributable customer quote (verifiedTestimonials).',
 },
 {
  rule:'before-after',severity:'warn',
  patterns:[
   /\bbefore\s*(and|\/|&)\s*after\b/i,
   /\bin\s+just\s+\d+\s+(days?|weeks?)\b/i,
  ],
  message:'Before/after or rapid-transformation claim. Meta rejects misleading before/after framing.',
  fix:'Describe the service and outcome honestly without the transformation framing.',
 },
 {
  rule:'protected-attribute',severity:'error',
  patterns:[
   /\bfor\s+(christians?|muslims?|jews?|hindus?|buddhists?|sikhs?|atheists?)\b/i,
   /\b(black|white|asian|latino|latina|hispanic)\s+(families|households|customers?|clients?|people|moms?|dads?)\b/i,
   /\b(disabled|handicapped)\s+(people|customers?|clients?|drivers?)\b/i,
   /\b(?:for\s+)?(?:people\s+)?(?:aged?\s+)?(?:55|60|65)\s*\+/i,
  ],
  message:'Targets or implies a protected attribute (race, religion, age bracket, disability). Forbidden in ad targeting language.',
  fix:'Rewrite for the service need, not the audience identity.',
 },
 {
  rule:'personal-attribute',severity:'error',
  patterns:[
   /\bare\s+you\s+(a|an|the)\s+\S+/i,
   /\bare\s+you\s+(still\s+)?(struggling|suffering|tired|putting\s+up)\b/i,
   /\bdo\s+you\s+(suffer|struggle)\b/i,
   /\btired\s+of\s+being\b/i,
   /\byour\s+(debt|baldness|weight|wrinkles|acne|bald\s+spot|receding\s+hairline)\b/i,
  ],
  message:'Asserts or implies the reader\u2019s personal attributes (“Are you a busy mom…?”). Meta\u2019s personal-attributes policy rejects this.',
  fix:'Flip to the business: “Busy schedule? Evening appointments available.”',
 },
 {
  rule:'unsubstantiated-superlative',severity:'warn',
  patterns:[
   /#\s*1\b/,
   /\bnumber\s+one\b/i,
   /\bbest\s+\w+\s+in\s+(town|brooklyn|the\s+city|nyc|new\s+york|america)\b/i,
  ],
  message:'Unverifiable superlative. Compliance item 12: claims must be defensible.',
  fix:'Replace with a concrete, checkable fact (years in business, services, hours).',
 },
];

const FIELD_LINES:{[K in 'hooks'|'primaryTexts'|'headlines'|'description']: (pkg:AdPackage)=>string[]} = {
 hooks:pkg=>pkg.hooks,
 primaryTexts:pkg=>pkg.primaryTexts,
 headlines:pkg=>pkg.headlines,
 description:pkg=>[pkg.description],
};

/** Flags guardrail violations in an ad package. Pure function — no D1, no model. */
export function validateAdCopy(pkg:AdPackage,opts:{verifiedUrgency?:boolean;verifiedTestimonials?:boolean}={}):{flags:ValidationFlag[];blocked:boolean}{
 const parsed=adPackageSchema.parse(pkg);
 const flags:ValidationFlag[]=[];
 for(const rule of COPY_RULES){
  if(rule.skipWhen==='urgency'&&opts.verifiedUrgency)continue;
  if(rule.skipWhen==='testimonial'&&opts.verifiedTestimonials)continue;
  for(const field of Object.keys(FIELD_LINES) as Array<keyof typeof FIELD_LINES>){
   FIELD_LINES[field](parsed).forEach((line,index)=>{
    for(const pattern of rule.patterns){
     const match=line.match(pattern);
     if(match){
      flags.push({rule:rule.rule,severity:rule.severity,field,index,match:match[0].slice(0,80),message:rule.message,fix:rule.fix});
      break;
     }
    }
   });
  }
 }
 return {flags,blocked:flags.some(f=>f.severity==='error')};
}

/* ---------------- D1 drafts ---------------- */

export interface AdDraft{
 id:string;
 tenantId:string;
 offer:string;
 goal:AdGoal;
 language:string;
 pkg:AdPackage;
 creativeRefs:CreativeRef[];
 flags:ValidationFlag[];
 blocked:boolean;
 status:'draft'|'approved';
 createdAt:string;
 updatedAt:string;
}
interface AdDraftRow{
 id:string;tenant_id:string;offer:string;goal:string;language:string;
 copy_json:string;creative_refs_json:string;validation_json:string;
 status:'draft'|'approved';created_at:string;updated_at:string;
}
function rowToDraft(row:AdDraftRow):AdDraft{
 const pkg=adPackageSchema.parse(JSON.parse(row.copy_json));
 const flags=(JSON.parse(row.validation_json) as ValidationFlag[]).filter(f=>f&&typeof f.rule==='string');
 return {
  id:row.id,tenantId:row.tenant_id,offer:row.offer,
  goal:adGoalSchema.parse(row.goal),language:row.language,
  pkg,creativeRefs:z.array(creativeRefSchema).parse(JSON.parse(row.creative_refs_json)),
  flags,blocked:flags.some(f=>f.severity==='error'),status:row.status,
  createdAt:row.created_at,updatedAt:row.updated_at,
 };
}

export async function createAdDraft(env:Env,actor:Actor,input:{offer:string;goal:AdGoal;language?:string;pkg:AdPackage;creativeRefs?:CreativeRef[]}):Promise<AdDraft>{
 await requireMembership(env,actor,OWNER_ONLY);
 const pkg=adPackageSchema.parse(input.pkg);
 const goal=adGoalSchema.parse(input.goal);
 const language=input.language??'en';
 if(!/^[a-z]{2}(?:-[A-Z]{2})?$/.test(language))throw new HttpError(400,'invalid_language','Use a language tag like en or es.');
 const refs=z.array(creativeRefSchema).max(8).parse(input.creativeRefs??[]);
 const {flags}=validateAdCopy(pkg);
 const now=new Date().toISOString(),id=crypto.randomUUID();
 await env.AGENT_DB.prepare(`INSERT INTO ad_drafts(id,tenant_id,user_id,offer,goal,language,copy_json,creative_refs_json,validation_json,status,created_at,updated_at)
  VALUES(?,?,?,?,?,?,?,?,?,'draft',?,?)`).bind(id,actor.tenantId,actor.userId,input.offer.trim(),goal,language,JSON.stringify(pkg),JSON.stringify(refs),JSON.stringify(flags),now,now).run();
 return rowToDraft({id,tenant_id:actor.tenantId,offer:input.offer.trim(),goal,language,copy_json:JSON.stringify(pkg),creative_refs_json:JSON.stringify(refs),validation_json:JSON.stringify(flags),status:'draft',created_at:now,updated_at:now});
}

export async function listAdDrafts(env:Env,actor:Actor):Promise<Array<Pick<AdDraft,'id'|'offer'|'goal'|'language'|'status'|'createdAt'|'updatedAt'>&{flagCounts:{error:number;warn:number};blocked:boolean}>>{
 await requireMembership(env,actor,OWNER_ONLY);
 const rows=await env.AGENT_DB.prepare('SELECT * FROM ad_drafts WHERE tenant_id=? AND user_id=? ORDER BY updated_at DESC,id DESC LIMIT 50')
  .bind(actor.tenantId,actor.userId).all<AdDraftRow>();
 return rows.results.map(row=>{
  const flags=(JSON.parse(row.validation_json) as ValidationFlag[]).filter(f=>f&&typeof f.rule==='string');
  return {id:row.id,offer:row.offer,goal:adGoalSchema.parse(row.goal),language:row.language,status:row.status,createdAt:row.created_at,updatedAt:row.updated_at,
   flagCounts:{error:flags.filter(f=>f.severity==='error').length,warn:flags.filter(f=>f.severity==='warn').length},
   blocked:flags.some(f=>f.severity==='error')};
 });
}

export async function getAdDraft(env:Env,actor:Actor,id:string):Promise<AdDraft>{
 await requireMembership(env,actor,OWNER_ONLY);
 const row=await env.AGENT_DB.prepare('SELECT * FROM ad_drafts WHERE id=? AND tenant_id=? AND user_id=?')
  .bind(id,actor.tenantId,actor.userId).first<AdDraftRow>();
 if(!row)throw new HttpError(404,'draft_not_found','This ad draft is not available.');
 return rowToDraft(row);
}

/** Editing a draft re-validates the copy and resets status to draft. */
export async function updateAdDraft(env:Env,actor:Actor,id:string,input:{offer?:string;pkg?:AdPackage;creativeRefs?:CreativeRef[]}):Promise<AdDraft>{
 await requireMembership(env,actor,OWNER_ONLY);
 const current=await getAdDraft(env,actor,id);
 const offer=input.offer!==undefined?input.offer.trim():current.offer;
 if(!offer)throw new HttpError(400,'offer_required','The offer cannot be empty.');
 const pkg=input.pkg!==undefined?adPackageSchema.parse(input.pkg):current.pkg;
 const refs=input.creativeRefs!==undefined?z.array(creativeRefSchema).max(8).parse(input.creativeRefs):current.creativeRefs;
 const {flags}=validateAdCopy(pkg);
 const now=new Date().toISOString();
 const changes=await env.AGENT_DB.prepare(`UPDATE ad_drafts SET offer=?,copy_json=?,creative_refs_json=?,validation_json=?,status='draft',updated_at=?
  WHERE id=? AND tenant_id=? AND user_id=?`).bind(offer,JSON.stringify(pkg),JSON.stringify(refs),JSON.stringify(flags),now,id,actor.tenantId,actor.userId).run();
 if(!changes.meta.changes)throw new HttpError(404,'draft_not_found','This ad draft is not available.');
 return getAdDraft(env,actor,id);
}

export async function deleteAdDraft(env:Env,actor:Actor,id:string):Promise<{deleted:true}>{
 await requireMembership(env,actor,OWNER_ONLY);
 const changes=await env.AGENT_DB.prepare('DELETE FROM ad_drafts WHERE id=? AND tenant_id=? AND user_id=?')
  .bind(id,actor.tenantId,actor.userId).run();
 if(!changes.meta.changes)throw new HttpError(404,'draft_not_found','This ad draft is not available.');
 return {deleted:true};
}

/** Approval requires zero error-severity flags. Warnings stay visible. */
export async function approveAdDraft(env:Env,actor:Actor,id:string):Promise<AdDraft>{
 await requireMembership(env,actor,OWNER_ONLY);
 const current=await getAdDraft(env,actor,id);
 if(current.blocked)throw new HttpError(409,'draft_blocked','Resolve the flagged issues before approving this draft.');
 const now=new Date().toISOString();
 await env.AGENT_DB.prepare(`UPDATE ad_drafts SET status='approved',updated_at=? WHERE id=? AND tenant_id=? AND user_id=?`)
  .bind(now,id,actor.tenantId,actor.userId).run();
 return getAdDraft(env,actor,id);
}

/* ---------------- default model (Workers AI via gateway) ---------------- */

const AD_MODEL_ID='@cf/qwen/qwen3-30b-a3b-fp8';

function extractModelText(output:unknown):string{
 const remapped=remapReasoningContent(output);
 const message=(remapped as {choices?:Array<{message?:{content?:unknown}}>}).choices?.[0]?.message;
 const content=message?.content;
 if(typeof content==='string'&&content.trim())return content;
 const response=(remapped as {response?:unknown}).response;
 if(typeof response==='string'&&response.trim())return response;
 throw new Error('model_empty_text');
}

/** Production model function: Workers AI through the shared AI gateway
 * (gateway with direct-binding fallback), same path as the rest of the app. */
export function createAdModel(env:Env):AdModelFn{
 const run=gatewayRun(env as Parameters<typeof gatewayRun>[0]);
 return async(prompt:string)=>{
  const output=await run(AD_MODEL_ID,{messages:[
   {role:'system',content:'You are a Meta ad copywriter for local businesses. Reply with only the requested JSON.'},
   {role:'user',content:prompt},
  ]});
  return extractModelText(output);
 };
}

/* ---------------- routes ---------------- */

/** Export format: copy-paste-ready for Meta Ads Manager. */
export function exportForAdsManager(pkg:AdPackage):string{
 const numbered=(items:string[])=>items.map((item,i)=>`${i+1}. ${item}`).join('\n');
 return [
  'AD COPY — paste into Meta Ads Manager',
  '',
  'HOOKS (use as first line or video text overlay)',
  numbered(pkg.hooks),
  '',
  'PRIMARY TEXT (pick one)',
  pkg.primaryTexts.map((text,i)=>`--- Option ${i+1} ---\n${text}`).join('\n\n'),
  '',
  'HEADLINES',
  numbered(pkg.headlines),
  '',
  'DESCRIPTION',
  pkg.description,
  '',
  'CALL TO ACTION',
  pkg.cta,
  '',
  SPEND_NOTICE,
 ].join('\n');
}

/** Native wiring for src/index.ts (one line, like the other workstreams):
 * `const adgen=await handleAdgenRequest(request,env,actor); if(adgen)return adgen;` */
export async function handleAdgenRequest(request:Request,env:Env,actor:Actor,model?:AdModelFn):Promise<Response|null>{
 const match=new URL(request.url).pathname.match(/^\/api\/businesses\/([a-f0-9]{32})\/adgen(?:\/(generate|validate|drafts(?:\/([^/]+)(?:\/(approve))?)?))?$/);
 if(!match)return null;
 if(match[1]!==actor.tenantId)throw new HttpError(404,'workspace_not_found','This workspace is not available.');
 await requireMembership(env,actor,OWNER_ONLY);
 const [, , action, draftId, approve]=match;

 if(action==='generate'&&request.method==='POST'){
  requireOrigin(request,env.APP_ORIGIN);
  const input=adGenerateRequestSchema.parse(await readJson(request,8192));
  const {pkg,flags,blocked}=await generateAdPackage(input,model??createAdModel(env));
  return json({package:pkg,flags,blocked,notice:SPEND_NOTICE,exportText:exportForAdsManager(pkg)});
 }
 if(action==='validate'&&request.method==='POST'){
  requireOrigin(request,env.APP_ORIGIN);
  const body=z.object({package:adPackageSchema,verifiedUrgency:z.boolean().optional(),verifiedTestimonials:z.boolean().optional()}).strict()
   .parse(await readJson(request,32768));
  const {flags,blocked}=validateAdCopy(body.package,{verifiedUrgency:body.verifiedUrgency,verifiedTestimonials:body.verifiedTestimonials});
  return json({flags,blocked,notice:SPEND_NOTICE});
 }
 if(action==='drafts'&&!draftId){
  if(request.method==='GET')return json({drafts:await listAdDrafts(env,actor),notice:SPEND_NOTICE});
  if(request.method==='POST'){
   requireOrigin(request,env.APP_ORIGIN);
   const body=z.object({offer:z.string().trim().min(1).max(500),goal:adGoalSchema,language:z.string().regex(/^[a-z]{2}(?:-[A-Z]{2})?$/).optional(),package:adPackageSchema,creativeRefs:z.array(creativeRefSchema).max(8).optional()}).strict()
    .parse(await readJson(request,32768));
   return json({draft:await createAdDraft(env,actor,{offer:body.offer,goal:body.goal,language:body.language,pkg:body.package,creativeRefs:body.creativeRefs}),notice:SPEND_NOTICE},201);
  }
 }
 if(action==='drafts'&&draftId){
  z.string().min(1).max(128).parse(draftId);
  if(approve&&request.method==='POST'){requireOrigin(request,env.APP_ORIGIN);return json({draft:await approveAdDraft(env,actor,draftId),notice:SPEND_NOTICE});}
  if(!approve&&request.method==='GET')return json({draft:await getAdDraft(env,actor,draftId),notice:SPEND_NOTICE});
  if(!approve&&request.method==='PUT'){
   requireOrigin(request,env.APP_ORIGIN);
   const body=z.object({offer:z.string().trim().min(1).max(500).optional(),package:adPackageSchema.optional(),creativeRefs:z.array(creativeRefSchema).max(8).optional()}).strict()
    .parse(await readJson(request,32768));
   return json({draft:await updateAdDraft(env,actor,draftId,body),notice:SPEND_NOTICE});
  }
  if(!approve&&request.method==='DELETE'){requireOrigin(request,env.APP_ORIGIN);return json(await deleteAdDraft(env,actor,draftId));}
 }
 throw new HttpError(405,'method_not_allowed','This ad action is unavailable.');
}

/* ---------------- registerAdgenRoutes(app) ---------------- */

/** Minimal router surface `registerAdgenRoutes` can attach to. Handlers get the
 * raw Request plus a context the integrator supplies (env + signed-in actor). */
export interface AdgenRouter{
 get(path:string,handler:AdgenRouteHandler):unknown;
 post(path:string,handler:AdgenRouteHandler):unknown;
 put(path:string,handler:AdgenRouteHandler):unknown;
 delete(path:string,handler:AdgenRouteHandler):unknown;
}
export type AdgenRouteHandler=(request:Request,ctx:{env:Env;actor:Actor})=>Promise<Response>;
export type AdgenContextResolver=(request:Request)=>{env:Env;actor:Actor}|Promise<{env:Env;actor:Actor}>;

const ADGEN_BASE='/api/businesses/:tenantId/adgen';

/**
 * Registers the five ad-studio routes on any minimal method-based router:
 * generate package, list drafts, create/edit/validate/delete/approve drafts.
 * Owner-only; drafts only — nothing here calls Meta, creates campaigns, or
 * sets budgets. `resolveContext` supplies env + the signed-in owner actor.
 */
export function registerAdgenRoutes(app:AdgenRouter,resolveContext:AdgenContextResolver):void{
 const withCtx=(fn:(request:Request,env:Env,actor:Actor)=>Promise<Response>):AdgenRouteHandler=>
  async(request,ctx)=>{
   const resolved=ctx??await resolveContext(request);
   return fn(request,resolved.env,resolved.actor);
  };
 const asPath=(request:Request,env:Env,actor:Actor)=>{
  // Rebuild the native path shape handleAdgenRequest matches on.
  const url=new URL(request.url);
  const tenantId=url.pathname.split('/')[3]??actor.tenantId;
  const rest=url.pathname.slice(url.pathname.indexOf('/adgen'));
  return new Request(`${url.origin}/api/businesses/${tenantId}${rest}`,request);
 };
 const call=(fn:(request:Request,env:Env,actor:Actor,model?:AdModelFn)=>Promise<Response|null>)=>withCtx(
  async(request,env,actor)=>{
   const response=await fn(asPath(request,env,actor),env,actor);
   if(!response)throw new HttpError(404,'not_found','Ad route not found.');
   return response;
  });
 app.post(`${ADGEN_BASE}/generate`,call(handleAdgenRequest));
 app.post(`${ADGEN_BASE}/validate`,call(handleAdgenRequest));
 app.get(`${ADGEN_BASE}/drafts`,call(handleAdgenRequest));
 app.post(`${ADGEN_BASE}/drafts`,call(handleAdgenRequest));
 app.get(`${ADGEN_BASE}/drafts/:id`,call(handleAdgenRequest));
 app.put(`${ADGEN_BASE}/drafts/:id`,call(handleAdgenRequest));
 app.delete(`${ADGEN_BASE}/drafts/:id`,call(handleAdgenRequest));
 app.post(`${ADGEN_BASE}/drafts/:id/approve`,call(handleAdgenRequest));
}
