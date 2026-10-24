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
 // DC-4 iteration (2026-10-23, ruling chief-of-decisions-audit-quality-v3-live-exercise
 // part (a)): permission and exclusion are structurally two separate
 // deliverables — the worked example is split and the rule forbids the
 // merged single-deliverable form outright.
 expect(system).toContain('Permission and exclusion are ALWAYS two separate deliverables');
 expect(system).toContain('"[F08] Business owner explicitly excludes declined, withdrawn, opted-out, and unverified contacts."');
 expect(system).toContain('A single deliverable that mentions both permission and exclusions is a construction error');
 // DC-5: one stage per action + sanctioned controlled-test vocabulary.
 expect(system).toContain('One action performs one stage');
 expect(system).toContain('staff/dummy recipient records, destination receipt, responsible reply role');
 // DC-6: whyItMatters conditional form against the public-page fact.
 expect(system).toContain('give any private-process possibility the conditional form');
 // Analyze-precision round (2026-10-24, ruling
 // chief-of-decisions-audit-live-terminal-dp2-next). AP-1: the offer is a
 // factual claim built only from source-enumerated services (exercise 10's
 // 'emergency repairs' case).
 expect(system).toContain('must be a service the captured sources enumerate');
 expect(system).toContain('plausibility is not evidence');
 expect(system).toContain('not bracketed, because the offer field takes no placeholders');
 // AP-2: successSignal/howToCollect pair matching, extending DC-1's
 // method/target distinction to pairs (exercise 10's F03/F08 cases).
 expect(system).toContain('are a pair and must cohere');
 expect(system).toContain('records how many asked for license or insurance verification before booking');
 expect(system).toContain('the poll yields customer answers, not confirmations or publication');
});
it('carries the DC-7 enumerated sweep and verbatim preservation in the revise task',async()=>{
 await runBusinessAudits(env,options());
 infer.mockResolvedValueOnce(auditModelCompletion(auditFixtureDraft())).mockResolvedValueOnce(auditCompletion(auditFixtureReview(false)));
 await runBusinessAudits(env,{...options(),limit:2});expect((await row()).analysis_stage).toBe('revise');
 infer.mockResolvedValueOnce(auditModelCompletion(auditFixtureDraft()));await runBusinessAudits(env,options());
 const packet=JSON.parse(infer.mock.calls[2][1].requests[0].messages[1].content);
 // Analyze-precision round (2026-10-24, ruling
 // chief-of-decisions-audit-live-terminal-dp2-next): the sweep gains classes
 // (7) and (8) for the two exercise-10 forms, and its stated count is
 // corrected six -> eight to match its list.
 expect(packet.task).toContain('eight defect classes that survive generic repair');
 expect(packet.task).toContain('(7) Offer-field enumeration');
 expect(packet.task).toContain('delete any named service no source enumerates');
 expect(packet.task).toContain('(8) Signal/method pair matching');
 expect(packet.task).toContain('restate the signal as the quantity the method actually yields');
 expect(packet.task).toContain('(1) Pass marks in any measurement.successSignal');
 expect(packet.task).toContain('you are its semantic backstop');
 expect(packet.task).toContain('(2) Behaviour promises in any copyExample');
 expect(packet.task).toContain('is not a reliable screen for this class');
 expect(packet.task).toContain('(4) Roadmap gate carry-through');
 // DC-4 iteration (2026-10-23, ruling chief-of-decisions-audit-quality-v3-live-exercise part (a)).
 expect(packet.task).toContain('never a single deliverable carrying both even as joined clauses');
 expect(packet.task).toContain('never gate deliverables');
 expect(packet.task).toContain('(5) Bundled stages');
 expect(packet.task).toContain('carried over VERBATIM from the previous draft');
 // The pre-existing revise instructions stand unsoftened beside the sweep.
 expect(packet.task).toContain('Repair every actual review issue and current diagnostic at the EXACT affected field');
 expect(packet.task).toContain('Recheck EVERY acceptance item: the prior review is not exhaustive.');
});
