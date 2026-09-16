import type {Env} from '../env';
import {digest} from '../http';
import {requirePlatformSender} from './readiness';
import {PlatformResendClient,type EmailTransport,type PlatformEmail} from './resend';

/** Bounded receipt polling for known accepted messages, not a webhook receiver.
 * The separately gated scheduler invokes this. Provider reads never resend mail. */
export async function reconcileInvitationDelivery(env:Env,tenantId:string,jobId:string,transport:EmailTransport=fetch,clock:()=>number=Date.now){
  const snapshot={...env},configuration=await requirePlatformSender(snapshot,new Date(clock())),route=`resend:${configuration.configurationHash}`;
  const row=await env.AGENT_DB.prepare(`SELECT o.provider_id,o.payload_json,o.payload_hash FROM agent_platform_email_outbox o
    JOIN agent_tenants t ON t.id=o.tenant_id WHERE o.id=? AND o.tenant_id=? AND o.route_ref=? AND o.state='accepted'
    AND o.provider_id IS NOT NULL AND t.status NOT IN ('deleted','offboarding')`)
    .bind(jobId,tenantId,route).first<{provider_id:string;payload_json:string;payload_hash:string}>();
  if(!row)return {state:'not_checked'} as const;
  const now=new Date(clock()).toISOString(),token=crypto.randomUUID();
  await env.AGENT_DB.prepare('INSERT OR IGNORE INTO agent_platform_email_delivery(job_id,tenant_id,next_check_at) VALUES (?,?,?)').bind(jobId,tenantId,now).run();
  const claimed=await env.AGENT_DB.prepare(`UPDATE agent_platform_email_delivery SET checks=checks+1,lease_token=?,lease_expires_at=?
    WHERE job_id=? AND tenant_id=? AND checks<48 AND next_check_at<=? AND (lease_expires_at IS NULL OR lease_expires_at<=?)`)
    .bind(token,new Date(clock()+60000).toISOString(),jobId,tenantId,now,now).run();
  if(!claimed.meta.changes)return {state:'not_checked'} as const;
  try{
    if(await digest(row.payload_json)!==row.payload_hash)throw new Error('email_payload_unverified');
    await requirePlatformSender(snapshot,new Date(clock()));
    const receipt=await new PlatformResendClient(snapshot.AGENT_PLATFORM_RESEND_API_KEY!,transport,clock).receipt(row.provider_id,JSON.parse(row.payload_json) as PlatformEmail);
    const delivered=Number(receipt.lastEvent==='delivered'),bounced=Number(receipt.lastEvent==='bounced'),complained=Number(receipt.lastEvent==='complained'),checkedAt=new Date(clock()).toISOString();
    // Sticky observations avoid downgrading confirmed delivery merely because
    // last_event has advanced to opened/clicked or a response is stale. A fresh
    // negative token makes suppression a one-time consequence of each new fact.
    const saved=await env.AGENT_DB.batch([
      env.AGENT_DB.prepare(`UPDATE agent_platform_email_delivery SET last_event=?,checked_at=?,
        negative_token=CASE WHEN (?=1 AND bounced_seen=0) OR (?=1 AND complained_seen=0) THEN ? ELSE NULL END,
        delivered_seen=MAX(delivered_seen,?),bounced_seen=MAX(bounced_seen,?),complained_seen=MAX(complained_seen,?),
        next_check_at=?,lease_token=NULL,lease_expires_at=NULL,last_error_code=NULL
        WHERE job_id=? AND tenant_id=? AND lease_token=? AND EXISTS(SELECT 1 FROM agent_platform_email_outbox o JOIN agent_tenants t ON t.id=o.tenant_id
          WHERE o.id=? AND o.tenant_id=? AND o.route_ref=? AND o.provider_id=? AND o.payload_hash=? AND o.state='accepted' AND t.status NOT IN ('deleted','offboarding'))`)
        .bind(receipt.lastEvent,checkedAt,bounced,complained,token,delivered,bounced,complained,new Date(clock()+3600000).toISOString(),jobId,tenantId,token,jobId,tenantId,route,row.provider_id,row.payload_hash),
      env.AGENT_DB.prepare(`INSERT INTO agent_platform_email_suppressions(recipient,scope_key,reason,status,evidence_ref,recorded_by,created_at,updated_at)
        SELECT lower(trim(o.recipient)),'*',CASE WHEN d.last_event='complained' THEN 'complaint' ELSE 'hard_bounce' END,'active',
          'resend-receipt:'||o.id||':'||d.last_event,'verified-provider-receipt',?,?
        FROM agent_platform_email_delivery d JOIN agent_platform_email_outbox o ON o.id=d.job_id AND o.tenant_id=d.tenant_id
        WHERE d.job_id=? AND d.tenant_id=? AND d.negative_token=? AND d.last_event IN ('bounced','complained')
        ON CONFLICT(recipient,scope_key) DO UPDATE SET reason=excluded.reason,status='active',evidence_ref=excluded.evidence_ref,recorded_by=excluded.recorded_by,updated_at=excluded.updated_at`)
        .bind(checkedAt,checkedAt,jobId,tenantId,token),
    ]);
    return {state:saved[0].meta.changes?'recorded':'unrecorded'} as const;
  }catch{
    await env.AGENT_DB.prepare(`UPDATE agent_platform_email_delivery SET last_error_code='email_receipt_unverified',next_check_at=?,lease_token=NULL,lease_expires_at=NULL
      WHERE job_id=? AND tenant_id=? AND lease_token=?`)
      .bind(new Date(clock()+900000).toISOString(),jobId,tenantId,token).run();
    return {state:'unverified'} as const;
  }
}
