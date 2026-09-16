import {describe,it,expect} from 'vitest';
import {planMailTriageChunks,parseMailTriageChunk} from '../src/connectors/mail-triage-chunks';
import {validateMailTriageCoverage} from '../src/connectors/mail-triage-coverage';
import type {MailTriageSource} from '../src/connectors/mail-triage';
function fixture(){
  const source:MailTriageSource={streamId:'s',messageId:'m',receipt:crypto.randomUUID(),provider:'google',observedAt:'2026-09-16T12:00:00.000Z',sourceMode:'incremental',businessContext:{briefRevision:2,reviewed:true,details:'Reviewed salon',truncated:false},projection:{version:1,text:' '.repeat(6500)+'Please book Friday. '.repeat(400),omissions:['attachment'],trustedForInstructions:false}};
  const plan=planMailTriageChunks(source);
  const results=plan.chunks.filter(c=>c.request).map(chunk=>({...parseMailTriageChunk(JSON.stringify({category:'appointment',priority:'routine',summary:'A booking inquiry in this section.',evidence:[{excerpt:chunk.source.projection.text.trim().slice(0,20)}]}),chunk),sectionCount:plan.chunks.length}));
  return {source,results};
}
describe('whole extracted-message coverage validation',()=>{
  it('orders complete sections and accounts for whitespace without claiming a final conclusion',()=>{
    const {source,results}=fixture(),bundle=validateMailTriageCoverage(source,[...results].reverse());
    expect(bundle.extractedTextCoverageComplete).toBe(true);expect(bundle.whitespaceSections.length).toBeGreaterThan(0);
    expect(bundle.sections.map(s=>s.sectionIndex)).toEqual(results.map(s=>s.sectionIndex));
    expect(bundle.wholeMessageConclusionAvailable).toBe(false);expect(bundle.extractionOmissions).toEqual(['attachment']);
  });
  it('rejects missing and duplicate section results',()=>{
    const {source,results}=fixture();
    expect(()=>validateMailTriageCoverage(source,results.slice(1))).toThrow();
    expect(()=>validateMailTriageCoverage(source,[results[0],...results.slice(0,-1)])).toThrow();
  });
  it.each(['receipt','brief','offset','count','permission','omissions'] as const)('rejects changed %s provenance',kind=>{
    const {source,results}=fixture(),changed=structuredClone(results);
    if(kind==='receipt')changed[0].source.receipt=crypto.randomUUID();
    if(kind==='brief')changed[0].source.businessContext!.briefRevision++;
    if(kind==='offset')changed[0].evidence[0].start++;
    if(kind==='count')changed[0].sectionCount++;
    if(kind==='permission')(changed[0] as any).authorizesActions=true;
    if(kind==='omissions')changed[0].extractionOmissions=[];
    expect(()=>validateMailTriageCoverage(source,changed)).toThrow();
  });
});
