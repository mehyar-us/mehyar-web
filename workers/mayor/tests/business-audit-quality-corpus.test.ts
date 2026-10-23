import {describe,it,expect} from 'vitest';
import {auditDraftQualityDiagnostics} from '../src/business-audit-schema';
import {auditCorpusEx2Draft,auditCorpusEx2Evidence,auditCorpusEx5Draft,auditCorpusEx5Evidence,auditCorpusEx9Draft,auditCorpusEx9Evidence} from './fixtures/business-audit-corpus';

// V-1 fixture pinning (quality-first scope §7, 2026-10-23): the §1.5
// diagnostics recompute over the preserved judged drafts is the permanent
// baseline for the server net. The net itself is OUT of scope for quality
// work (any diagnostic blocks delivery even on reviewer approval, so a
// detector change is an approval-bar change); these pins exist so a future
// desk-ruled net change shows its delta against judged drafts, and so the
// quality-first implementation's before-state stays reproducible.
describe('judged-corpus diagnostics baseline (scope §1.5)',()=>{
 it('exercise 5 draft #1 carries exactly the 6 recorded diagnostics',()=>{
  expect(auditDraftQualityDiagnostics(auditCorpusEx5Draft as never,auditCorpusEx5Evidence as never)).toEqual([
   {code:'unsupported_scope_claim',path:'findings.F05.whyItMatters'},
   {code:'customer_pilot_unverified',path:'findings.F05.nextSteps.2'},
   {code:'customer_permission_unverified',path:'roadmap.customerOutreach.6'},
   {code:'unsupported_measurement_target',path:'findings.F01.measurement.successSignal'},
   {code:'unsupported_copy_promise',path:'findings.F02.copyExample'},
   {code:'unsupported_measurement_target',path:'findings.F03.measurement.successSignal'},
  ]);
 });
 it('exercise 2 revised draft carries exactly the 3 recorded diagnostics',()=>{
  expect(auditDraftQualityDiagnostics(auditCorpusEx2Draft as never,auditCorpusEx2Evidence as never)).toEqual(expect.arrayContaining([
   {code:'unsupported_scope_claim',path:'summary.biggestOpportunity'},
   {code:'customer_permission_unverified',path:'findings.F04.nextSteps.0'},
   {code:'unsupported_copy_promise',path:'findings.F02.copyExample'},
  ]));
  expect(auditDraftQualityDiagnostics(auditCorpusEx2Draft as never,auditCorpusEx2Evidence as never)).toHaveLength(3);
 });
 it('exercise 9 revised draft carries exactly the 1 recorded diagnostic',()=>{
  expect(auditDraftQualityDiagnostics(auditCorpusEx9Draft as never,auditCorpusEx9Evidence as never)).toEqual([
   {code:'customer_permission_unverified',path:'roadmap.customerOutreach.11'},
  ]);
 });
});
