import {verifiedReportEnvelope} from '../web/audit-report.ts';

// A browser replay must fail closed on incomplete/rejected provider evidence.
// This validates a trusted local probe artifact; it never invokes a model.
export function recordedAuditPreviewEnvelope(artifact){
 const phase=Array.isArray(artifact?.phases)?artifact.phases.at(-1):null;
 if(artifact?.synthetic!==true||artifact.success!==true||typeof artifact.orderId!=='string'||!phase||phase.state?.fulfillment_status!=='report_ready'||!phase.report||!phase.review||phase.review.approved!==true)throw new Error('Recorded audit preview requires a successful synthetic-input provider probe ending in report_ready with an approved review.');
 if(!Number.isFinite(Date.parse(phase.state.report_created_at))||!Number.isFinite(Date.parse(phase.report.generatedAt))||!phase.report.analysisModel?.startsWith('@cf/')||!phase.report.reviewModel?.startsWith('@cf/')||phase.review.model!==phase.report.reviewModel)throw new Error('Recorded audit preview requires saved timestamps and matching Workers AI analysis/review model receipts.');
 const envelope={orderId:artifact.orderId,report:phase.report,review:phase.review,createdAt:phase.state.report_created_at};
 return verifiedReportEnvelope(envelope);
}
