import type {Env} from '../env';

// job_microusd must bound ALL five possible attempts plus variable fees/taxes.
// These are conservative commitments, never a claim of an actual provider bill.
const verified=`b.status='verified' AND length(trim(b.evidence_ref))>0 AND length(trim(b.verified_by))>0
  AND julianday(b.window_start)<=julianday(?) AND julianday(b.window_end)>julianday(?)
  AND julianday(b.verified_at)<=julianday(?) AND julianday(b.valid_until)>julianday(?)
  AND julianday(b.valid_until)-julianday(b.verified_at) BETWEEN 0 AND 30`;
const usage=`(SELECT COALESCE(sum(amount_microusd),0) FROM agent_email_supplier_commitments WHERE account_ref=b.account_ref AND window_start=b.window_start AND status='held')`;

export class PlatformEmailSupplierBudget {
  constructor(private readonly env:Env,private readonly clock:()=>number=Date.now){}
  async reserve(tenantId:string,jobId:string,configurationHash:string){
    const now=new Date(this.clock()).toISOString();
    await this.env.AGENT_DB.prepare(`INSERT OR IGNORE INTO agent_email_supplier_commitments(job_id,tenant_id,account_ref,window_start,window_end,amount_microusd,status,created_at)
      SELECT o.id,o.tenant_id,b.account_ref,b.window_start,b.window_end,b.job_microusd,'held',?
      FROM agent_platform_email_outbox o JOIN agent_email_supplier_routes r ON r.configuration_hash=?
      JOIN agent_email_supplier_budgets b ON b.account_ref=r.account_ref
      WHERE o.id=? AND o.tenant_id=? AND o.route_ref=? AND o.state IN ('prepared','sending','retry')
      AND ${verified} AND ${usage}+b.job_microusd<=b.limit_microusd`)
      .bind(now,configurationHash,jobId,tenantId,`resend:${configurationHash}`,now,now,now,now).run();
    return this.permits(tenantId,jobId,configurationHash);
  }
  async permits(tenantId:string,jobId:string,configurationHash:string){
    const now=new Date(this.clock()).toISOString();
    const row=await this.env.AGENT_DB.prepare(`SELECT c.job_id FROM agent_email_supplier_commitments c
      JOIN agent_platform_email_outbox o ON o.id=c.job_id AND o.tenant_id=c.tenant_id
      JOIN agent_email_supplier_routes r ON r.configuration_hash=? AND r.account_ref=c.account_ref
      JOIN agent_email_supplier_budgets b ON b.account_ref=c.account_ref
      WHERE c.job_id=? AND c.tenant_id=? AND c.status='held' AND c.window_start=b.window_start AND c.window_end=b.window_end
      AND c.amount_microusd>=b.job_microusd AND o.route_ref=? AND o.state IN ('prepared','sending','retry')
      AND ${verified} AND ${usage}<=b.limit_microusd`)
      .bind(configurationHash,jobId,tenantId,`resend:${configurationHash}`,now,now,now,now).first();
    return Boolean(row);
  }
  async reconcile(tenantId:string,jobId:string){
    // Keep accepted/rejected/ambiguous attempts committed until actual supplier
    // accounting proves a lower cost. Never assume idempotent retries are free.
    const result=await this.env.AGENT_DB.prepare(`UPDATE agent_email_supplier_commitments SET status='released'
      WHERE job_id=? AND tenant_id=? AND status='held' AND EXISTS(SELECT 1 FROM agent_platform_email_outbox
      WHERE id=? AND tenant_id=? AND state='cancelled' AND first_attempt_at IS NULL AND attempts=0)`)
      .bind(jobId,tenantId,jobId,tenantId).run();
    return Boolean(result.meta.changes);
  }
}
