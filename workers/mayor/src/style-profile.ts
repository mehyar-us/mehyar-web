import {z} from 'zod';
import type {Actor,Env} from './env';
import {OPERATORS,requireMembership} from './permissions';

/* Harness slice 2a — the TWIN (2026-10-17): per-tenant owner-language
 * learning, per the Mayor's reinvention amendments.
 *
 * The corpus is the owner's own words, captured as a side effect of
 * actions they already take (editing a suggestion card today;
 * onboarding samples in 2b). From it, a DETERMINISTIC profile is
 * derived — measurable facts only (lengths, greeting forms, rates),
 * never a model's impression. Corpora never cross tenants: every
 * query below is tenant-scoped.
 *
 * Application in this slice: (1) the harness brief gains a
 * style:owner source (facts + verbatim exemplars) so composed
 * replies speak in the owner's register; (2) card drafts adopt the
 * owner's dominant greeting once the corpus supports it (>= 3
 * samples, one form in at least half). Everything fails quiet:
 * no corpus -> no profile -> today's behavior, unchanged. */
export interface StyleProfile{
 samples:number;
 medianWords:number|null;
 medianSentenceWords:number|null;
 greeting:string|null;
 greetingShare:number;
 emojiRate:number;
 exclamationRate:number;
 contractionRate:number;
 language:'en'|'es'|'mixed'|null;
 exemplars:string[];
 updatedAt:string;
}

const MAX_SAMPLE_CHARS=2000;
const MAX_CORPUS=200;
const ES_MARKERS=new Set(['hola','gracias','tu','su','una','para','con','los','las','del','por','que','cita','citas','negocio','cliente','clientes','mensaje','llamada','cuando','donde','esta','este','horario','precio','precios','bien','muy','nos','les','dia','dias','manana','tarde','noche','quiero','puedo','tengo','vamos','bueno','buena','saludos','feliz','atencion','servicio','servicios']);
const CONTRACTION=/\b\w+(n't|'re|'ll|'ve|'d)\b|\w+'s\b/i;
const EMOJI=/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

function median(values:number[]):number|null{
 if(!values.length)return null;
 const sorted=[...values].sort((a,b)=>a-b);
 const mid=Math.floor(sorted.length/2);
 return sorted.length%2?sorted[mid]:Math.round((sorted[mid-1]+sorted[mid])/2);
}
function wordsOf(text:string):string[]{
 return text.toLowerCase().replace(/[^\p{L}\p{N}'\s]/gu,' ').split(/\s+/).filter(Boolean);
}
function greetingOf(text:string):string|null{
 // The FORM is the greeting itself, never the name that follows it:
 // 'Hey Maria,' and 'Hey Tom,' are the same greeting. Tokens are
 // letter-cleaned before comparison ('Hey!' === 'Hey').
 const tokens=text.trim().split(/\s+/).slice(0,3)
  .map(w=>w.replace(/[^\p{L}]/gu,'')).filter(Boolean);
 if(!tokens.length)return null;
 const first=tokens[0].toLowerCase();
 if(['good'].includes(first)&&tokens[1]&&['morning','afternoon','evening'].includes(tokens[1].toLowerCase()))
  return tokens[0]+' '+tokens[1].toLowerCase();
 if(!['hi','hey','hello','hola','buenas','morning','afternoon','evening','yo','heyy'].includes(first))return null;
 return tokens[1]?.toLowerCase()==='there'?tokens[0]+' there':tokens[0];
}

export function deriveStyleProfile(texts:string[],nowIso:string):StyleProfile{
 const samples=texts.map(t=>t.trim()).filter(Boolean);
 const wordCounts=samples.map(t=>wordsOf(t).length);
 const sentenceWordCounts:number[]=[];
 for(const t of samples){
  for(const sentence of t.split(/[.!?]+/)){
   const n=wordsOf(sentence).length;
   if(n>0)sentenceWordCounts.push(n);
  }
 }
 const greetings=new Map<string,{form:string;count:number}>();
 for(const t of samples){
  const g=greetingOf(t);
  if(!g)continue;
  const key=g.toLowerCase();
  const entry=greetings.get(key)??{form:g,count:0};
  entry.count++;
  greetings.set(key,entry);
 }
 let greeting:string|null=null,greetingShare=0;
 if(samples.length){
  for(const entry of greetings.values()){
   const share=entry.count/samples.length;
   if(share>greetingShare){greetingShare=share;greeting=entry.form;}
  }
 }
 let esWords=0,totalWords=0;
 for(const t of samples){const ws=wordsOf(t);totalWords+=ws.length;for(const w of ws)if(ES_MARKERS.has(w))esWords++;}
 const esShare=totalWords?esWords/totalWords:0;
 const rate=(pred:(t:string)=>boolean)=>samples.length?samples.filter(pred).length/samples.length:0;
 return {
  samples:samples.length,
  medianWords:median(wordCounts),
  medianSentenceWords:median(sentenceWordCounts),
  greeting,greetingShare:Math.round(greetingShare*100)/100,
  emojiRate:Math.round(rate(t=>EMOJI.test(t))*100)/100,
  exclamationRate:Math.round(rate(t=>t.includes('!'))*100)/100,
  contractionRate:Math.round(rate(t=>CONTRACTION.test(t))*100)/100,
  language:samples.length===0?null:esShare>0.25?'es':esShare>0.06?'mixed':'en',
  exemplars:samples.slice(0,3),
  updatedAt:nowIso,
 };
}

/** Capture one owner-authored text into the tenant's corpus and
 * re-derive the profile. Never throws into the caller's flow. */
export async function captureStyleSample(env:Env,tenantId:string,source:'card_edit'|'onboarding'|'owner_message',text:string):Promise<void>{
 try{
  const clean=text.trim().slice(0,MAX_SAMPLE_CHARS);
  if(clean.length<2)return;
  const dupe=await env.AGENT_DB.prepare('SELECT 1 FROM mayor_style_samples WHERE tenant_id=? AND text=? LIMIT 1')
   .bind(tenantId,clean).first();
  if(dupe)return;
  const now=new Date().toISOString();
  await env.AGENT_DB.prepare('INSERT INTO mayor_style_samples(id,tenant_id,source,text,created_at) VALUES(?,?,?,?,?)')
   .bind(crypto.randomUUID(),tenantId,source,clean,now).run();
  await env.AGENT_DB.prepare(`DELETE FROM mayor_style_samples WHERE tenant_id=? AND id NOT IN
   (SELECT id FROM mayor_style_samples WHERE tenant_id=? ORDER BY created_at DESC LIMIT ${MAX_CORPUS})`)
   .bind(tenantId,tenantId).run();
  await recomputeStyleProfile(env,tenantId);
 }catch{/* style capture must never break the owner's action */}
}

export async function recomputeStyleProfile(env:Env,tenantId:string):Promise<StyleProfile>{
 const rows=await env.AGENT_DB.prepare('SELECT text FROM mayor_style_samples WHERE tenant_id=? ORDER BY created_at DESC LIMIT 50')
  .bind(tenantId).all<{text:string}>();
 const now=new Date().toISOString();
 const profile=deriveStyleProfile(rows.results.map(r=>r.text),now);
 await env.AGENT_DB.prepare(`INSERT INTO mayor_memory(tenant_id,field,value_json,source_kind,confirmed_by,confirmed_at,revision,updated_at)
  VALUES(?,'style_profile',?,'system_derived',NULL,?,1,?)
  ON CONFLICT(tenant_id,field) DO UPDATE SET value_json=excluded.value_json,revision=mayor_memory.revision+1,updated_at=excluded.updated_at`)
  .bind(tenantId,JSON.stringify(profile),now,now).run();
 return profile;
}

export async function readStyleProfile(env:Env,tenantId:string):Promise<StyleProfile|null>{
 try{
  const row=await env.AGENT_DB.prepare("SELECT value_json FROM mayor_memory WHERE tenant_id=? AND field='style_profile'")
   .bind(tenantId).first<{value_json:string}>();
  if(!row)return null;
  const parsed=JSON.parse(row.value_json) as StyleProfile;
  return typeof parsed.samples==='number'?parsed:null;
 }catch{return null;}
}

/** Adopt the owner's dominant greeting in a draft, when the corpus
 * supports it (>= 3 samples, one greeting form in at least half).
 * Only a leading Hi/Hola is swapped; nothing else is restructured. */
export function applyGreetingStyle(message:string,profile:StyleProfile|null):string{
 if(!profile||!profile.greeting||profile.samples<3||profile.greetingShare<0.5)return message;
 const match=message.match(/^(Hi|Hola)\b/);
 if(!match)return message;
 const ownerFirst=profile.greeting.split(/\s+/)[0];
 if(match[1].toLowerCase()===ownerFirst.toLowerCase())return message;
 return ownerFirst+message.slice(match[1].length);
}

/** The harness-brief rendering: facts + the owner's own exemplars. */
export function styleSourceDetail(profile:StyleProfile):string{
 const facts=[
  `Owner writing style, learned from ${profile.samples} of their own messages.`,
  profile.medianWords?`Typical message length: about ${profile.medianWords} words.`:'',
  profile.greeting?`Usually opens with "${profile.greeting}".`:'',
  profile.exclamationRate>=0.5?'Uses exclamation points often.':profile.exclamationRate===0?'Rarely uses exclamation points.':'',
  profile.emojiRate>0?'Sometimes uses emoji.':'Does not use emoji.',
  profile.contractionRate>=0.5?'Writes with contractions — casual register.':'Writes few contractions — plainer register.',
 ].filter(Boolean).join(' ');
 const exemplars=profile.exemplars.length?` In their own words: ${profile.exemplars.map(e=>`"${e}"`).join(' · ')}`:'';
 return (facts+exemplars).slice(0,1200);
}

/* ---------------- Slice 2b: onboarding capture service ---------------- */

export interface StyleState{
 totalSamples:number;
 onboardingSamples:number;
 dismissed:boolean;
 greetingAdopted:boolean;
}

export const onboardingSamplesSchema=z.object({
 texts:z.array(z.string().trim().min(2).max(2000)).min(1).max(3),
}).strict();

export async function getStyleState(env:Env,actor:Actor):Promise<StyleState>{
 await requireMembership(env,actor,OPERATORS);
 const counts=await env.AGENT_DB.prepare(`SELECT
  COUNT(*) AS total,
  COALESCE(SUM(source='onboarding'),0) AS onboarding
  FROM mayor_style_samples WHERE tenant_id=?`).bind(actor.tenantId).first<{total:number;onboarding:number}>();
 const dismissedRow=await env.AGENT_DB.prepare("SELECT value_json FROM mayor_memory WHERE tenant_id=? AND field='style_onboarding'")
  .bind(actor.tenantId).first<{value_json:string}>();
 let dismissed=false;
 try{dismissed=(JSON.parse(dismissedRow?.value_json??'{}') as {dismissed?:boolean}).dismissed===true;}catch{/* unreadable = not dismissed */}
 const profile=await readStyleProfile(env,actor.tenantId);
 return {
  totalSamples:counts?.total??0,
  onboardingSamples:counts?.onboarding??0,
  dismissed,
  greetingAdopted:Boolean(profile&&profile.samples>=3&&profile.greeting&&profile.greetingShare>=0.5),
 };
}

export async function saveOnboardingSamples(env:Env,actor:Actor,texts:string[]):Promise<StyleState>{
 await requireMembership(env,actor,OPERATORS);
 for(const text of texts)await captureStyleSample(env,actor.tenantId,'onboarding',text);
 return getStyleState(env,actor);
}

export async function dismissStyleOnboarding(env:Env,actor:Actor):Promise<StyleState>{
 await requireMembership(env,actor,OPERATORS);
 const now=new Date().toISOString();
 await env.AGENT_DB.prepare(`INSERT INTO mayor_memory(tenant_id,field,value_json,source_kind,confirmed_by,confirmed_at,revision,updated_at)
  VALUES(?,'style_onboarding',?,'owner_confirmed',?,?,1,?)
  ON CONFLICT(tenant_id,field) DO UPDATE SET value_json=excluded.value_json,revision=mayor_memory.revision+1,updated_at=excluded.updated_at`)
  .bind(actor.tenantId,JSON.stringify({dismissed:true}),actor.userId,now,now).run();
 return getStyleState(env,actor);
}
