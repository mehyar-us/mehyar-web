import {z} from 'zod';
import type {Env} from '../env';
import {digest,HttpError,json} from '../http';
import {requirePlatformSender} from './readiness';
import {readEmailWebhookBody,verifyEmailWebhook} from './webhook-signature';

export async function handleEmailWebhook(request:Request,env:Env,clock:()=>number=Date.now){
  if(request.method!=='POST')throw new HttpError(405,'method_not_allowed','Use POST for email events.');
  if(env.AGENT_PLATFORM_EMAIL_WEBHOOK_ENABLED!=='true')throw new HttpError(503,'email_webhook_disabled','Email event intake is not enabled.');
  if(!env.AGENT_PLATFORM_EMAIL_WEBHOOK_SECRET)throw new HttpError(503,'email_webhook_unconfigured','Email event verification is not configured.');
  const raw=await readEmailWebhookBody(request),id=await verifyEmailWebhook(raw,request.headers,env.AGENT_PLATFORM_EMAIL_WEBHOOK_SECRET,clock());
  let parsed:unknown;try{parsed=JSON.parse(raw);}catch{throw new HttpError(400,'invalid_email_webhook','Email event could not be read.');}
  const type=z.object({type:z.string().max(80)}).parse(parsed).type;
  if(!['email.delivered','email.bounced','email.complained'].includes(type))return json({received:true},202);
  const event=z.object({created_at:z.iso.datetime(),data:z.object({email_id:z.uuid()})}).parse(parsed);
  if(Date.parse(event.created_at)>clock()+300000)throw new HttpError(400,'invalid_email_webhook','Email event time could not be verified.');
  const configuration=await requirePlatformSender(env,new Date(clock())),hash=await digest(raw),route=`resend:${configuration.configurationHash}`,now=new Date(clock()).toISOString();
  await env.AGENT_DB.prepare("INSERT OR IGNORE INTO agent_platform_email_events(event_id,payload_hash,route_ref,provider_id,event_type,state,received_at,next_attempt_at) VALUES (?,?,?,?,?,'pending',?,?)")
    .bind(id,hash,route,event.data.email_id,type,now,now).run();
  const saved=await env.AGENT_DB.prepare('SELECT payload_hash,route_ref FROM agent_platform_email_events WHERE event_id=?').bind(id).first<{payload_hash:string;route_ref:string}>();
  if(!saved||saved.payload_hash!==hash||saved.route_ref!==route)throw new HttpError(409,'email_webhook_conflict','Email event identity requires review.');
  return json({received:true},202);
}

/** Notifications only wake a full receipt read. They never assert delivery or
 * suppression directly, and can arrive before provider acceptance is saved. */
export async function linkEmailWebhookHints(env:Env,route:string,clock:()=>number=Date.now){
  const now=new Date(clock()).toISOString(),events=await env.AGENT_DB.prepare("SELECT event_id,provider_id,attempts,next_attempt_at FROM agent_platform_email_events WHERE route_ref=? AND state='pending' AND next_attempt_at<=? ORDER BY next_attempt_at,event_id LIMIT 5")
    .bind(route,now).all<{event_id:string;provider_id:string;attempts:number;next_attempt_at:string}>();
  for(const event of events.results){
    const jobs=await env.AGENT_DB.prepare("SELECT o.id,o.tenant_id FROM agent_platform_email_outbox o JOIN agent_tenants t ON t.id=o.tenant_id WHERE o.route_ref=? AND o.provider_id=? AND o.state='accepted' AND t.status NOT IN ('deleted','offboarding') LIMIT 2")
      .bind(route,event.provider_id).all<{id:string;tenant_id:string}>();
    if(jobs.results.length!==1){
      await env.AGENT_DB.prepare("UPDATE agent_platform_email_events SET attempts=attempts+1,state=CASE WHEN attempts>=47 OR ?=1 THEN 'review_required' ELSE 'pending' END,next_attempt_at=? WHERE event_id=? AND state='pending' AND next_attempt_at=?")
        .bind(Number(jobs.results.length>1),new Date(clock()+3600000).toISOString(),event.event_id,event.next_attempt_at).run();continue;
    }
    const job=jobs.results[0],token=crypto.randomUUID();
    await env.AGENT_DB.batch([
      env.AGENT_DB.prepare("UPDATE agent_platform_email_events SET state='linked',processing_token=?,attempts=attempts+1 WHERE event_id=? AND state='pending'").bind(token,event.event_id),
      env.AGENT_DB.prepare(`INSERT INTO agent_platform_email_delivery(job_id,tenant_id,next_check_at)
        SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM agent_platform_email_events WHERE event_id=? AND processing_token=?)
        ON CONFLICT(job_id) DO UPDATE SET next_check_at=MIN(agent_platform_email_delivery.next_check_at,excluded.next_check_at),checks=MIN(agent_platform_email_delivery.checks,47)`)
        .bind(job.id,job.tenant_id,now,event.event_id,token),
    ]);
  }
}
