import {getPlan} from '../catalog';
import type {Actor,Env,Tenant} from '../env';
import {HttpError} from '../http';
import {RELEASE_GATES,requireVerifiedGates} from './service';

/** Monthly allowance windows even for annual subscriptions. Clamp to the last
 * day of short months without shifting the original anniversary in later months. */
export function monthlyUsageWindow(anchor:string,now=new Date()) {
  const base=new Date(anchor);
  if(!Number.isFinite(base.getTime())||base>now)throw new HttpError(409,'usage_anchor_unavailable','The subscription usage period needs reconciliation.');
  const point=(offset:number)=>{
    const year=base.getUTCFullYear(),month=base.getUTCMonth()+offset;
    const last=new Date(Date.UTC(year,month+1,0)).getUTCDate();
    return new Date(Date.UTC(year,month,Math.min(base.getUTCDate(),last),base.getUTCHours(),base.getUTCMinutes(),base.getUTCSeconds(),base.getUTCMilliseconds()));
  };
  let offset=(now.getUTCFullYear()-base.getUTCFullYear())*12+now.getUTCMonth()-base.getUTCMonth();
  if(point(offset)>now)offset--;
  return {start:point(offset).toISOString(),end:point(offset+1).toISOString()};
}

export async function textAccess(env:Env,actor:Actor,tenant:Tenant,enforce=true) {
  if(tenant.plan_id==='trial') {
    if(enforce&&tenant.trial_expires_at<=new Date().toISOString())throw new HttpError(403,'trial_expired','Your trial has ended. Your workspace remains available for review.');
    return {period:'trial',limit:50,attemptLimit:60};
  }
  try {
    const sub=await env.AGENT_DB.prepare('SELECT stripe_subscription_id,plan_id,usage_anchor,paid_through,grace_expires_at,access_state,dispute_state FROM agent_billing_subscriptions WHERE tenant_id=?')
      .bind(actor.tenantId).first<{stripe_subscription_id:string;plan_id:string;usage_anchor:string|null;paid_through:string|null;grace_expires_at:string|null;access_state:string;dispute_state:string|null}>();
    const plan=getPlan(tenant.plan_id);
    if(!plan||!sub||sub.plan_id!==tenant.plan_id||sub.dispute_state||!['active','past-due','degraded'].includes(tenant.status))throw new HttpError(403,'paid_execution_required','An activated paid subscription is required.');
    const valid=(['active','paid_through'].includes(sub.access_state)&&Date.parse(sub.paid_through??'')>Date.now())
      ||(sub.access_state==='grace'&&Boolean(sub.paid_through)&&Date.parse(sub.grace_expires_at??'')>Date.now());
    if(!valid)throw new HttpError(403,'subscription_access_expired','Paid access is unavailable. Review billing before sending a message.');
    if(!sub.usage_anchor)throw new HttpError(409,'usage_anchor_unavailable','The subscription usage period needs reconciliation.');
    const window=monthlyUsageWindow(sub.usage_anchor);
    if(enforce){await requireVerifiedGates(env,'catalog',RELEASE_GATES);await requireVerifiedGates(env,actor.tenantId,['activation_approved']);}
    return {period:`subscription:${sub.stripe_subscription_id}:${window.start}`,limit:plan.allowances.textAiCredits,attemptLimit:Math.ceil(plan.allowances.textAiCredits*1.2),resetsAt:window.end};
  }catch(error){
    if(!enforce&&error instanceof HttpError)return {period:'unavailable',limit:0,attemptLimit:0};
    throw error;
  }
}
