import type {Actor,Env} from '../env';
import {requireMembership} from '../permissions';
import {freePeriod,PLANS,type PlanId} from './plans';
import {mode} from './stripe';

export type UsageEnv=Pick<Env,'AGENT_DB'|'MAYOR_STRIPE_MODE'>;
export interface UsageContext {planId:PlanId;periodKey:string;periodStart:number;periodEnd:number;replyLimit:number;voiceMinuteLimit:number;}
export const ACTIVE_PERIOD_SQL=`SELECT p.period_key,p.period_start,p.period_end FROM mayor_billing_paid_periods p JOIN mayor_billing_subscriptions s ON s.tenant_id=p.tenant_id AND s.mode=p.mode AND s.stripe_subscription_id=p.stripe_subscription_id WHERE p.tenant_id=? AND p.mode=? AND p.invalidated=0 AND p.period_start<=? AND p.period_end>? ORDER BY p.period_start DESC LIMIT 1`;
export async function billingUsageContext(env:UsageEnv,actor:Actor,now=Date.now()):Promise<UsageContext>{
 await requireMembership(env,actor);
 const selected=mode(env),seconds=Math.floor(now/1000);
 const period=selected?await env.AGENT_DB.prepare(ACTIVE_PERIOD_SQL).bind(actor.tenantId,selected,seconds,seconds).first<{period_key:string;period_start:number;period_end:number}>():null;
 const plan=PLANS[period?1:0],free=freePeriod(now);
 const periodKey=period?.period_key??free.periodKey,credits=selected?await env.AGENT_DB.prepare('SELECT COALESCE(SUM(reply_attempts),0) AS replies,COALESCE(SUM(voice_minutes),0) AS minutes FROM mayor_billing_credit_grants WHERE tenant_id=? AND mode=? AND period_key=? AND invalidated=0 AND period_start<=? AND period_end>?').bind(actor.tenantId,selected,periodKey,seconds,seconds).first<{replies:number;minutes:number}>():null;
 return {planId:plan.id,periodKey,periodStart:period?.period_start??free.periodStart,periodEnd:period?.period_end??free.periodEnd,replyLimit:plan.replyLimit+(credits?.replies??0),voiceMinuteLimit:plan.voiceMinuteLimit+(credits?.minutes??0)};
}
export async function usageBalance(env:UsageEnv,actor:Actor,now=Date.now()){
 const context=await billingUsageContext(env,actor,now),rows=await env.AGENT_DB.prepare('SELECT kind,count FROM mayor_billing_usage_periods WHERE tenant_id=? AND period_key=?').bind(actor.tenantId,context.periodKey).all<{kind:string;count:number}>();
 const count=(kind:string)=>rows.results.find(row=>row.kind===kind)?.count??0;
 const replies=count('turn'),minutes=count('minute');return {context,usage:{periodStart:new Date(context.periodStart*1000).toISOString(),resetAt:new Date(context.periodEnd*1000).toISOString(),replies:{used:replies,limit:context.replyLimit,remaining:Math.max(0,context.replyLimit-replies)},voiceMinutes:{used:minutes,limit:context.voiceMinuteLimit,remaining:Math.max(0,context.voiceMinuteLimit-minutes)}}};
}
/** A DB guard makes an in-flight Free claim retry after an upgrade, rather than bypassing the carried allowance. */
export async function reserveMonthlyUsage(env:UsageEnv,actor:Actor,context:UsageContext,kind:'turn'|'minute',now=Date.now()){
 const seconds=Math.floor(now/1000),selected=mode(env)??'disabled',token=crypto.randomUUID(),plan=PLANS[context.planId==='pro'?1:0],baseLimit=kind==='turn'?plan.replyLimit:plan.voiceMinuteLimit;
 const active=`EXISTS(SELECT 1 FROM mayor_billing_paid_periods p JOIN mayor_billing_subscriptions s ON s.tenant_id=p.tenant_id AND s.mode=p.mode AND s.stripe_subscription_id=p.stripe_subscription_id WHERE p.tenant_id=? AND p.mode=? AND p.invalidated=0 AND p.period_start<=? AND p.period_end>?${context.planId==='pro'?' AND p.period_key=?':''})`;
 const currentPeriod=seconds>=context.periodStart&&seconds<context.periodEnd&&(context.planId==='pro'||context.periodKey===freePeriod(now).periodKey);
 const guard=`${currentPeriod?1:0}=1 AND ${context.planId==='pro'?active:`NOT ${active}`}`;
 // Recompute paid pack allowances inside the atomic claim: a stale context must not bypass a refund.
 const creditLimit=`(?+COALESCE((SELECT SUM(${kind==='turn'?'reply_attempts':'voice_minutes'}) FROM mayor_billing_credit_grants WHERE tenant_id=? AND mode=? AND period_key=? AND invalidated=0 AND period_start<=? AND period_end>?),0))`;
 const bindings=[actor.tenantId,context.periodKey,kind,token,actor.tenantId,selected,seconds,seconds,...(context.planId==='pro'?[context.periodKey]:[]),baseLimit,actor.tenantId,selected,context.periodKey,seconds,seconds];
 const reservation=env.AGENT_DB.prepare(`INSERT INTO mayor_billing_usage_periods(tenant_id,period_key,kind,count,last_claim_id) SELECT ?,?,?,1,? WHERE ${guard} ON CONFLICT(tenant_id,period_key,kind) DO UPDATE SET count=count+1,last_claim_id=excluded.last_claim_id WHERE count<${creditLimit} RETURNING count`).bind(...bindings);
 const calendar=freePeriod(now).periodKey;
 const statements=[reservation];
 // Paid activity also counts toward Free's calendar bucket, so downgrading/re-subscribing never refills Free.
 if(context.periodKey!==calendar)statements.push(env.AGENT_DB.prepare(`INSERT INTO mayor_billing_usage_periods(tenant_id,period_key,kind,count,last_claim_id) SELECT ?,?,?,1,? WHERE EXISTS(SELECT 1 FROM mayor_billing_usage_periods WHERE tenant_id=? AND period_key=? AND kind=? AND last_claim_id=?) ON CONFLICT(tenant_id,period_key,kind) DO UPDATE SET count=count+1,last_claim_id=excluded.last_claim_id`).bind(actor.tenantId,calendar,kind,token,actor.tenantId,context.periodKey,kind,token));
 const results=await env.AGENT_DB.batch<{count:number}>(statements);return results[0].results[0]?.count;
}
