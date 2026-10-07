import {tool} from 'ai';
import {z} from 'zod';
import type {Actor,Env} from './env';
import {readBusinessHarness,prepareHarnessGoal,prepareHarnessSkill,prepareHarnessConfig,prepareHarnessIdentity,prepareHarnessTask,runBusinessHarnessNow,type HarnessProposal} from './business-harness';
import {harnessGoalSchema,harnessSkillSchema,harnessConfigSchema,harnessIdentitySchema,harnessTaskSchema} from './business-harness-schema';
import {asksHarnessChange,asksHarnessRun,harnessPausedConfigOverride,harnessReportReadback,type HarnessChange} from './business-harness-voice';

type Hooks={env:Env;actor:Actor;transcript:string;previousAssistant:string;authorize:()=>Promise<unknown>;claim:()=>void;readback:(text:string,readOnly:boolean)=>void;pending:(kind:HarnessChange,proposal:HarnessProposal)=>void;valid:()=>boolean};
/** Tool receipts, authorization and durable review proposals remain server-owned. */
export function businessHarnessTools(hooks:Hooks){
 const requestId=crypto.randomUUID();
 const check=async()=>{await hooks.authorize();if(!hooks.valid())throw new Error('This turn was interrupted.');};
 const change=async(kind:HarnessChange,input:unknown)=>{
  if(!asksHarnessChange(kind,hooks.transcript,hooks.previousAssistant))throw new Error('Prepare a change only when the user explicitly requests it.');
  await check();const state=kind==='task'?null:await readBusinessHarness(hooks.env,hooks.actor);await check();
  let proposal:HarnessProposal;
  if(kind==='goal'){
   const value=input as {id?:string};const prior=value.id?state!.goals.find(item=>item.id===value.id):null;
   if(value.id&&!prior)throw new Error('Read the current business goal before editing it.');
   proposal=await prepareHarnessGoal(hooks.env,hooks.actor,{description:'',metric:null,deadline:null,archived:false,...prior,...value,revision:prior?.revision??0});
  }else if(kind==='skill'){
   const value=input as {id?:string};const prior=value.id?state!.skills.find(item=>item.id===value.id):null;
   if(value.id&&!prior)throw new Error('Read the current custom skill before editing it.');
   proposal=await prepareHarnessSkill(hooks.env,hooks.actor,{archived:false,...prior,...value,revision:prior?.revision??0});
  }else if(kind==='config'){
   const prior=state!.config;
   const {goalTitles,skillTitles,clearConnectorReads,...changes}=input as {goalTitles?:string[];skillTitles?:string[];clearConnectorReads?:boolean;goalIds?:string[];skillIds?:string[];connectorOptions?:object};
   const normalized=(value:string)=>value.normalize('NFKC').trim().toLocaleLowerCase();
   const resolveTitles=(titles:string[],records:{id:string;title:string;archived?:boolean}[],kind:string)=>titles.map(title=>{
    const matches=records.filter(record=>!record.archived&&normalized(record.title)===normalized(title));
    if(matches.length!==1||!normalized(hooks.transcript).includes(normalized(title)))throw new Error(`Choose an exact, unambiguous saved ${kind} title from the current request.`);
    return matches[0].id;
   });
   if(goalTitles!==undefined&&changes.goalIds!==undefined||skillTitles!==undefined&&changes.skillIds!==undefined)throw new Error('Choose titles or IDs for each selection, never both.');
   if(goalTitles!==undefined)changes.goalIds=resolveTitles(goalTitles,state!.goals,'goal');
   if(skillTitles!==undefined)changes.skillIds=resolveTitles(skillTitles,[...state!.skills,...state!.builtins],'skill');
   if(clearConnectorReads){
    if(!/\b(?:no connector reads|do not read|don't read|disable connector reads|clear connector reads)\b/i.test(hooks.transcript)||changes.connectorOptions&&Object.keys(changes.connectorOptions).length)throw new Error('Clear connector reads only when explicitly requested, without selecting another connector.');
    changes.connectorOptions={};
   }
   const paused=harnessPausedConfigOverride(hooks.transcript,hooks.previousAssistant);
   proposal=await prepareHarnessConfig(hooks.env,hooks.actor,{revision:prior.revision,enabled:prior.enabled,goalIds:prior.goalIds,skillIds:prior.skillIds,schedule:prior.schedule,connectorOptions:prior.connectorOptions,...changes,...(paused===false?{enabled:false}:{})});
  }else if(kind==='identity'){
   const prior=state!.identity;
   proposal=await prepareHarnessIdentity(hooks.env,hooks.actor,{revision:prior.revision,mission:prior.mission,tone:prior.tone,principles:prior.principles,workingStyle:prior.workingStyle,...input as object});
  }else proposal=await prepareHarnessTask(hooks.env,hooks.actor,input);
  await check();hooks.claim();if(proposal.requiresUiReview){hooks.readback(proposal.readback,true);return {status:'needs_ui_review'};}hooks.readback(proposal.readback,false);hooks.pending(kind,proposal);return {status:'awaiting_confirmation'};
 };
 return {
  readBusinessAgent:tool({description:'Read this business’s saved goals, editable skills, identity, agent schedule, latest report and history. A lookup never saves or schedules anything.',inputSchema:z.object({}).strict(),execute:async()=>{await check();const state=await readBusinessHarness(hooks.env,hooks.actor);await check();return state;}}),
  runAgentReview:tool({description:'Run and save one AI agent review only for an explicit request to generate an agent/AI/growth report. Uses selected read tools and this chat turn’s metered reply attempt; does not save tasks or perform external actions. Retries within this turn reuse the same request ID.',inputSchema:z.object({}).strict(),execute:async()=>{
   if(!asksHarnessRun(hooks.transcript))throw new Error('An agent report requires an explicit run request.');
   await check();hooks.claim();const result=await runBusinessHarnessNow(hooks.env,hooks.actor,{requestId},{alreadyMetered:true});await check();
   hooks.readback(result.report?harnessReportReadback(result.report):'The agent review did not produce a report. Check its status in Today before starting a new review.',true);return result;
  }}),
  proposeAgentGoal:tool({description:'Prepare an explicitly requested goal creation, update, archive or restore. Read state first for an existing ID. Missing unchanged fields are preserved. Numbers must come from the user; omit a metric when unknown. Does not save until the next separate yes.',inputSchema:harnessGoalSchema.omit({revision:true}).partial().extend({archived:z.boolean().optional()}),execute:async input=>change('goal',input)}),
  proposeAgentSkill:tool({description:'Prepare an explicitly requested custom skill creation, update, archive or restore. Use only supplied instructions and listed read tools. Preserve omitted saved fields. Does not execute code or enable a schedule; requires the next separate yes.',inputSchema:harnessSkillSchema.omit({revision:true}).partial().extend({archived:z.boolean().optional()}),execute:async input=>change('skill',input)}),
  proposeAgentSchedule:tool({description:'Prepare an explicitly requested agent schedule, selected goals/skills or pause. For selections use goalTitles and skillTitles with the exact saved titles named by the user; the server resolves their IDs. Omit unchanged fields and unknown IDs. For no connector reads use clearConnectorReads:true and omit connectorOptions. Enabling needs a full daily/weekday local time and IANA time zone. Optional connector reads must be explicitly requested and owned. Requires the next separate yes.',inputSchema:z.object({enabled:z.boolean().optional(),goalTitles:z.array(z.string().min(1).max(160)).max(8).optional(),skillTitles:z.array(z.string().min(1).max(160)).min(1).max(8).optional(),goalIds:harnessConfigSchema.shape.goalIds.optional(),skillIds:harnessConfigSchema.shape.skillIds.optional(),clearConnectorReads:z.boolean().optional(),schedule:harnessConfigSchema.shape.schedule,connectorOptions:harnessConfigSchema.shape.connectorOptions.unwrap().optional()}).strict(),execute:async input=>change('config',input)}),
  proposeAgentIdentity:tool({description:'Prepare explicitly requested mission, tone, principles or working-style changes. Preserve fields not requested. Identity preferences never override permissions, evidence or tool rules. Assistant naming uses the existing proposeAssistantName tool. Requires the next separate yes.',inputSchema:harnessIdentitySchema.omit({revision:true}).partial(),execute:async input=>change('identity',input)}),
  proposeAgentTask:tool({description:'Prepare a specific internal task draft from this operator’s latest agent report for review. Read the report first and use its exact run and draft IDs. Only this reviewed task is saved after the next separate yes; no outreach or calendar action occurs.',inputSchema:harnessTaskSchema,execute:async input=>change('task',input)}),
 };
}
