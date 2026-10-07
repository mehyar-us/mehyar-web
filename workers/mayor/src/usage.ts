import type {Actor,Env} from './env';
import {requireMembership,CHAT_ROLES} from './permissions';
import {billingUsageContext,reserveMonthlyUsage,type UsageEnv} from './billing/state';

// Business-pooled allowances come only from verified paid periods, never profile claims.
export async function usagePolicy(env:UsageEnv,actor:Actor){
 await requireMembership(env,actor,CHAT_ROLES);
 const context=await billingUsageContext(env,actor);
 return {turns:context.replyLimit,businessTurns:context.replyLimit,minutes:context.voiceMinuteLimit,businessMinutes:context.voiceMinuteLimit};
}
async function claim(env:Pick<Env,'AGENT_DB'>,subject:string,bucket:number,max:number){
 const row=await env.AGENT_DB.prepare(`INSERT INTO mayor_rate_limits(subject,bucket,count) VALUES(?,?,1)
 ON CONFLICT(subject,bucket) DO UPDATE SET count=count+1 WHERE count<? RETURNING count`).bind(subject,bucket,max).first<{count:number}>();
 return row?.count;
}
export async function claimUsage(env:UsageEnv,actor:Actor,kind:'turn'|'minute'|'start',now=Date.now()){
 await requireMembership(env,actor,CHAT_ROLES);
 const minute=Math.floor(now/60000),day=Math.floor(minute/1440)*1440,minuteResetAt=new Date((minute+1)*60000).toISOString();
 if(kind==='start')return {allowed:!!await claim(env,`mayor:start:${actor.userId}`,minute,6),message:'Please wait a minute before starting another voice session.',resetAt:minuteResetAt};
 if(kind==='turn'&&!await claim(env,`mayor:burst:${actor.userId}`,minute,12))return {allowed:false,replyAttemptCounted:false,message:'Let’s pause briefly. You can continue in a minute.',resetAt:minuteResetAt};
 let context=await billingUsageContext(env,actor,now),count=await reserveMonthlyUsage(env,actor,context,kind,now);
 if(count===undefined){const current=await billingUsageContext(env,actor,now);if(current.periodKey!==context.periodKey){context=current;count=await reserveMonthlyUsage(env,actor,context,kind,now);}}
 const limit=kind==='turn'?context.replyLimit:context.voiceMinuteLimit,resetAt=new Date(context.periodEnd*1000).toISOString();
 if(count===undefined)return {allowed:false,replyAttemptCounted:false,message:`Your business has used its ${context.planId==='pro'?'Pro':'Free'} ${kind==='turn'?'reply':'microphone'} allowance for this period. It resets ${resetAt}. Your saved business records remain available.`,resetAt,limit,kind,remaining:0};
 const global=await claim(env,`mayor:${kind}:platform`,day,kind==='turn'?5000:600);
 if(!global)return {allowed:false,replyAttemptCounted:true,message:'The shared service safety limit is reached for today. Your saved work remains available; please return after 00:00 UTC.',resetAt:new Date((day+1440)*60000).toISOString()};
 return {allowed:true,replyAttemptCounted:true,remaining:Math.max(0,limit-count),limit,kind,resetAt,message:''};
}

/** Reserve each next minute before its deadline, stop if renewal fails or stalls. */
export function meterVoice(renew:()=>Promise<boolean>,ended:()=>void){
 let stopped=false,minutes=1,renewal:ReturnType<typeof setTimeout>,deadline:ReturnType<typeof setTimeout>;
 const stop=()=>{stopped=true;clearTimeout(renewal);clearTimeout(deadline);};
 const end=()=>{if(!stopped){stop();ended();}};
 const schedule=()=>{
  deadline=setTimeout(end,60000);
  renewal=setTimeout(()=>{
   if(minutes>=10){return;} // Hard ten-minute call; the owner can start again.
   void Promise.resolve().then(renew).then(allowed=>{
    if(stopped)return;
    if(!allowed){end();return;}
    minutes++;clearTimeout(deadline);schedule();
   }).catch(end);
  },55000);
 };
 schedule();return stop;
}
