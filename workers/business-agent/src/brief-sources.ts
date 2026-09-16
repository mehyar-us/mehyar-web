import type {Actor,Env} from './env';
import {OPERATORS,requireMembership,requireTenant} from './permissions';
import {normalizeWebsite} from './tenants';

const mapping:Record<string,string>={business_name:'businessName',category:'category',service:'services',offer_name:'services',price_range:'prices',currency:'currency',hours:'hours',location:'locations',service_area:'serviceArea',contact_phone:'contactRoutes',contact_email:'contactRoutes'};
export type BriefSource={id:string;field:string;value:string;sourceUrl:string;retrievedAt:string;confirmedAt:string;confidence:string};
/** Suggestions only from still-present, unchanged owner-confirmed memory.
 * Arbitrary memory topics and unverified crawl claims cannot supply policies. */
export async function briefSources(env:Env,actor:Actor){
  await requireTenant(env,actor);await requireMembership(env,actor,OPERATORS);
  const rows=await env.AGENT_DB.prepare(`SELECT c.id,c.memory_value,c.source_url,c.evidence_json,c.confirmed_at
    FROM agent_research_confirmations c JOIN agent_memory m ON m.tenant_id=c.tenant_id AND m.id=c.id
    WHERE c.tenant_id=? AND m.source='owner_confirmed_website' AND m.key=c.memory_key
      AND m.value=c.memory_value AND m.source_url=c.source_url
    ORDER BY c.confirmed_at DESC,c.id LIMIT 100`).bind(actor.tenantId)
    .all<{id:string;memory_value:string;source_url:string;evidence_json:string;confirmed_at:string}>();
  const sources:BriefSource[]=[];
  for(const row of rows.results){
    try{
      const evidence=JSON.parse(row.evidence_json),field=mapping[evidence.field],sourceUrl=normalizeWebsite(row.source_url);
      if(!field||!sourceUrl||evidence.value!==row.memory_value||evidence.sourceUrl!==row.source_url||row.memory_value.length>2000||!Number.isFinite(Date.parse(evidence.retrievedAt))||!Number.isFinite(Date.parse(row.confirmed_at))||!['high','medium'].includes(evidence.confidence))continue;
      sources.push({id:row.id,field,value:row.memory_value,sourceUrl,retrievedAt:evidence.retrievedAt,confirmedAt:row.confirmed_at,confidence:evidence.confidence});
    }catch{/* Corrupt or unsupported evidence is not a brief suggestion. */}
  }
  await requireMembership(env,actor,OPERATORS);
  return sources;
}
