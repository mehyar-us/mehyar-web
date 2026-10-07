import {describe,expect,it} from 'vitest';
import {parseAuditRoadmapDeliverable,validateAuditRoadmapReferences} from '../src/business-audit-roadmap';

const known=['F01','F02','F03','F06'];
const phase=(findingIds:string[],deliverables:string[])=>({findingIds,deliverables});

describe('audit roadmap deliverable parsing',()=>{
 it('returns explicit references and clean action text without inferring prose references',()=>{
  expect(parseAuditRoadmapDeliverable('  [F01,F06] Review the baseline log.  ')).toEqual({kind:'mapped',findingIds:['F01','F06'],text:'Review the baseline log.'});
  expect(parseAuditRoadmapDeliverable('[F12] Check the owner-approved action.')).toEqual({kind:'mapped',findingIds:['F12'],text:'Check the owner-approved action.'});
  expect(parseAuditRoadmapDeliverable('Review F06 baseline data.')).toEqual({kind:'legacy',text:'Review F06 baseline data.'});
  expect(parseAuditRoadmapDeliverable('[Owner approval] Review existing records.')).toEqual({kind:'legacy',text:'[Owner approval] Review existing records.'});
 });
 it.each(['[F01, F06] Review records.','[ F01] Review records.','[F01;F06] Review records.','[F1] Review records.','[F00] Review records.','[F13] Review records.','[f01] Review records.','[FXX] Review records.','[Fxx] Review records.','[Ffoo] Review records.','[X01] Review records.','[F01 Review records.','[F01]Review records.','[F01]  Review records.','[F01]\nReview records.','[[F01]] Review records.','(F01) Review records.','F01: Review records.','[] Review records.','[F01] [F06] Review records.','- [F01] Review records.','**[F01]** Review records.','"[F01] Review records."','`[F01]` Review records.'])('rejects attempted malformed reference prefix %s',value=>{
  expect(parseAuditRoadmapDeliverable(value)).toEqual({kind:'invalid',error:'malformed_prefix'});
 });
 it('rejects duplicate IDs rather than silently deduplicating',()=>{
  expect(parseAuditRoadmapDeliverable('[F01,F01] Review records.')).toEqual({kind:'invalid',error:'duplicate_reference'});
 });
 it.each(['',' \n ','[F01]','[F01]   '])('rejects absent action text %s',value=>{
  expect(parseAuditRoadmapDeliverable(value)).toEqual({kind:'invalid',error:'empty_text'});
 });
 it.each([null,undefined,42,{},['[F01] Review records.']])('rejects non-string action values',value=>{
  expect(parseAuditRoadmapDeliverable(value)).toEqual({kind:'invalid',error:'invalid_value'});
 });
 it('preserves action stubs as text for caller quality checks',()=>{
  expect(parseAuditRoadmapDeliverable('[F01] Deliverable 1')).toEqual({kind:'mapped',findingIds:['F01'],text:'Deliverable 1'});
  expect(parseAuditRoadmapDeliverable('Deliverable 1')).toEqual({kind:'legacy',text:'Deliverable 1'});
 });
});

describe('audit roadmap phase traceability',()=>{
 it('accepts the exact union with overlapping refs and reordered phase IDs',()=>{
  const value=[phase(['F06','F01'],['[F01,F06] Review the baseline log.','[F01] Confirm the request path.']),phase(['F02'],['[F02] Document the owner handoff.'])];
  const result=validateAuditRoadmapReferences(value,new Set(known));
  expect(result).toMatchObject({valid:true,mode:'mapped'});
  if(!result.valid)throw new Error('Expected valid mapped phases');
  expect(result.phases).toHaveLength(2);
  expect(result.phases[0]).toEqual({findingIds:['F06','F01'],deliverables:[{kind:'mapped',findingIds:['F01','F06'],text:'Review the baseline log.'},{kind:'mapped',findingIds:['F01'],text:'Confirm the request path.'}]});
 });
 it('rejects the genuine 60-day baseline finding omission',()=>{
  const value=[phase(['F01','F02','F03'],['[F01,F02] Confirm the current request and handoff path.','[F03,F06] Review collected baseline data before visibility changes.'])];
  expect(validateAuditRoadmapReferences(value,known)).toEqual({valid:false,error:'reference_union_mismatch',phaseIndex:0,missingFindingIds:['F06'],extraFindingIds:[]});
 });
 it('rejects phase IDs unrelated to any deliverable',()=>{
  expect(validateAuditRoadmapReferences([phase(['F01','F06'],['[F01] Confirm the request path.'])],known)).toEqual({valid:false,error:'reference_union_mismatch',phaseIndex:0,missingFindingIds:[],extraFindingIds:['F06']});
 });
 it('reports missing and extraneous phase IDs together',()=>{
  expect(validateAuditRoadmapReferences([phase(['F01'],['[F06] Review the baseline log.'])],known)).toMatchObject({valid:false,error:'reference_union_mismatch',missingFindingIds:['F06'],extraFindingIds:['F01']});
 });
 it('rejects a valid-pattern ID absent from the actual findings in a deliverable',()=>{
  expect(validateAuditRoadmapReferences([phase(['F01'],['[F01,F12] Review records.'])],known)).toEqual({valid:false,error:'unknown_reference',phaseIndex:0,deliverableIndex:0,findingId:'F12'});
 });
 it('rejects unknown, malformed and duplicated phase references',()=>{
  expect(validateAuditRoadmapReferences([phase(['F12'],['[F01] Review records.'])],known)).toMatchObject({valid:false,error:'unknown_reference',findingId:'F12'});
  expect(validateAuditRoadmapReferences([phase(['F99'],['[F01] Review records.'])],known)).toMatchObject({valid:false,error:'invalid_phase_reference'});
  expect(validateAuditRoadmapReferences([phase(['F01','F01'],['[F01] Review records.'])],known)).toMatchObject({valid:false,error:'duplicate_phase_reference',findingId:'F01'});
 });
 it('requires explicit legacy permission and preserves plain historical text',()=>{
  const value=[phase(['F01','F06'],['Review F06 baseline data.','Confirm the request path.'])];
  expect(validateAuditRoadmapReferences(value,known)).toMatchObject({valid:false,error:'missing_reference',phaseIndex:0,deliverableIndex:0});
  expect(validateAuditRoadmapReferences(value,known,{allowUnmappedLegacy:true})).toEqual({valid:true,mode:'legacy',phases:[{findingIds:['F01','F06'],deliverables:[{kind:'legacy',text:'Review F06 baseline data.'},{kind:'legacy',text:'Confirm the request path.'}]}]});
 });
 it('never treats mixed mapped and legacy phases as legacy repair input',()=>{
  for(const value of [[phase(['F01'],['[F01] Review records.','Confirm the request path.'])],[phase(['F01'],['[F01] Review records.']),phase(['F06'],['Review baseline data.'])]]){
   expect(validateAuditRoadmapReferences(value,known,{allowUnmappedLegacy:true})).toMatchObject({valid:false,error:'mixed_references'});
  }
 });
 it.each(['[F01, F06] Review records.','[F01,F01] Review records.','[F01]','- [F01] Review records.','**[F01]** Review records.'])('does not let legacy repair permission bypass malformed or empty mapped output %s',value=>{
  expect(validateAuditRoadmapReferences([phase(['F01'],[value])],known,{allowUnmappedLegacy:true})).toMatchObject({valid:false,error:'invalid_deliverable',phaseIndex:0,deliverableIndex:0});
 });
 it('still validates all-legacy phase references',()=>{
  expect(validateAuditRoadmapReferences([phase(['F12'],['Review baseline data.'])],known,{allowUnmappedLegacy:true})).toMatchObject({valid:false,error:'unknown_reference'});
  expect(validateAuditRoadmapReferences([phase(['F01','F01'],['Review baseline data.'])],known,{allowUnmappedLegacy:true})).toMatchObject({valid:false,error:'duplicate_phase_reference'});
 });
 it('keeps exact-union checks enabled with legacy permission',()=>{
  expect(validateAuditRoadmapReferences([phase(['F01'],['[F01,F06] Review baseline data.'])],known,{allowUnmappedLegacy:true})).toMatchObject({valid:false,error:'reference_union_mismatch',missingFindingIds:['F06']});
 });
 it('returns predictable errors for invalid collections and values',()=>{
  for(const value of [null,{},[]])expect(validateAuditRoadmapReferences(value,known)).toEqual({valid:false,error:'invalid_phases'});
  for(const value of [null,{},phase([],['Review records.']),phase(['F01'],[])])expect(validateAuditRoadmapReferences([value],known)).toEqual({valid:false,error:'invalid_phase',phaseIndex:0});
  expect(validateAuditRoadmapReferences([phase(['F01'],[42 as unknown as string])],known)).toMatchObject({valid:false,error:'invalid_deliverable',reason:'invalid_value'});
  for(const ids of [[],['F99'],['F01','F01']])expect(validateAuditRoadmapReferences([phase(['F01'],['[F01] Review records.'])],ids)).toEqual({valid:false,error:'invalid_known_findings'});
 });
 it('never mutates frozen input or infers semantic relevance from prose',()=>{
  const deliverables=Object.freeze(['[F01] Review collected baseline data.']);
  const value=Object.freeze([Object.freeze({findingIds:Object.freeze(['F01']),deliverables})]);
  expect(validateAuditRoadmapReferences(value,Object.freeze(known))).toMatchObject({valid:true,mode:'mapped'});
  expect(value[0].deliverables[0]).toBe('[F01] Review collected baseline data.');
 });
});
