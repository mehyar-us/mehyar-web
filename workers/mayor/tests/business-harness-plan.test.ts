import {it,expect} from 'vitest';
import {deduplicateHarnessTaskDrafts,validateHarnessNarrative,type HarnessPlan} from '../src/business-harness-schema';

const saved={id:'saved-task',title:'Review which maintenance notes the workshop already records'};
const base:HarnessPlan={summary:'Review the saved facts before acting.',priorities:[{title:'Choose a practical next step',detail:'Use the recorded evidence.',sourceIds:['metrics:tasks']}],taskDrafts:[],experiments:[],gaps:[]};
const draft=(title:string)=>({title,detail:'A draft for operator review.',priority:'normal' as const,goalIds:[],skillIds:['builtin:daily-priorities'],sourceIds:['task:saved-task']});

it('filters the actual overlapping maintenance-note proposal while preserving a distinct template',()=>{
 const result=deduplicateHarnessTaskDrafts({...base,taskDrafts:[draft('Review existing maintenance notes'),draft('Create a maintenance handoff checklist')]},[saved]);
 expect(result.omitted).toBe(1);
 expect(result.plan.taskDrafts.map(item=>item.title)).toEqual(['Create a maintenance handoff checklist']);
 expect(result.plan.priorities).toContainEqual(expect.objectContaining({title:saved.title,sourceIds:['task:saved-task']}));
});
it('preserves a distinct added artifact even when it shares the review action and original topic',()=>{
 const title='Review maintenance notes and draft a handoff checklist';
 expect(deduplicateHarnessTaskDrafts({...base,taskDrafts:[draft(title)]},[saved]).plan.taskDrafts[0].title).toBe(title);
});
it('removes an exact saved title without duplicating an existing priority, and never compares unrelated records',()=>{
 const plan={...base,priorities:[{...base.priorities[0],sourceIds:['task:saved-task']}],taskDrafts:[draft(saved.title)]};
 expect(deduplicateHarnessTaskDrafts(plan,[saved])).toMatchObject({omitted:1,plan:{taskDrafts:[],priorities:plan.priorities}});
 expect(deduplicateHarnessTaskDrafts(plan,[])).toMatchObject({omitted:0,plan:{taskDrafts:plan.taskDrafts}});
});

it.each(['Review the service descriptions for “Studio54”.','Clarify the booking journey for "Bistro33".','Prepare a qualitative service-offer review for "Auto911".','Use the saved task “Studio54 booking-page review” to choose the next step.'])('allows an exact quoted canonical name/title without treating its digits as measures: %s',summary=>{
 expect(()=>validateHarnessNarrative({...base,summary},{canonicalNames:['Studio54','Bistro33','Auto911','Studio54 booking-page review']})).not.toThrow();
});
it.each(['“Studio54” has 54 customers.','“Bistro33” will gain 33 customers.','Review “Unknown99”.','Review Studio54.'])('does not authorize a measure or unknown/unquoted digit name from a saved literal: %s',summary=>{
 expect(()=>validateHarnessNarrative({...base,summary},{canonicalNames:['Studio54','Bistro33']})).toThrow();
});
