import {z} from 'zod';
import {checkScheduleSchema} from './check-schedule';
import {BUSINESS_ROUTINE_CATALOG} from './business-routine-catalog';

export const HARNESS_TOOLS=['profile','tasks','customers','bookings','goals','connector_status','gmail_unread','calendar_openings'] as const;
export type HarnessTool=typeof HARNESS_TOOLS[number];
const localTools:HarnessTool[]=['profile','tasks','customers','bookings','goals','connector_status'];
export const HARNESS_BUILTINS=BUSINESS_ROUTINE_CATALOG.map(item=>({id:`builtin:${item.id}`,title:item.title,description:item.description,instructions:item.assistantPrompt,steps:[...item.steps],allowedTools:[...localTools]}));
const instant=z.iso.datetime({offset:true}).transform(value=>new Date(value).toISOString());
export const harnessMetricSchema=z.object({baseline:z.number().finite().min(-1e12).max(1e12),current:z.number().finite().min(-1e12).max(1e12),target:z.number().finite().min(-1e12).max(1e12),unit:z.string().trim().min(1).max(40)}).strict().refine(value=>value.target!==value.baseline,'Choose a target different from the baseline.');
export const harnessGoalSchema=z.object({id:z.uuid().optional(),revision:z.number().int().min(0),title:z.string().trim().min(1).max(160),description:z.string().trim().max(2000),metric:harnessMetricSchema.nullable().optional(),deadline:instant.nullable().optional(),archived:z.boolean().default(false)}).strict();
export const harnessSkillSchema=z.object({id:z.uuid().optional(),revision:z.number().int().min(0),title:z.string().trim().min(1).max(160),instructions:z.string().trim().min(1).max(2000),allowedTools:z.array(z.enum(HARNESS_TOOLS)).min(1).max(8).refine(value=>new Set(value).size===value.length),archived:z.boolean().default(false)}).strict();
export const harnessConfigSchema=z.object({revision:z.number().int().min(0),enabled:z.boolean(),goalIds:z.array(z.uuid()).max(8).refine(value=>new Set(value).size===value.length),skillIds:z.array(z.string().min(1).max(100)).min(1).max(8).refine(value=>new Set(value).size===value.length),schedule:checkScheduleSchema.nullable().optional(),connectorOptions:z.object({gmailGrantId:z.uuid().optional(),calendar:z.object({appointmentType:z.string().trim().min(1).max(160),staff:z.string().trim().min(1).max(160).optional()}).strict().optional()}).strict().default({})}).strict().refine(value=>!value.enabled||Boolean(value.schedule),'Choose a schedule before enabling agent runs.');
export const harnessTaskSchema=z.object({runId:z.uuid(),draftId:z.string().regex(/^draft-[1-6]$/),title:z.string().trim().min(1).max(200),priority:z.enum(['low','normal','high']),dueAt:instant.nullable(),customerId:z.uuid().nullable()}).strict();
export const harnessIdentitySchema=z.object({revision:z.number().int().min(0),mission:z.string().trim().max(1200),tone:z.enum(['warm','professional','direct']),principles:z.array(z.string().trim().min(1).max(240)).max(6),workingStyle:z.string().trim().max(800)}).strict();
const references={goalIds:z.array(z.uuid()).max(8),skillIds:z.array(z.string().max(100)).min(1).max(8),sourceIds:z.array(z.string().max(120)).min(1).max(8)};
export const harnessPlanSchema=z.object({summary:z.string().trim().min(1).max(600),priorities:z.array(z.object({title:z.string().trim().min(1).max(160),detail:z.string().trim().min(1).max(600),sourceIds:references.sourceIds}).strict()).min(1).max(3),taskDrafts:z.array(z.object({title:z.string().trim().min(1).max(200),detail:z.string().trim().min(1).max(600),priority:z.enum(['low','normal','high']),...references}).strict()).max(6),experiments:z.array(z.object({title:z.string().trim().min(1).max(160),hypothesis:z.string().trim().min(1).max(600),measure:z.string().trim().min(1).max(300),...references}).strict()).max(3),gaps:z.array(z.string().trim().min(1).max(300)).max(6)}).strict();
export type HarnessPlan=z.infer<typeof harnessPlanSchema>;
/** Native inference only. Stored reports and injected legacy plans keep harnessPlanSchema. */
export const harnessModelPlanSchema=harnessPlanSchema.extend({taskDrafts:z.array(harnessPlanSchema.shape.taskDrafts.element.extend({workType:z.enum(['new_task','reuse_existing']),existingTaskId:z.uuid().nullable()}).strict().refine(item=>item.workType==='reuse_existing'?item.existingTaskId!==null:item.existingTaskId===null,'Reuse requires a selected task ID; a new task must not target an existing task.')).max(6)}).strict();
export type HarnessModelPlan=z.infer<typeof harnessModelPlanSchema>;
export type HarnessGoalInput=z.infer<typeof harnessGoalSchema>;
export type HarnessSkillInput=z.infer<typeof harnessSkillSchema>;
export type HarnessConfigInput=z.infer<typeof harnessConfigSchema>;
export type HarnessTaskInput=z.infer<typeof harnessTaskSchema>;
const taskStopWords=new Set(['a','an','the','and','or','to','for','of','in','on','with','from','at','by','as','is','are','which','what','your','our','my','their','already','existing','current','saved','one','next','new']);
const taskActionGroups=[['review','check','inspect','examine','assess','audit'],['prepare','draft','write','document','build','create','design'],['call','phone'],['contact','message','email'],['schedule','book']];
function taskWords(title:string){return [...new Set(title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').split(/\s+/).filter(word=>word&&!taskStopWords.has(word)).map(word=>word.length>4&&word.endsWith('ing')?word.slice(0,-3):word.length>4&&word.endsWith('ed')?word.slice(0,-2):word.length>3&&word.endsWith('s')&&!word.endsWith('ss')?word.slice(0,-1):word))];}
/** Conservatively suppress another draft of selected open work; preserve distinct artifacts/actions. */
export function deduplicateHarnessTaskDrafts(plan:HarnessPlan,openTasks:{id:string;title:string}[]){
 let omitted=0;const priorities=[...plan.priorities];
 const taskDrafts=plan.taskDrafts.filter(draft=>{
  const draftWords=taskWords(draft.title),draftActions=taskActionGroups.filter(group=>draftWords.some(word=>group.includes(word)));
  const duplicate=openTasks.find(task=>{
   const existingWords=taskWords(task.title),shared=draftWords.filter(word=>existingWords.includes(word)),sameAction=draftActions.some(group=>existingWords.some(word=>group.includes(word))),nouns=shared.filter(word=>!taskActionGroups.some(group=>group.includes(word)));
   return draft.title.trim().toLowerCase()===task.title.trim().toLowerCase()||sameAction&&nouns.length>=2&&shared.length/draftWords.length>=0.8;
  });
  if(!duplicate)return true;
  omitted++;const source=`task:${duplicate.id}`;
  if(priorities.length<3&&!priorities.some(priority=>priority.sourceIds.includes(source)))priorities.push({title:duplicate.title.length>160?duplicate.title.slice(0,159)+'…':duplicate.title,detail:`Already open: “${duplicate.title}”. Review the saved task instead of creating another copy.`,sourceIds:[source]});
  return false;
 });
 return {plan:{...plan,priorities,taskDrafts},omitted};
}
export function harnessGoalProgress(metric:z.infer<typeof harnessMetricSchema>|null){return metric?Math.max(0,Math.min(1,(metric.current-metric.baseline)/(metric.target-metric.baseline))):null;}
type NarrativeFacts={metrics?:{key:string;value:number|null}[];manualMetrics?:{baseline:number;current:number;target:number;unit:string}[];dates?:string[];canonicalNames?:string[]};
type PlanFacts={goalIds:string[];skillIds:string[];sourceIds:string[]}&NarrativeFacts;
/** Validate every model claim before routing reused work into read-only advice. */
export function normalizeHarnessModelPlan(raw:unknown,allowed:PlanFacts&{openTasks:{id:string;title:string}[]}):HarnessPlan{
 const model=harnessModelPlanSchema.parse(raw),original=validateHarnessPlan({...model,taskDrafts:model.taskDrafts.map(({workType,existingTaskId,...draft})=>draft)},allowed);
 const reused=new Map<string,{task:{id:string;title:string};items:HarnessModelPlan['taskDrafts']}>();
 for(const item of model.taskDrafts){
  if(item.workType!=='reuse_existing')continue;
  const task=allowed.openTasks.find(task=>task.id===item.existingTaskId);
  if(!task||!item.sourceIds.includes(`task:${task.id}`))throw new Error('Reuse requires the exact selected open task and its source reference.');
  const group=reused.get(task.id)??{task,items:[]};group.items.push(item);reused.set(task.id,group);
 }
 const priorities=original.priorities.map(item=>({...item,sourceIds:[...item.sourceIds]}));
 for(const {task,items} of reused.values()){
  const source=`task:${task.id}`,index=priorities.findIndex(item=>item.sourceIds.includes(source)),prior=index<0?undefined:priorities[index];
  if(!prior&&priorities.length===3)throw new Error('Existing-task advice does not fit the bounded priorities. Include it in a matching priority.');
  const advice=[...new Set([...(prior?[prior.detail]:[]),...items.map(item=>item.detail)])],sourceIds=[...new Set([...(prior?.sourceIds??[]),...items.flatMap(item=>item.sourceIds),source])];
  let title=task.title;if(title.length>160){title=title.slice(0,159);if(/[\uD800-\uDBFF]$/.test(title))title=title.slice(0,-1);title+='…';}
  // The quoted title is server-selected data, not a new model assertion. All original
  // model text was checked above, including items removed from new-task drafts.
  const priority={title,detail:`Existing open task “${task.title}”. ${advice.join(' ')} Its full scope is unverified; confirm it before adding overlapping work.`,sourceIds};
  if(index<0)priorities.push(priority);else priorities[index]=priority;
 }
 // Structural bounds reject oversized merges; never truncate advice/qualifiers or
 // reinterpret a canonical title's digits/action words as fabricated model outcomes.
 return harnessPlanSchema.parse({...original,priorities,taskDrafts:original.taskDrafts.filter((_item,index)=>model.taskDrafts[index].workType==='new_task')});
}
const numberWords:Record<string,number>={zero:0,one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,eleven:11,twelve:12,thirteen:13,fourteen:14,fifteen:15,sixteen:16,seventeen:17,eighteen:18,nineteen:19,twenty:20};
const metricUnits:Record<string,string[]>={open_tasks:['open tasks'],overdue_tasks:['overdue tasks'],pending_callbacks:['pending callback requests'],saved_customers:['saved customer records'],customers_with_contact:['records with a contact field'],bookings_next_7_days:['confirmed Mayor bookings'],gmail_unread_returned:['unread headers returned','unread subject headers returned']};
const escapePattern=(value:string)=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
/** Only category-matched saved counts, explicitly manual goal values and actual dates may be repeated. */
export function validateHarnessNarrative(plan:HarnessPlan,facts:NarrativeFacts={}){
 const texts=[plan.summary,...plan.priorities.flatMap(item=>[item.title,item.detail]),...plan.taskDrafts.flatMap(item=>[item.title,item.detail]),...plan.experiments.flatMap(item=>[item.title,item.hypothesis,item.measure]),...plan.gaps];
 for(const original of texts){
  const quoted=original.replace(/"([^"\n]{1,240})"|“([^”\n]{1,240})”/g,(match,straight:string,curly:string)=>(facts.canonicalNames??[]).includes(straight??curly)?'quoted saved name':match);
  // Written quantities adjacent to business measures get the same checks as digit quantities.
  let text=quoted.replace(/\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\s+(?=(?:open |overdue |pending |saved |paying |repeat |confirmed |unread )?(?:tasks?|customers?|clients?|records?|callbacks?|bookings?|visitors?|sales|reviews?|ratings?|leads?|percent|dollars?))/gi,(_match,word:string)=>`${numberWords[word.toLowerCase()]} `);
  // A real count cannot establish completion, consent or a future result. Check either word order.
  for(const sentence of text.split(/(?<=[.!?])\s+/))if(/\d/.test(sentence)&&/\b(?:completed|finished|converted|contacted|sent|published|posted|charged|paid|generated|grew|increased|decreased|opted[ -]in|consented|consent|permission|will|would|guarantee(?:d)?|expected|projected|predicted|gain|increase|improve|grow|boost|raise|reduce|double|triple|convert|retain)\b/i.test(sentence))throw new Error('A recorded quantity cannot establish a completed, predicted or consented outcome.');
  if(/\b(?:will|guarantee(?:d)?|expected|projected|predicted)\b[^.!?]{0,100}\b(?:increase|improve|grow|boost|raise|reduce|double|triple|generate|deliver|reach|gain|save|convert|retain)\b[^.!?]{0,100}(?:\d|\b(?:one|two|three|four|five|six|seven|eight|nine|ten|twenty)\b)/i.test(text))throw new Error('Unsupported quantified outcome prediction.');
  for(const date of facts.dates??[]){for(const exact of [date,date.slice(0,10)])text=text.replace(new RegExp(escapePattern(exact),'g'),' ');}
  for(const [key,units] of Object.entries(metricUnits)){
   const value=facts.metrics?.find(metric=>metric.key===key)?.value;if(value===undefined||value===null)continue;
   for(const unit of units)text=text.replace(new RegExp(`(?<![\\w.$£€+-])${escapePattern(String(value))}\\s+${escapePattern(unit)}\\b`,'gi'),' ');
  }
  // Manual provenance must be present in the same sentence, with the exact selected metric unit.
  text=text.split(/(?<=[.!?])\s+/).map(sentence=>{
   if(!/\b(?:manual(?:ly)?|owner[- ]entered)\b/i.test(sentence))return sentence;
   for(const metric of facts.manualMetrics??[])for(const value of [metric.baseline,metric.current,metric.target])sentence=sentence.replace(new RegExp(`(?<![\\w.$£€])${escapePattern(String(value))}\\s*${escapePattern(metric.unit)}(?=\\s|[.,;!?]|$)`,'gi'),' ');
   return sentence;
  }).join(' ');
  if(/\d/.test(text))throw new Error('Unsupported numerical narrative. Use canonical saved measures or qualitative draft recommendations.');
 }
}
export function validateHarnessPlan(raw:unknown,allowed:PlanFacts){
 const plan=harnessPlanSchema.parse(raw),goals=new Set(allowed.goalIds),skills=new Set(allowed.skillIds),sources=new Set(allowed.sourceIds);
 for(const item of [...plan.priorities,...plan.taskDrafts,...plan.experiments]){
  if(item.sourceIds.some(id=>!sources.has(id)))throw new Error('Unknown source reference.');
  if('goalIds' in item&&(item.goalIds.some(id=>!goals.has(id))||item.skillIds.some(id=>!skills.has(id))))throw new Error('Unknown goal or skill reference.');
 }
 if(/\b(?:I|we|Mayor|assistant|agent)\s+(?:(?:have|has|already)\s+)?(?:sent|published|posted|booked|charged|paid|updated|saved|created|deleted)\b/i.test(JSON.stringify(plan)))throw new Error('Draft claimed a completed action.');
 validateHarnessNarrative(plan,allowed);
 return plan;
}
