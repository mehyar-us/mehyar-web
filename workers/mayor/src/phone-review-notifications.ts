import type {Env} from './env';
// One notice per call/operator. No phone numbers, provider tokens, transcripts or
// customer identities are placed in notice content or email snapshots.
const unresolved=`SELECT a.id,a.tenant_id FROM mayor_telnyx_admissions a
 LEFT JOIN mayor_telnyx_terminations t ON t.admission_id=a.id
 LEFT JOIN mayor_telnyx_recovery r ON r.admission_id=a.id
 WHERE (t.state IN ('uncertain','blocked') OR r.state='review' OR r.attempts>=2)
 AND NOT EXISTS(SELECT 1 FROM mayor_telnyx_ended_calls e WHERE e.connection_id=a.connection_id AND e.call_control_id=a.call_control_id AND e.provider_confirmed=1)`;
export async function syncPhoneReviewNotifications(env:Env){
 const now=new Date().toISOString();
 const results=await env.AGENT_DB.batch([
  env.AGENT_DB.prepare(`INSERT INTO mayor_notifications(id,tenant_id,user_id,dedupe_key,kind,state,created_at,updated_at)
 SELECT lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-8'||substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6))),q.tenant_id,m.user_id,'phone_call_review:'||q.id,'phone_call_review','open',?,?
 FROM (${unresolved}) q JOIN agent_tenants b ON b.id=q.tenant_id AND b.status='active'
 JOIN agent_memberships m ON m.tenant_id=q.tenant_id AND m.status='active' AND m.role IN ('owner','manager') AND (m.expires_at IS NULL OR m.expires_at>?)
 WHERE NOT EXISTS(SELECT 1 FROM mayor_notifications n WHERE n.tenant_id=q.tenant_id AND n.user_id=m.user_id AND n.dedupe_key='phone_call_review:'||q.id)
 ORDER BY q.id,m.user_id LIMIT 100`).bind(now,now,now),
  env.AGENT_DB.prepare(`UPDATE mayor_notifications SET state='resolved',updated_at=? WHERE kind='phone_call_review' AND state='open'
 AND EXISTS(SELECT 1 FROM mayor_telnyx_admissions a JOIN mayor_telnyx_ended_calls e ON e.connection_id=a.connection_id AND e.call_control_id=a.call_control_id AND e.provider_confirmed=1 WHERE a.tenant_id=mayor_notifications.tenant_id AND 'phone_call_review:'||a.id=mayor_notifications.dedupe_key)`).bind(now),
 ]);
 return {created:results[0].meta.changes,resolved:results[1].meta.changes};
}
