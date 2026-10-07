import {expect,it} from 'vitest';
import {auditFixtureDraft,auditFixtureEvidence,auditFixtureReview} from './fixtures/business-audit';
import {reportDownloadName,reportHighlights,reportRoadmapActions,reportSourceUrl,verifiedReportEnvelope} from '../web/audit-report';
import type {AuditReportEnvelope} from '../web/audit-report';

function savedReport():AuditReportEnvelope{
 const evidence=auditFixtureEvidence();
 return {orderId:'order-123',createdAt:'2026-10-03T16:00:00Z',report:{...auditFixtureDraft(),schemaVersion:1,orderId:'order-123',businessName:'Cedar Bike Service',website:'https://cedarbikes.com/',generatedAt:'2026-10-03T15:00:00Z',analysisModel:'configured-analysis',reviewModel:'configured-review',scope:{method:'Captured public static evidence',limitations:evidence.limitations,pagesChecked:1},sources:evidence.sources},review:{...auditFixtureReview(),model:'configured-review',reviewedAt:'2026-10-03T15:30:00Z'}};
}
function mappedReport():AuditReportEnvelope{
 const value=savedReport();
 value.report.roadmap[0].deliverables=['[F01,F04] Walk through the current repair request.','[F06] Record inquiries and confirmed appointments.'];
 value.report.roadmap[1].deliverables=['[F05] Confirm the inquiry owner and backup.','[F02] Review the customer-agreed maintenance follow-up.'];
 value.report.roadmap[2].deliverables=['[F06] Review the measured baseline.','[F03] Verify public listing details with the owner.'];
 return value;
}
function legacyReport():AuditReportEnvelope{
 const value=savedReport();
 for(const phase of value.report.roadmap)phase.deliverables=phase.deliverables.map(text=>text.replace(/^\[F\d{2}(?:,F\d{2})*\] /,''));
 return value;
}
it('derives visual counts and estimated effort/impact positions from saved findings, not invented scores',()=>{
 const value=savedReport();value.report.scope.pagesChecked=99;const highlights=reportHighlights(value.report);
 expect(highlights).toMatchObject({pages:1,findings:6,priorities:{P1:2,P2:4,P3:0}});
 expect(highlights.coverage.map(item=>item.count)).toEqual([1,1,1,1,1,1]);
 expect(highlights.matrix.find(row=>row.impact==='high')!.cells.find(cell=>cell.effort==='low')!.ids).toEqual(['F01','F02']);
 expect(highlights.matrix.flatMap(row=>row.cells.flatMap(cell=>cell.ids)).sort()).toEqual(value.report.findings.map(finding=>finding.id).sort());
});
it('requires a matching saved order and approved independent review before exposing a report',()=>{
 const valid=savedReport();expect(verifiedReportEnvelope(valid)).toBe(valid);
 expect(()=>verifiedReportEnvelope({...valid,orderId:'other-order'})).toThrow();
 expect(()=>verifiedReportEnvelope({...valid,review:undefined})).toThrow();
 expect(()=>verifiedReportEnvelope({...valid,review:{...valid.review,approved:false}})).toThrow();
 expect(()=>verifiedReportEnvelope({...valid,review:{...valid.review,verification:{...valid.review.verification,citationGrounding:false}}})).toThrow();
 expect(()=>verifiedReportEnvelope({...valid,review:{...valid.review,verification:{}}})).toThrow();
 expect(()=>verifiedReportEnvelope({...valid,review:{...valid.review,issues:[{findingId:'F01',severity:'major',message:'Unresolved evidence issue',suggestedFix:'Review source grounding'}]}})).toThrow();
});
it('rejects broken citation and roadmap links and fabricated performance baselines',()=>{
 for(const edit of [
  (value:AuditReportEnvelope)=>{value.report.findings[0].citations[0].sourceId='missing';},
  (value:AuditReportEnvelope)=>{value.report.roadmap[0].findingIds=['F99'];},
  (value:AuditReportEnvelope)=>{value.report.roadmap[1].window='30_days';},
  (value:AuditReportEnvelope)=>{(value.report.findings[0].measurement as any).currentBaseline=75;},
  (value:AuditReportEnvelope)=>{value.report.findings[1].id=value.report.findings[0].id;},
 ]){const value=savedReport();edit(value);expect(()=>verifiedReportEnvelope(value)).toThrow();}
});
it('allows only plain public source protocols and produces a safe report download filename',()=>{
 expect(reportSourceUrl('https://example.test/book')).toBe('https://example.test/book');
 expect(reportSourceUrl('http://example.test/contact')).toBe('http://example.test/contact');
 for(const url of ['javascript:alert(1)','data:text/html,<script>','https://private:secret@example.test/','not-a-url'])expect(reportSourceUrl(url)).toBeNull();
 expect(reportDownloadName('Cedar Bike Service')).toBe('cedar-bike-service-mayor-audit.json');
 expect(reportDownloadName('../../<script>')).not.toMatch(/[<>\/]/);expect(reportDownloadName('')).toBe('business-mayor-audit.json');
});
it('renders explicit roadmap action bodies with canonical finding titles and existing anchors without changing saved data',()=>{
 const value=mappedReport(),original=JSON.stringify(value);
 expect(verifiedReportEnvelope(value)).toBe(value);
 const plans=reportRoadmapActions(value.report);
 expect(plans.map(plan=>plan.mode)).toEqual(['mapped','mapped','mapped']);
 expect(plans[0].actions[0]).toEqual({text:'Walk through the current repair request.',findings:[
  {id:'F01',title:'Clarify the tune-up offer',href:'#finding-F01'},
  {id:'F04',title:'Test the appointment request path',href:'#finding-F04'},
 ]});
 expect(plans[0].actions[1].findings).toEqual([{id:'F06',title:'Establish a request-to-booking baseline',href:'#finding-F06'}]);
 expect(plans.flatMap(plan=>plan.actions).every(action=>!action.text.startsWith('[F'))).toBe(true);
 expect(JSON.stringify(value)).toBe(original);
});
it('keeps legacy action prose readable and never infers per-action references from finding names or IDs in the text',()=>{
 const value=legacyReport();value.report.roadmap[0].deliverables[0]='Ask the owner to review F01 before making changes.';
 expect(verifiedReportEnvelope(value)).toBe(value);
 const plans=reportRoadmapActions(value.report);
 expect(plans.map(plan=>plan.mode)).toEqual(['legacy','legacy','legacy']);
 expect(plans[0].actions[0]).toEqual({text:'Ask the owner to review F01 before making changes.',findings:[]});
 expect(plans.flatMap(plan=>plan.actions).every(action=>action.findings.length===0)).toBe(true);
 expect(plans[0].relatedFindings.map(finding=>finding.id)).toEqual(value.report.roadmap[0].findingIds);
});
it.each([
 ['malformed comma spacing','[F01, F04] Walk through the current repair request.'],
 ['missing action separator','[F01,F04]Walk through the current repair request.'],
 ['duplicate action references','[F01,F01] Walk through the current repair request.'],
 ['empty action body','[F01,F04] '],
 ['invalid finding identifier','[F13] Walk through the current repair request.'],
 ['unknown finding identifier','[F07] Walk through the current repair request.'],
 ['mapped and legacy actions mixed','Walk through the current repair request.'],
])('rejects %s instead of rendering mapped syntax as legacy prose',(_label,deliverable)=>{
 const value=mappedReport();value.report.roadmap[0].deliverables[0]=deliverable;
 expect(()=>verifiedReportEnvelope(value)).toThrow();
 expect(()=>reportRoadmapActions(value.report)).toThrow();
});
it('rejects missing, unused and duplicate phase references and mixed roadmap modes',()=>{
 for(const edit of [
  (value:AuditReportEnvelope)=>{value.report.roadmap[0].findingIds=['F01','F04'];},
  (value:AuditReportEnvelope)=>{value.report.roadmap[0].findingIds.push('F02');},
  (value:AuditReportEnvelope)=>{value.report.roadmap[0].findingIds.push('F01');},
  (value:AuditReportEnvelope)=>{value.report.roadmap[1].deliverables=legacyReport().report.roadmap[1].deliverables;},
  (value:AuditReportEnvelope)=>{(value.report.roadmap[0].deliverables as unknown[])[0]={findingIds:['F01','F04'],text:'Walk through the current request.'};},
 ]){const value=mappedReport();edit(value);expect(()=>verifiedReportEnvelope(value)).toThrow();}
});
it('rejects a mapped finding link with an absent canonical title',()=>{
 const value=mappedReport();value.report.findings[0].title='';
 expect(()=>verifiedReportEnvelope(value)).toThrow();
});
