import {env as testEnv} from 'cloudflare:workers';
import {beforeEach,it,expect,vi} from 'vitest';
import {runBusinessAudits,type BusinessAuditEnv,type AuditRunOptions} from '../../src/business-audit';
import {AUDIT_ANALYSIS_MODEL,AUDIT_REVIEW_MODEL} from '../../src/business-audit-schema';
import {digest} from '../../src/http';
import {auditFixtureIntake,auditFixtureDraft,auditFixtureEvidence,auditFixtureReview,auditCompletion,auditModelCompletion} from '../fixtures/business-audit';

// DP-4 pins (2026-10-23, ruling chief-of-decisions-audit-quality-scope-dps):
// per-stage artifact preservation. After a simulated full run the round-1
// draft and review must still be retrievable verbatim from
// mayor_audit_stage_artifacts even though the order row's single slots were
// overwritten by round 2 — the gap that cost exercises 2 and 9 their
// first-round texts. Preservation is append-only and flow-neutral: the
// order-row end states asserted here are the pipeline's pre-existing ones.
let env:BusinessAuditEnv,orderId:string,time:number;
const infer=vi.fn();
function options():AuditRunOptions {
 return {allowTest:true,orderId,dependencies:{now:()=>time,collect:async()=>auditFixtureEvidence(),infer:async(model,input,settings)=>{
  const output=await infer(model,input,settings);return model===AUDIT_REVIEW_MODEL&&output?.choices?{results:[{index:0,external_reference:(input.requests as any[])?.[0]?.external_reference,success:true,result:output}]}:output;
 }}};
}
async function row(){return env.AGENT_DB.prepare('SELECT * FROM mayor_audit_orders WHERE id=?').bind(orderId).first<any>();}
async function artifacts(){const result=await env.AGENT_DB.prepare('SELECT stage,artifact_kind,round,model,payload_json FROM mayor_audit_stage_artifacts WHERE order_id=? ORDER BY rowid').bind(orderId).all<any>();return result.results;}
async function seed(){
 orderId=crypto.randomUUID();const date=new Date(time).toISOString();
 await env.AGENT_DB.prepare("INSERT INTO mayor_audit_orders(id,mode,request_id,request_hash,status_token_hash,intake_json,payment_status,fulfillment_status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'queued',?,?)").bind(orderId,'test',crypto.randomUUID(),'b'.repeat(64),await digest(crypto.randomUUID()),JSON.stringify(auditFixtureIntake),'paid',date,date).run();
}
beforeEach(async()=>{env={...testEnv as unknown as BusinessAuditEnv,MAYOR_STRIPE_MODE:'test',AI:{} as Ai};time=Date.now();infer.mockReset();await seed();});
it('preserves round-1 draft and review verbatim across a full two-round run to needs_review',async()=>{
 const draft1=auditFixtureDraft();
 const draft2=auditFixtureDraft();draft2.summary.headline='Make neighborhood bicycle maintenance simpler to request';
 const review1=auditFixtureReview(false);
 const review2=auditFixtureReview(false);review2.summary='The revised draft still needs a more concrete handoff owner before the plan can be approved for delivery.';
 await runBusinessAudits(env,options());
 infer.mockResolvedValueOnce(auditModelCompletion(draft1)).mockResolvedValueOnce(auditCompletion(review1));
 await runBusinessAudits(env,{...options(),limit:2});expect((await row()).analysis_stage).toBe('revise');
 infer.mockResolvedValueOnce(auditModelCompletion(draft2)).mockResolvedValueOnce(auditCompletion(review2));
 await runBusinessAudits(env,{...options(),limit:2});
 const stored=await row();expect(stored).toMatchObject({fulfillment_status:'needs_review',analysis_error_code:'independent_review_rejected',analysis_review_count:2});
 // The single slots hold round 2 only — the pre-existing overwrite behaviour.
 expect(JSON.parse(stored.draft_json)).toEqual(draft2);expect(JSON.parse(stored.review_json).summary).toBe(review2.summary);
 const saved=await artifacts();
 expect(saved.map(a=>[a.artifact_kind,a.round])).toEqual([['evidence',0],['draft',1],['review',1],['draft',2],['review',2]]);
 // Round-1 artifacts are retrievable verbatim after the full run.
 expect(JSON.parse(saved[1].payload_json)).toEqual(draft1);expect(saved[1].model).toBe(AUDIT_ANALYSIS_MODEL);
 const savedReview1=JSON.parse(saved[2].payload_json);expect(savedReview1).toMatchObject({...review1,model:AUDIT_REVIEW_MODEL});expect(savedReview1.reviewedAt).toBe(new Date(time).toISOString());
 expect(JSON.parse(saved[3].payload_json)).toEqual(draft2);
 expect(JSON.parse(saved[4].payload_json).summary).toBe(review2.summary);
});
it('preserves the draft and the approving review on the report_ready path',async()=>{
 const draft=auditFixtureDraft();
 await runBusinessAudits(env,options());
 infer.mockResolvedValueOnce(auditModelCompletion(draft)).mockResolvedValueOnce(auditCompletion(auditFixtureReview()));
 expect((await runBusinessAudits(env,{...options(),limit:2})).ready).toBe(1);
 const saved=await artifacts();
 expect(saved.map(a=>[a.artifact_kind,a.round])).toEqual([['evidence',0],['draft',1],['review',1]]);
 expect(JSON.parse(saved[1].payload_json)).toEqual(draft);
 expect(JSON.parse(saved[2].payload_json)).toMatchObject({...auditFixtureReview(),model:AUDIT_REVIEW_MODEL});
});
