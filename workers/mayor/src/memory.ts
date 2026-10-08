import { z } from 'zod';
import type { Actor, Env } from './env';
import { requireMembership, OPERATORS } from './permissions';
import { HttpError } from './http';
import {validAssistantName} from './assistant-persona';
import {verticalSchema} from './verticals';

export const profileSchema = z.object({
  name: z.string().min(1).max(160).optional(),
  vertical: verticalSchema.optional(),
  assistantName: z.string().trim().min(1).max(60).refine(validAssistantName,'Choose a short display name using letters, numbers, spaces, or name punctuation.').optional(),
  industry: z.string().max(160).optional(),
  website: z.url().max(2048).optional(),
  description: z.string().max(2000).optional(),
  businessGoals: z.array(z.string().min(1).max(500)).max(10).optional(),
  bottlenecks: z.array(z.string().min(1).max(500)).max(10).optional(),
  currentTools: z.array(z.string().min(1).max(200)).max(20).optional(),
  growthPlan: z.string().min(1).max(3000).optional(),
  locations: z.array(z.string().max(300)).max(20).optional(),
  services: z.array(z.string().max(300)).max(50).optional(),
  staff: z.array(z.string().max(160)).max(50).optional(),
  timeZone: z.string().max(100).refine(v => {try {new Intl.DateTimeFormat('en',{timeZone:v});return true;}catch{return false;} }).optional(),
  hours: z.string().max(2000).optional(),
  appointmentTypes: z.array(z.string().max(300)).max(30).optional(),
  schedulingRules: z.string().max(3000).optional(),
}).strict().refine(v => Object.keys(v).length > 0);
export type Profile = z.infer<typeof profileSchema>;
export const profileSourceSchema=z.object({sourceId:z.uuid(),quotes:z.record(z.string(),z.string().min(5).max(1000))}).strict();
export type ProfileSource=z.infer<typeof profileSourceSchema>;
type Provenance=Record<string,{kind:string;url?:string;sourceId?:string;quote?:string;confirmedAt:string}>;
export async function verifyProfileSource(env:Env,actor:Actor,patch:Profile,input:ProfileSource){
  await requireMembership(env,actor,OPERATORS);
  const source=profileSourceSchema.parse(input);
  if(patch.assistantName!==undefined)throw new HttpError(400,'source_invalid','The assistant name must be chosen by the owner or manager, not imported from a website.');
  const row=await env.AGENT_DB.prepare('SELECT source_url,excerpt FROM mayor_website_sources WHERE id=? AND tenant_id=?').bind(source.sourceId,actor.tenantId).first<{source_url:string;excerpt:string}>();
  if(!row||Object.keys(patch).some(field=>!source.quotes[field]||!row.excerpt.includes(source.quotes[field]))||Object.keys(source.quotes).some(field=>!(field in patch)))
    throw new HttpError(400,'source_invalid','Each proposed website fact needs a matching excerpt from this business source.');
  return {url:row.source_url,...source};
}
export async function readMemory(env: Env, actor: Actor) {
  await requireMembership(env,actor);
  const row=await env.AGENT_DB.prepare("SELECT value_json,revision,confirmed_at,provenance_json FROM mayor_memory WHERE tenant_id=? AND field='profile'").bind(actor.tenantId).first<{value_json:string;revision:number;confirmed_at:string;provenance_json:string}>();
  // Discard fetched private data if membership or tenant access changed in flight.
  await requireMembership(env,actor);
  return {profile: row ? JSON.parse(row.value_json) as Profile : {}, revision:row?.revision??0, confirmedAt:row?.confirmed_at??null,sources:row?JSON.parse(row.provenance_json) as Provenance:{}};
}
export async function confirmProfile(env: Env, actor: Actor, patch: Profile, expectedRevision: number,source?:ProfileSource) {
  await requireMembership(env,actor,OPERATORS);
  const current=await readMemory(env,actor);
  if(current.revision!==expectedRevision) throw new HttpError(409,'profile_changed','Your business details changed. Review the current version first.');
  const profile=profileSchema.parse({...current.profile,...patch});
  const now=new Date().toISOString();
  const verified=source?await verifyProfileSource(env,actor,patch,source):null;
  const sources:Provenance={...current.sources};
  for(const field of Object.keys(patch))sources[field]=verified?{kind:'website_owner_confirmed',url:verified.url,sourceId:verified.sourceId,quote:verified.quotes[field],confirmedAt:now}:{kind:'owner_conversation',confirmedAt:now};
  const mutation=env.AGENT_DB.prepare(`INSERT INTO mayor_memory(tenant_id,field,value_json,source_kind,confirmed_by,confirmed_at,revision,updated_at,provenance_json)
    SELECT ?,'profile',?,'owner_confirmed',?,?,1,?,?
    WHERE EXISTS(SELECT 1 FROM agent_memberships m JOIN agent_tenants t ON t.id=m.tenant_id WHERE m.tenant_id=? AND m.user_id=? AND m.status='active' AND t.status='active' AND m.role IN ('owner','manager') AND (m.expires_at IS NULL OR m.expires_at>?))
    AND COALESCE((SELECT revision FROM mayor_memory WHERE tenant_id=? AND field='profile'),0)=?
    ON CONFLICT(tenant_id,field) DO UPDATE SET value_json=excluded.value_json,confirmed_by=excluded.confirmed_by,
    confirmed_at=excluded.confirmed_at,revision=mayor_memory.revision+1,updated_at=excluded.updated_at,source_kind=excluded.source_kind,provenance_json=excluded.provenance_json
    WHERE mayor_memory.revision=?`).bind(actor.tenantId,JSON.stringify(profile),actor.userId,now,now,JSON.stringify(sources),actor.tenantId,actor.userId,now,actor.tenantId,expectedRevision,expectedRevision);
  const [result]=await env.AGENT_DB.batch([mutation,
    env.AGENT_DB.prepare('INSERT INTO mayor_audit(id,tenant_id,actor_id,event,resource_id,created_at) SELECT ?,?,?,?,?,? WHERE changes()=1')
      .bind(crypto.randomUUID(),actor.tenantId,actor.userId,'profile.confirmed',String(expectedRevision+1),now),
  ]);
  if(result.meta.changes!==1) throw new HttpError(409,'profile_changed','Your profile or access changed. Review the current business profile.');
  return {profile,revision:expectedRevision+1};
}
export function isSpokenConfirmation(text:string) {
  // ASR adds punctuation to the same explicit affirmative phrase. Keep the
  // allowlist exact; qualifications, questions and misrecognized words fail closed.
  const normalized=text.trim().replace(/[’‘]/g,"'").replace(/[,.!]/g,' ').replace(/\s+/g,' ').trim();
  return /^(yes|yes please|yes that is correct|yes it is correct|yes it's correct|yes that's correct|that's correct|that is correct|correct|confirm|save it|save that|go ahead)[.!\s]*$/i.test(normalized);
}
