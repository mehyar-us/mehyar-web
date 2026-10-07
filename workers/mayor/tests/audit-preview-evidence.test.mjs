import {test} from 'node:test';
import assert from 'node:assert/strict';
import {recordedAuditPreviewEnvelope} from './audit-preview-evidence.mjs';
import {auditFixtureDraft,auditFixtureEvidence,auditFixtureReview} from './fixtures/business-audit.ts';

// Validator fixtures only. These artifacts are never used to start recorded mode.
function validatorArtifact(){
 const orderId='validator-fixture-order',date='2026-10-03T16:00:00.000Z',model='@cf/synthetic-validator-fixture/model',evidence=auditFixtureEvidence();
 const report={...auditFixtureDraft(),schemaVersion:1,orderId,businessName:'Synthetic validator fixture',website:'https://example.com/',generatedAt:date,analysisModel:model,reviewModel:model,scope:{method:'Synthetic validator test only',limitations:evidence.limitations,pagesChecked:evidence.sources.length},sources:evidence.sources};
 const review={...auditFixtureReview(),model,reviewedAt:date};
 return {synthetic:true,success:true,orderId,phases:[{state:{fulfillment_status:'in_review'}},{state:{fulfillment_status:'report_ready',report_created_at:date},report,review}]};
}
test('maps the exact saved envelope without changing report, review or timestamps',()=>{
 const artifact=validatorArtifact(),phase=artifact.phases.at(-1),envelope=recordedAuditPreviewEnvelope(artifact);
 assert.equal(envelope.report,phase.report);assert.equal(envelope.review,phase.review);
 assert.equal(envelope.orderId,artifact.orderId);assert.equal(envelope.createdAt,phase.state.report_created_at);
});
for(const kind of ['incomplete','failed_probe','not_synthetic','unapproved','truthy_string_approval','numeric_approval','object_approval','major_issue','failed_grounding','wrong_order','invalid_timestamp','synthetic_model','mismatched_review_model','stale_ready_phase'])test(`rejects ${kind} audit evidence before a preview server can listen`,()=>{
 const artifact=validatorArtifact(),phase=artifact.phases.at(-1);
 if(kind==='incomplete')phase.state.fulfillment_status='in_review';
 if(kind==='failed_probe')artifact.success=false;
 if(kind==='not_synthetic')artifact.synthetic=false;
 if(kind==='unapproved')phase.review.approved=false;
 if(kind==='truthy_string_approval')phase.review.approved='false';
 if(kind==='numeric_approval')phase.review.approved=1;
 if(kind==='object_approval')phase.review.approved={approved:true};
 if(kind==='major_issue')phase.review.issues=[{findingId:null,severity:'major',message:'Fixture issue',suggestedFix:'Fixture fix'}];
 if(kind==='failed_grounding')phase.review.verification.citationGrounding=false;
 if(kind==='wrong_order')phase.report.orderId='different-order';
 if(kind==='invalid_timestamp')phase.state.report_created_at='not a saved date';
 if(kind==='synthetic_model')phase.report.analysisModel='synthetic fixture; no model invoked';
 if(kind==='mismatched_review_model')phase.review.model='@cf/different/model';
 if(kind==='stale_ready_phase')artifact.phases.push({state:{fulfillment_status:'needs_review'}});
 assert.throws(()=>recordedAuditPreviewEnvelope(artifact));
});
