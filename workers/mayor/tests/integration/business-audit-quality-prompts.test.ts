import {env as testEnv} from 'cloudflare:workers';
import {beforeEach,it,expect,vi} from 'vitest';
import {runBusinessAudits,type BusinessAuditEnv,type AuditRunOptions} from '../../src/business-audit';
import {AUDIT_REVIEW_MODEL} from '../../src/business-audit-schema';
import {digest} from '../../src/http';
import {auditFixtureIntake,auditFixtureDraft,auditFixtureEvidence,auditFixtureReview,auditCompletion,auditModelCompletion} from '../fixtures/business-audit';

// Prompt pins for the quality-first implementation (2026-10-23, ruling
// chief-of-decisions-audit-quality-scope-dps; scope §3 DC-1..DC-7). These pin
// the drafting-side additions only: the reviewer rules, review schema,
// approval function and diagnostics net are untouched by that work, and no
// pin here asserts anything about them.
let env:BusinessAuditEnv,orderId:string,time:number;
const infer=vi.fn();
function options():AuditRunOptions {
 return {allowTest:true,orderId,dependencies:{now:()=>time,collect:async()=>auditFixtureEvidence(),infer:async(model,input,settings)=>{
  const output=await infer(model,input,settings);return model===AUDIT_REVIEW_MODEL&&output?.choices?{results:[{index:0,external_reference:(input.requests as any[])?.[0]?.external_reference,success:true,result:output}]}:output;
 }}};
}
async function row(){return env.AGENT_DB.prepare('SELECT * FROM mayor_audit_orders WHERE id=?').bind(orderId).first<any>();}
beforeEach(async()=>{
 env={...testEnv as unknown as BusinessAuditEnv,MAYOR_STRIPE_MODE:'test',AI:{} as Ai};time=Date.now();infer.mockReset();
 orderId=crypto.randomUUID();const date=new Date(time).toISOString();
 await env.AGENT_DB.prepare("INSERT INTO mayor_audit_orders(id,mode,request_id,request_hash,status_token_hash,intake_json,payment_status,fulfillment_status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'queued',?,?)").bind(orderId,'test',crypto.randomUUID(),'b'.repeat(64),await digest(crypto.randomUUID()),JSON.stringify(auditFixtureIntake),'paid',date,date).run();
});
it('carries the DC-1..DC-6 drafting rules in the analyze system text',async()=>{
 await runBusinessAudits(env,options());
 infer.mockResolvedValueOnce(auditModelCompletion(auditFixtureDraft()));await runBusinessAudits(env,options());
 const system=infer.mock.calls[0][1].requests[0].messages[0].content as string;
 // DC-1: successSignal sample-vs-pass-mark distinction.
 expect(system).toContain('must never set the value that counts as passing');
 expect(system).toContain('without a preset pass rate');
 // DC-2: copyExample behaviour promises are operational content, any verb.
 expect(system).toContain('is operational content and must be bracketed or omitted');
 expect(system).toContain('[confirmed emergency response policy]');
 // DC-3: observations hold structure/attribution/unknowns; biggestOpportunity is a verification priority.
 expect(system).toContain('is never an observation');
 expect(system).toContain('names a verification priority with its bounded observable check');
 // DC-4: roadmap gate construction + validator clause grammar.
 expect(system).toContain('must carry the gates as their own deliverables');
 expect(system).toContain('separately over finding steps and over the roadmap as a whole');
 // DC-5: one stage per action + sanctioned controlled-test vocabulary.
 expect(system).toContain('One action performs one stage');
 expect(system).toContain('staff/dummy recipient records, destination receipt, responsible reply role');
 // DC-6: whyItMatters conditional form against the public-page fact.
 expect(system).toContain('give any private-process possibility the conditional form');
});
it('carries the DC-7 enumerated sweep and verbatim preservation in the revise task',async()=>{
 await runBusinessAudits(env,options());
 infer.mockResolvedValueOnce(auditModelCompletion(auditFixtureDraft())).mockResolvedValueOnce(auditCompletion(auditFixtureReview(false)));
 await runBusinessAudits(env,{...options(),limit:2});expect((await row()).analysis_stage).toBe('revise');
 infer.mockResolvedValueOnce(auditModelCompletion(auditFixtureDraft()));await runBusinessAudits(env,options());
 const packet=JSON.parse(infer.mock.calls[2][1].requests[0].messages[1].content);
 expect(packet.task).toContain('six defect classes that survive generic repair');
 expect(packet.task).toContain('(1) Pass marks in any measurement.successSignal');
 expect(packet.task).toContain('you are its semantic backstop');
 expect(packet.task).toContain('(2) Behaviour promises in any copyExample');
 expect(packet.task).toContain('is not a reliable screen for this class');
 expect(packet.task).toContain('(4) Roadmap gate carry-through');
 expect(packet.task).toContain('never gate deliverables');
 expect(packet.task).toContain('(5) Bundled stages');
 expect(packet.task).toContain('carried over VERBATIM from the previous draft');
 // The pre-existing revise instructions stand unsoftened beside the sweep.
 expect(packet.task).toContain('Repair every actual review issue and current diagnostic at the EXACT affected field');
 expect(packet.task).toContain('Recheck EVERY acceptance item: the prior review is not exhaustive.');
});
