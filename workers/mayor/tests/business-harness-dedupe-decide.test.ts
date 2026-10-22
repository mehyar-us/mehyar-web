import {it,expect} from 'vitest';
import {deduplicateHarnessTaskDraftsDecide} from '../src/business-harness';
import type {HarnessPlan} from '../src/business-harness-schema';

const base:HarnessPlan={summary:'Review the saved facts before acting.',priorities:[{title:'Choose a practical next step',detail:'Use the recorded evidence.',sourceIds:['metrics:tasks']}],taskDrafts:[],experiments:[],gaps:[]};
const draft=(title:string)=>({title,detail:'A draft for operator review.',priority:'normal' as const,goalIds:[],skillIds:['builtin:daily-priorities'],sourceIds:['metrics:tasks']});

// Mock transport answering every noul question with the same verdict.
const mockTransport=(dup:boolean,p:number)=>async()=>{
 const answers:Record<string,any>={};
 return {raw:{model:'clef-flash',answers:new Proxy({},{get:(_t,prop)=>typeof prop==='string'?{type:'noul',noul:dup?p:1-p}:undefined}),usage:{input_tokens:10,output_tokens:0}},latencyMs:5,via:'mock'};
};
// Simpler: build answers from the wire body the mock receives.
const mockTransportFromBody=(dup:boolean,p:number)=>async(_env:any,body:any)=>{
 const answers:Record<string,any>={};
 for(const qid of Object.keys(body.questions))answers[qid]={type:'noul',noul:dup?p:1-p};
 return {raw:{model:'clef-flash',answers,usage:{input_tokens:10,output_tokens:0}},latencyMs:5,via:'mock'};
};

it('suppresses a paraphrase duplicate the word-match misses, on high-confidence auto',async()=>{
 const open=[{id:'t1',title:'Review which maintenance notes the workshop already records'}];
 const plan={...base,taskDrafts:[draft('Go over the maintenance notes the workshop keeps on file')]};
 // word-match alone keeps it (different wording):
 const {deduplicateHarnessTaskDrafts}=await import('../src/business-harness-schema');
 expect(deduplicateHarnessTaskDrafts(plan,open).plan.taskDrafts.length).toBe(1);
 const r=await deduplicateHarnessTaskDraftsDecide({},plan,open,{decideTransport:mockTransportFromBody(true,0.95)});
 expect(r.plan.taskDrafts.length).toBe(0);
 expect(r.omitted).toBe(1);
 expect(r.plan.priorities).toContainEqual(expect.objectContaining({sourceIds:['task:t1']}));
});

it('keeps drafts on low-confidence verdicts (fail closed to sync behavior)',async()=>{
 const open=[{id:'t1',title:'Review maintenance notes'}];
 const plan={...base,taskDrafts:[draft('Something entirely different about tire inventory')]};
 const r=await deduplicateHarnessTaskDraftsDecide({},plan,open,{decideTransport:mockTransportFromBody(true,0.6)});
 expect(r.plan.taskDrafts.length).toBe(1);
 expect(r.omitted).toBe(0);
});

it('falls back to the sync result when decide() is down',async()=>{
 const open=[{id:'t1',title:'Review maintenance notes'}];
 const plan={...base,taskDrafts:[draft('Review existing maintenance notes'),draft('Unrelated tire work')]};
 const down=async()=>{throw new Error('net down');};
 const r=await deduplicateHarnessTaskDraftsDecide({},plan,open,{decideTransport:down});
 // sync word-match still suppresses the overlapping one:
 expect(r.plan.taskDrafts.map(d=>d.title)).toEqual(['Unrelated tire work']);
 expect(r.omitted).toBe(1);
});

it('never un-suppresses what the sync version suppressed',async()=>{
 const open=[{id:'t1',title:'Review maintenance notes'}];
 const plan={...base,taskDrafts:[draft('Review existing maintenance notes')]};
 // decide says NOT a duplicate, but sync already suppressed -> stays suppressed.
 const r=await deduplicateHarnessTaskDraftsDecide({},plan,open,{decideTransport:mockTransportFromBody(false,0.99)});
 expect(r.plan.taskDrafts.length).toBe(0);
 expect(r.omitted).toBe(1);
});
