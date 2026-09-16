import type {Actor,Env} from '../env';
import {HttpError} from '../http';
import {BILLING_ROLES,requireMembership,requireTenant} from '../permissions';
import {platformEmailAccess} from './access';

export function emailUsageWarning(used:number,limit:number){return used>=limit?'100':used*10>=limit*9?'90':used*10>=limit*7?'70':'normal';}
export async function platformEmailUsage(env:Env,actor:Actor){
  await requireTenant(env,actor);await requireMembership(env,actor,BILLING_ROLES);
  let result;
  try{
    const access=await platformEmailAccess(env,actor.tenantId);
    const counts=await env.AGENT_DB.prepare(`SELECT COALESCE(sum(CASE WHEN state='consumed' THEN 1 ELSE 0 END),0) AS accepted,
      COALESCE(sum(CASE WHEN state='held' THEN 1 ELSE 0 END),0) AS reserved
      FROM agent_platform_email_reservations WHERE tenant_id=? AND period=?`)
      .bind(actor.tenantId,access.period).first<{accepted:number;reserved:number}>();
    if(!counts||![counts.accepted,counts.reserved,counts.accepted+counts.reserved].every(n=>Number.isSafeInteger(n)&&n>=0))throw new HttpError(503,'email_usage_unavailable','Email usage could not be verified.');
    const current=await platformEmailAccess(env,actor.tenantId);
    if(current.period!==access.period||current.limit!==access.limit||current.resetsAt!==access.resetsAt)throw new HttpError(409,'email_usage_changed','Email usage changed. Refresh to try again.');
    const used=counts.accepted+counts.reserved;
    result={state:'available' as const,accepted:counts.accepted,reserved:counts.reserved,limit:access.limit,remaining:Math.max(0,access.limit-used),resetsAt:access.resetsAt,warning:emailUsageWarning(used,access.limit),deliveryEnabled:env.AGENT_PLATFORM_EMAIL_ENABLED==='true'&&env.AGENT_PLATFORM_EMAIL_RECOVERY_ENABLED==='true'};
  }catch(error){
    if(!(error instanceof HttpError)||![403,409].includes(error.status))throw error;
    result={state:'unavailable' as const};
  }
  await requireTenant(env,actor);await requireMembership(env,actor,BILLING_ROLES);
  return result;
}
