import {it,expect} from 'vitest';
import {harnessPlanSchema,harnessModelPlanSchema,normalizeHarnessModelPlan,validateHarnessPlan,type HarnessModelPlan} from '../src/business-harness-schema';

const taskId='11111111-1111-4111-8111-111111111111',otherId='22222222-2222-4222-8222-222222222222',goalId='33333333-3333-4333-8333-333333333333';
const source='task:'+taskId,saved={id:taskId,title:'Review existing maintenance notes'};
const facts=(task=saved)=>({goalIds:[goalId],skillIds:['builtin:daily-priorities'],sourceIds:[source,'profile:confirmed','metrics:tasks'],openTasks:[task],canonicalNames:[task.title]});
function model():HarnessModelPlan{return {summary:'Use the saved review before preparing a distinct handoff template.',priorities:[{title:'Refine the recorded handoff',detail:'Check what the existing review covers.',sourceIds:[source]}],taskDrafts:[{workType:'reuse_existing',existingTaskId:taskId,title:'Analyze maintenance notes for handoff patterns',detail:'Review and organize the existing notes to identify fields for the handoff.',priority:'normal',goalIds:[goalId],skillIds:['builtin:daily-priorities'],sourceIds:[source,'profile:confirmed']},{workType:'new_task',existingTaskId:null,title:'Draft a maintenance handoff template',detail:'After the saved review, prepare an internal template using confirmed fields; leave missing fields unknown.',priority:'normal',goalIds:[goalId],skillIds:['builtin:daily-priorities'],sourceIds:[source]}],experiments:[],gaps:['Note contents and measured outcomes are unknown.']};}

it('reuses the recorded analysis as scoped advice while retaining a distinct template',()=>{
 const result=normalizeHarnessModelPlan(model(),facts());
 expect(result.taskDrafts.map(item=>item.title)).toEqual(['Draft a maintenance handoff template']);
 expect(result.priorities).toHaveLength(1);
 expect(result.priorities[0]).toMatchObject({title:saved.title,sourceIds:[source,'profile:confirmed']});
 expect(result.priorities[0].detail).toContain('Check what the existing review covers.');
 expect(result.priorities[0].detail).toContain('Review and organize the existing notes');
 expect(result.priorities[0].detail).toContain('Its full scope is unverified; confirm it');
 expect(harnessPlanSchema.safeParse(result).success).toBe(true);
 expect(result.taskDrafts[0]).not.toHaveProperty('workType');
 expect(result.taskDrafts[0]).not.toHaveProperty('existingTaskId');
});

it('allows reuse-only or no suggested new work without requiring a new draft',()=>{
 const reuse=model();reuse.taskDrafts.pop();expect(normalizeHarnessModelPlan(reuse,facts()).taskDrafts).toEqual([]);
 const none=model();none.taskDrafts=[];expect(normalizeHarnessModelPlan(none,facts())).toEqual(none);
});

it.each(['Review maintenance notes and draft a handoff checklist','Digitize maintenance notes','Calculate repair labor costs from maintenance notes'])('preserves a distinct explicit new task without broad synonym suppression: %s',title=>{
 const value=model();value.taskDrafts=[{...value.taskDrafts[1],title}];
 expect(normalizeHarnessModelPlan(value,facts()).taskDrafts[0].title).toBe(title);
});

it.each(['missing','foreign','closed','not_selected','missing_source'] as const)('rejects %s reuse targeting instead of guessing from its title',invalid=>{
 const value=model(),allowed=facts();
 if(invalid==='missing')value.taskDrafts[0].existingTaskId=null;
 if(invalid==='foreign')value.taskDrafts[0].existingTaskId=otherId;
 if(invalid==='closed'||invalid==='not_selected')allowed.openTasks=[];
 if(invalid==='missing_source')value.taskDrafts[0].sourceIds=['metrics:tasks'];
 expect(()=>normalizeHarnessModelPlan(value,allowed)).toThrow();
});

it.each(['goal','skill','source','completed_title','completed_detail','numerical_detail'] as const)('validates original reused %s claims before removing the item from drafts',invalid=>{
 const value=model(),item=value.taskDrafts[0];
 if(invalid==='goal')item.goalIds=[otherId];
 if(invalid==='skill')item.skillIds=['unselected'];
 if(invalid==='source')item.sourceIds=[source,'private:other'];
 if(invalid==='completed_title')item.title='Mayor already created the template.';
 if(invalid==='completed_detail')item.detail='I sent the follow-up.';
 if(invalid==='numerical_detail')item.detail='There are 54 customers.';
 expect(()=>normalizeHarnessModelPlan(value,facts())).toThrow();
});

it('rejects contradictory classification instead of treating an edit as a new task',()=>{
 const value=model();value.taskDrafts[1].existingTaskId=taskId;
 expect(harnessModelPlanSchema.safeParse(value).success).toBe(false);
});

it('fits three priorities by enriching a matching saved task without losing guidance',()=>{
 const value=model();value.priorities.push({title:'Check the profile',detail:'Use confirmed service facts.',sourceIds:['profile:confirmed']},{title:'Review counts',detail:'Measured outcomes remain unknown.',sourceIds:['metrics:tasks']});
 const result=normalizeHarnessModelPlan(value,facts());
 expect(result.priorities).toHaveLength(3);expect(result.priorities.slice(1)).toEqual(value.priorities.slice(1));
 expect(result.priorities[0].detail).toContain(value.taskDrafts[0].detail);
});

it('appends advisory reuse when there is room but rejects an unmatched full priority list',()=>{
 const value=model();value.priorities=[{title:'Review the profile',detail:'Use confirmed services.',sourceIds:['profile:confirmed']}];
 expect(normalizeHarnessModelPlan(value,facts()).priorities).toHaveLength(2);
 value.priorities.push({title:'Review counts',detail:'Outcomes are unknown.',sourceIds:['metrics:tasks']},{title:'Choose a direction',detail:'Start with a reversible step.',sourceIds:['profile:confirmed']});
 expect(()=>normalizeHarnessModelPlan(value,facts())).toThrow(/bounded priorities/);
});

it('rejects oversized advice and reference unions without trimming scope qualifiers',()=>{
 const value=model();value.priorities[0].detail='Long advice. '.repeat(40);value.taskDrafts[0].detail='Additional guidance. '.repeat(20);
 expect(()=>normalizeHarnessModelPlan(value,facts())).toThrow();
 const refs=Array.from({length:14},(_,i)=>'record:'+i),many=model();many.priorities[0].sourceIds=[source,...refs.slice(0,7)];many.taskDrafts[0].sourceIds=[source,...refs.slice(7)];
 expect(()=>normalizeHarnessModelPlan(many,{...facts(),sourceIds:[...facts().sourceIds,...refs]})).toThrow();
});

it('merges multiple suggestions for the same selected task without losing either',()=>{
 const value=model();value.taskDrafts=[value.taskDrafts[0],{...value.taskDrafts[0],detail:'Ask the operator which handoff fields need clarification.'}];
 const result=normalizeHarnessModelPlan(value,facts());expect(result.taskDrafts).toEqual([]);expect(result.priorities).toHaveLength(1);
 expect(result.priorities[0].detail).toContain(value.taskDrafts[0].detail);expect(result.priorities[0].detail).toContain(value.taskDrafts[1].detail);
});

it.each(['Review Studio54 maintenance notes','Mayor already created 54 templates','Review "Studio54" and “Auto911” notes','A'.repeat(158)+'🚲'+' review of Studio54 maintenance notes'])('keeps canonical saved-title data separate from model outcome assertions: %s',title=>{
 const task={id:taskId,title},result=normalizeHarnessModelPlan(model(),facts(task));
 expect(result.priorities[0].detail).toContain(`Existing open task “${title}”.`);
 expect(result.priorities[0].detail).toContain('full scope is unverified');
 expect(result.priorities[0].title.length).toBeLessThanOrEqual(160);
 expect(result.priorities[0].title).not.toMatch(/[\uD800-\uDBFF]…$/);
 const bad=model();bad.taskDrafts[0].detail='Mayor already created 54 templates.';
 expect(()=>normalizeHarnessModelPlan(bad,facts(task))).toThrow();
});

it('does not broaden the public schema or reinterpret legacy injected plans',()=>{
 const privateValue=model(),legacy={...privateValue,taskDrafts:privateValue.taskDrafts.map(({workType,existingTaskId,...item})=>item)};
 expect(validateHarnessPlan(legacy,facts())).toEqual(legacy);
 expect(harnessPlanSchema.safeParse(privateValue).success).toBe(false);
 expect(harnessModelPlanSchema.safeParse(legacy).success).toBe(false);
});
