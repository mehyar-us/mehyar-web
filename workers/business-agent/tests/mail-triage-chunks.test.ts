import {describe,it,expect} from 'vitest';
import {planMailTriageChunks,parseMailTriageChunk} from '../src/connectors/mail-triage-chunks';
import type {MailTriageSource} from '../src/connectors/mail-triage';
const source=(text:string):MailTriageSource=>({streamId:'s',messageId:'m',receipt:crypto.randomUUID(),provider:'google',observedAt:'2026-09-16T12:00:00.000Z',sourceMode:'incremental',projection:{version:1,text,omissions:['attachment'],trustedForInstructions:false}});
describe('complete extracted-message section planning',()=>{
  it.each(['🌍'.repeat(8000),'"'.repeat(32000),'line\n'.repeat(6000)])('covers bounded text without gaps, duplication or split code points',text=>{
    const input=source(text),plan=planMailTriageChunks(input);
    expect(plan.chunks.map(c=>c.source.projection.text).join('')).toBe(text);
    let end=0;
    for(const chunk of plan.chunks){
      expect(chunk.start).toBe(end);end=chunk.end;expect(chunk.source.projection.text).not.toMatch(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/);
      if(chunk.request)expect(chunk.request.messages.reduce((sum,m)=>sum+new TextEncoder().encode(m.content).length,0)).toBeLessThanOrEqual(9000);
    }
    expect(end).toBe(text.length);expect(plan.chunks.length).toBeLessThanOrEqual(32);expect(plan.extractionOmissions).toEqual(['attachment']);
  });
  it('preserves whitespace coverage without charging model work for empty sections',()=>{
    const plan=planMailTriageChunks(source(' '.repeat(13000)+'Hello'));
    expect(plan.chunks[0].request).toBeNull();expect(plan.analysisCredits).toBe(1);expect(plan.aggregationCreditsIncluded).toBe(false);
    expect(plan.chunks.map(c=>c.source.projection.text).join('')).toBe(' '.repeat(13000)+'Hello');
  });
  it('binds section evidence to absolute source offsets and discloses partial coverage',()=>{
    const input=source('First section. '.repeat(600)+'Book Friday'),plan=planMailTriageChunks(input),chunk=plan.chunks.at(-1)!;
    const result=parseMailTriageChunk(JSON.stringify({category:'appointment',priority:'routine',summary:'A request appears in this section.',evidence:[{excerpt:'Book Friday'}]}),chunk);
    expect(input.projection.text.slice(result.evidence[0].start,result.evidence[0].end)).toBe('Book Friday');expect(result.partial).toBe(true);
    expect(JSON.parse(chunk.request!.messages[1].content).coverage).toEqual({start:chunk.start,end:chunk.end,total:input.projection.text.length});
  });
  it('includes escaped business context in every bounded section and refuses nested planning',()=>{
    const input=source('"'.repeat(20000));input.businessContext={briefRevision:2,reviewed:true,details:'"'.repeat(2000),truncated:true};
    const plan=planMailTriageChunks(input);
    expect(plan.chunks.length).toBeGreaterThan(1);expect(plan.chunks.every(c=>c.source.businessContext?.briefRevision===2)).toBe(true);
    expect(()=>planMailTriageChunks(plan.chunks[0].source)).toThrow();
  });
});
