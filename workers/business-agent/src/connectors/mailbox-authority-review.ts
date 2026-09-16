import type {Env} from '../env';
import {credentialAuthorizationStamp} from './credentials';
type Candidate={id:string;authorization:string;user_id:string;account_id:string;authorization_revision:number;granted_scopes:string};

/** Bounded rotating review catches historical streams predating consent triggers.
 * Snapshot predicates protect a grant that changes between selection and commit. */
export async function runMailboxAuthorityReview(env:Env,clock:()=>number=Date.now) {
  const now=new Date(clock()).toISOString(),due=new Date(clock()-900000).toISOString();
  const candidates=(await env.AGENT_DB.prepare(`SELECT s.id,s.authorization,g.user_id,g.account_id,g.authorization_revision,g.granted_scopes
    FROM agent_mailbox_sync s JOIN auth_provider_grants g ON g.id=s.grant_id AND g.tenant_scope=s.tenant_id AND g.provider=s.provider
    WHERE g.status='authorized' AND s.authority_checked_at<=? AND (s.state='ready' OR s.lease_token IS NOT NULL
      OR EXISTS(SELECT 1 FROM agent_mailbox_changes c WHERE c.stream_id=s.id AND c.state='pending')
      OR EXISTS(SELECT 1 FROM agent_mailbox_consumers w WHERE w.stream_id=s.id AND (w.state='ready' OR w.lease_token IS NOT NULL)))
    ORDER BY s.authority_checked_at,s.id LIMIT 25`).bind(due).all<Candidate>()).results;
  let retired=0,checked=0,failed=0;
  for(const candidate of candidates) {
    const ids=`SELECT s.id FROM agent_mailbox_sync s JOIN auth_provider_grants g ON g.id=s.grant_id AND g.tenant_scope=s.tenant_id
      WHERE s.id=? AND s.authorization=? AND g.status='authorized' AND g.user_id=? AND g.account_id=?
      AND g.authorization_revision=? AND g.granted_scopes=?`;
    const args=[candidate.id,candidate.authorization,candidate.user_id,candidate.account_id,candidate.authorization_revision,candidate.granted_scopes];
    try {
      const stale=await credentialAuthorizationStamp(candidate)!==candidate.authorization;
      const statements=[env.AGENT_DB.prepare(`UPDATE agent_mailbox_sync SET authority_checked_at=?
        ${stale?",state='resync_required',lease_token=NULL,lease_until=NULL":''} WHERE id IN (${ids})`).bind(now,...args)];
      if(stale)statements.push(
        env.AGENT_DB.prepare(`UPDATE agent_mailbox_consumers SET state='review_required',lease_token=NULL,lease_until=NULL WHERE stream_id IN (${ids})`).bind(...args),
        env.AGENT_DB.prepare(`UPDATE agent_mailbox_changes SET state='discarded' WHERE state='pending' AND stream_id IN (${ids})`).bind(...args));
      const results=await env.AGENT_DB.batch(statements);
      if(results[0].meta.changes>0){checked++;if(stale)retired++;}
    }catch{
      failed++;
      // Malformed or temporarily failing records must not monopolize the next pass.
      try{await env.AGENT_DB.prepare(`UPDATE agent_mailbox_sync SET authority_checked_at=? WHERE id IN (${ids})`).bind(now,...args).run();}catch{}
      console.error(JSON.stringify({event:'agent_mailbox_authority_review_failed'}));
    }
  }
  return {selected:candidates.length,checked,retired,failed};
}
