import type {Actor,Env} from '../env';
import {BILLING_ROLES,requireMembership,requireTenant} from '../permissions';

const messages:Record<string,string>={subscription_items_mismatch:'The subscription items differ from the saved plan.',subscription_status_mismatch:'The subscription status differs from the saved record.',cancellation_mismatch:'The renewal cancellation setting differs from the saved record.',latest_invoice_unavailable:'The latest invoice could not be identified.',latest_invoice_not_recorded:'The latest invoice is missing from the saved records.',invoice_snapshot_mismatch:'The latest invoice status or amount differs from the saved record.',latest_invoice_mapping_mismatch:'The saved latest-invoice reference differs.',invoice_payment_unverified:'The latest invoice payment needs verification.',invoice_currency_mismatch:'The latest invoice currency differs from the plan.',invoice_period_unverified:'The latest paid invoice period needs verification.',invoice_price_mismatch:'The latest paid invoice does not contain the saved plan price.',paid_through_missing:'Paid-through access is missing from the saved record.',paid_through_behind_invoice:'Paid-through access ends before the latest paid invoice period.'};
export async function reconciliationStatus(env:Env,actor:Actor){
  await requireTenant(env,actor);await requireMembership(env,actor,BILLING_ROLES);
  const row=await env.AGENT_DB.prepare('SELECT status,findings_json,checked_at FROM agent_billing_reconciliation WHERE tenant_id=?').bind(actor.tenantId).first<{status:string;findings_json:string;checked_at:string|null}>();
  if(!row)return null;
  await requireMembership(env,actor,BILLING_ROLES);
  const stamp=row.checked_at?Date.parse(row.checked_at):NaN,checkedAt=Number.isFinite(stamp)&&stamp<=Date.now()?row.checked_at:null;
  let findings:unknown;try{findings=JSON.parse(row.findings_json);}catch{findings=null;}
  if(!['checking','checked','needs_review','failed'].includes(row.status)||!Array.isArray(findings)||findings.length>30||findings.some(code=>typeof code!=='string')||['checked','needs_review'].includes(row.status)&&!checkedAt)return {state:'unavailable',checkedAt:null,stale:true,issues:[] as string[]};
  const issues=[...new Set((findings as string[]).map(code=>Object.hasOwn(messages,code)?messages[code]:'A billing record needs additional review.'))];
  if(row.status==='needs_review'&&!issues.length)issues.push('A billing record needs additional review.');
  return {state:row.status==='checked'&&issues.length?'needs_review':row.status,checkedAt,stale:!checkedAt||Date.now()-stamp>86400000,issues};
}
