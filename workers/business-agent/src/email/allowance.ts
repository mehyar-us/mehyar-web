import {z} from 'zod';
import type {Env} from '../env';

const allowance=z.object({period:z.string().min(1).max(256),resetsAt:z.iso.datetime(),limit:z.number().int().min(0).max(1000000)}).strict();
export type EmailAllowance=z.infer<typeof allowance>;

/** Internal capacity ledger, not an entitlement issuer or customer charge ledger.
 * Callers must resolve the current paid subscription and catalog allowance on
 * the server. Never pass a browser-supplied allowance to these methods. */
export class PlatformEmailAllowance {
  constructor(private readonly env:Env,private readonly clock:()=>number=Date.now){}
  async reserve(tenantId:string,jobId:string,input:EmailAllowance){
    const budget=allowance.parse(input),now=new Date(this.clock()).toISOString();
    if(Date.parse(budget.resetsAt)<=this.clock())return false;
    // One atomic insert checks the count. Concurrent jobs cannot both take the
    // last slot, and one immutable job cannot acquire a second period's slot.
    await this.env.AGENT_DB.prepare(`INSERT OR IGNORE INTO agent_platform_email_reservations(job_id,tenant_id,period,resets_at,state,created_at,updated_at)
      SELECT ?,?,?,?,'held',?,? WHERE EXISTS(SELECT 1 FROM agent_platform_email_outbox WHERE id=? AND tenant_id=? AND state IN ('prepared','sending','retry'))
      AND (SELECT count(*) FROM agent_platform_email_reservations WHERE tenant_id=? AND period=? AND state IN ('held','consumed'))<?`)
      .bind(jobId,tenantId,budget.period,budget.resetsAt,now,now,jobId,tenantId,tenantId,budget.period,budget.limit).run();
    return this.permits(tenantId,jobId,budget);
  }
  async permits(tenantId:string,jobId:string,input:EmailAllowance){
    const budget=allowance.parse(input);
    if(Date.parse(budget.resetsAt)<=this.clock())return false;
    const row=await this.env.AGENT_DB.prepare(`SELECT r.job_id FROM agent_platform_email_reservations r
      JOIN agent_platform_email_outbox o ON o.id=r.job_id AND o.tenant_id=r.tenant_id
      WHERE r.job_id=? AND r.tenant_id=? AND r.period=? AND r.resets_at=? AND r.state='held'
      AND o.state IN ('prepared','sending','retry')
      AND (SELECT count(*) FROM agent_platform_email_reservations WHERE tenant_id=? AND period=? AND state IN ('held','consumed'))<=?`)
      .bind(jobId,tenantId,budget.period,budget.resetsAt,tenantId,budget.period,budget.limit).first();
    return Boolean(row);
  }
  async reconcile(tenantId:string,jobId:string){
    // Acceptance consumes capacity, not evidence of delivery. Only cancellation
    // before any attempt can release automatically. Ambiguous results stay held.
    const result=await this.env.AGENT_DB.prepare(`UPDATE agent_platform_email_reservations
      SET state=CASE WHEN EXISTS(SELECT 1 FROM agent_platform_email_outbox WHERE id=? AND tenant_id=? AND state='accepted') THEN 'consumed' ELSE 'released' END,updated_at=?
      WHERE job_id=? AND tenant_id=? AND state='held' AND EXISTS(SELECT 1 FROM agent_platform_email_outbox WHERE id=? AND tenant_id=?
        AND (state='accepted' OR (state='cancelled' AND first_attempt_at IS NULL AND attempts=0)))`)
      .bind(jobId,tenantId,new Date(this.clock()).toISOString(),jobId,tenantId,jobId,tenantId).run();
    return Boolean(result.meta.changes);
  }
}
