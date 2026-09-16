import type {Env} from '../env';
import {CATALOG_VERSION,getPlan} from '../catalog';
import {HttpError} from '../http';
import {monthlyUsageWindow} from '../billing/text-access';
import {RELEASE_GATES,requireVerifiedGates} from '../billing/service';
import type {EmailAllowance} from './allowance';

/** Internal entitlement lookup. Does not grant tenant or invitation authority. */
export async function platformEmailAccess(env:Env,tenantId:string,now=new Date()):Promise<EmailAllowance>{
  const time=now.getTime();
  if(!Number.isFinite(time))throw new HttpError(409,'email_allowance_unavailable','Email allowance verification is unavailable.');
  const sub=await env.AGENT_DB.prepare(`SELECT s.*,t.plan_id AS tenant_plan,t.status AS tenant_status
    FROM agent_billing_subscriptions s JOIN agent_tenants t ON t.id=s.tenant_id WHERE s.tenant_id=?`)
    .bind(tenantId).first<{plan_id:string;tenant_plan:string;tenant_status:string;catalog_version:string;stripe_subscription_id:string;usage_anchor:string|null;paid_through:string|null;grace_expires_at:string|null;access_state:string;dispute_state:string|null}>();
  const plan=sub&&getPlan(sub.plan_id);
  if(!sub||!plan||sub.plan_id!==sub.tenant_plan||sub.catalog_version!==CATALOG_VERSION||sub.dispute_state||!['active','past-due','degraded'].includes(sub.tenant_status))throw new HttpError(403,'email_subscription_required','An activated subscription is required for platform email.');
  const valid=(['active','paid_through'].includes(sub.access_state)&&Date.parse(sub.paid_through??'')>time)
    ||(sub.access_state==='grace'&&Number.isFinite(Date.parse(sub.paid_through??''))&&Date.parse(sub.grace_expires_at??'')>time);
  if(!valid)throw new HttpError(403,'email_subscription_expired','Platform email access has expired. Review billing.');
  if(!sub.usage_anchor)throw new HttpError(409,'usage_anchor_unavailable','The subscription usage period needs reconciliation.');
  const window=monthlyUsageWindow(sub.usage_anchor,now);
  await requireVerifiedGates(env,'catalog',RELEASE_GATES,now);
  await requireVerifiedGates(env,tenantId,['activation_approved'],now);
  return {period:`subscription:${sub.stripe_subscription_id}:${window.start}`,resetsAt:window.end,limit:plan.allowances.platformEmails};
}
