import type {Env} from '../env';

// Pausing a tenant is reversible and must not discard its pending work.
const invalid=`EXISTS(SELECT 1 FROM auth_provider_grants g JOIN agent_tenants t ON t.id=g.tenant_scope
  WHERE g.id=s.grant_id AND g.tenant_scope=s.tenant_id AND (
    g.status!='authorized' OR t.status IN ('offboarding','deleted') OR NOT EXISTS(
      SELECT 1 FROM agent_memberships m WHERE m.tenant_id=s.tenant_id AND m.user_id=g.user_id
      AND m.status='active' AND m.role IN ('owner','manager') AND (m.expires_at IS NULL OR m.expires_at>?))))`;

/** Local authorization cleanup, even while provider execution is disabled.
 * Each transaction rechecks withdrawal; restored authority cannot be discarded
 * using an earlier selection. No tokens, provider requests or message deletion. */
export async function runMailboxMaintenance(env:Env,clock:()=>number=Date.now) {
  const now=new Date(clock()).toISOString();
  const candidates=(await env.AGENT_DB.prepare(`SELECT s.id FROM agent_mailbox_sync s WHERE ${invalid} AND (
    s.state='ready' OR s.lease_token IS NOT NULL OR
    EXISTS(SELECT 1 FROM agent_mailbox_changes c WHERE c.stream_id=s.id AND c.state='pending') OR
    EXISTS(SELECT 1 FROM agent_mailbox_consumers w WHERE w.stream_id=s.id AND (w.state='ready' OR w.lease_token IS NOT NULL)))
    ORDER BY s.updated_at,s.id LIMIT 25`).bind(now).all<{id:string}>()).results;
  let retired=0,failed=0;
  for(const candidate of candidates) {
    const ids=`SELECT s.id FROM agent_mailbox_sync s WHERE s.id=? AND ${invalid}`;
    try {
      const results=await env.AGENT_DB.batch([
        env.AGENT_DB.prepare(`UPDATE agent_mailbox_sync SET state='resync_required',lease_token=NULL,lease_until=NULL WHERE id IN (${ids})`).bind(candidate.id,now),
        env.AGENT_DB.prepare(`UPDATE agent_mailbox_consumers SET state='review_required',lease_token=NULL,lease_until=NULL WHERE stream_id IN (${ids})`).bind(candidate.id,now),
        env.AGENT_DB.prepare(`UPDATE agent_mailbox_changes SET state='discarded' WHERE state='pending' AND stream_id IN (${ids})`).bind(candidate.id,now),
      ]);
      if(results[0].meta.changes>0)retired++;
    }catch{failed++;console.error(JSON.stringify({event:'agent_mailbox_retirement_unavailable'}));}
  }
  return {selected:candidates.length,retired,failed};
}
