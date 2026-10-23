import {HttpError} from '../http';
import type {Actor,Env} from '../env';
import {getLeadProofPack} from './packs';
const nowISO=()=>new Date().toISOString();

/* LeadProof export (integration spec §4.3 step 6, §5.5): the pack in
 * the tenant's hands — CSV or JSON of leads WITH the why_now and first
 * line attached and the evidence behind each lead. Export is a READ
 * that stamps: the first export marks the pack exported (the §10 QA
 * ledger's delivery point). EXPORT ONLY — this module renders data;
 * nothing anywhere in the LeadProof domain sends it. */
export interface PackLeadRow{id:string;company_name:string;website:string|null;phone:string|null;contact_name:string|null;source_url:string;evidence_json:string;why_now:string;first_line:string|null;score:number|null}
function csvCell(value:string|number|null):string{const text=value===null?'':String(value);return /[",\n]/.test(text)?`"${text.replaceAll('"','""')}"`:text;}
export async function renderLeadProofExport(env:Env,actor:Actor,packId:string,format:'csv'|'json'):Promise<{contentType:string;body:string;filename:string}>{
 const pack=await getLeadProofPack(env.AGENT_DB,actor.tenantId,packId);
 if(!pack)throw new HttpError(404,'leadproof_pack_not_found','That pack does not exist.');
 if(pack.status!=='ready'&&pack.status!=='exported')throw new HttpError(409,'leadproof_pack_not_ready','That pack is not ready to export yet.');
 const leads=(await env.AGENT_DB.prepare('SELECT * FROM mayor_leadproof_leads WHERE pack_id=? AND tenant_id=? ORDER BY created_at').bind(packId,actor.tenantId).all<PackLeadRow>()).results;
 if(pack.status==='ready'){
  await env.AGENT_DB.prepare("UPDATE mayor_leadproof_packs SET status='exported',exported_at=?,updated_at=? WHERE id=? AND status='ready'").bind(nowISO(),nowISO(),packId).run();
 }
 const shaped=leads.map(lead=>({company:lead.company_name,website:lead.website,phone:lead.phone,contact:lead.contact_name,sourceUrl:lead.source_url,whyNow:lead.why_now,firstLine:lead.first_line,score:lead.score,evidence:JSON.parse(lead.evidence_json) as Array<{text:string;sourceUrl:string}>}));
 if(format==='json')return {contentType:'application/json; charset=utf-8',body:JSON.stringify({pack:{id:pack.id,icpText:pack.icpText,leadCount:shaped.length},leads:shaped},null,2),filename:`leadproof-pack-${pack.id.slice(0,8)}.json`};
 const header=['company','website','phone','contact','source_url','why_now','first_line','evidence'];
 const lines=shaped.map(lead=>[lead.company,lead.website,lead.phone,lead.contact,lead.sourceUrl,lead.whyNow,lead.firstLine,lead.evidence.map(item=>item.text).join(' | ')].map(csvCell).join(','));
 return {contentType:'text/csv; charset=utf-8',body:[header.join(','),...lines].join('\n')+'\n',filename:`leadproof-pack-${pack.id.slice(0,8)}.csv`};
}
