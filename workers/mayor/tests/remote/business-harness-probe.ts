import type {Actor,Env} from '../../src/env';
import {confirmProfile} from '../../src/memory';
import {readBusinessHarness,prepareHarnessGoal,prepareHarnessSkill,prepareHarnessIdentity,prepareHarnessConfig,prepareHarnessTask,confirmHarnessProposal,runBusinessHarnessNow,inferHarnessPlan,validateHarnessPlan} from '../../src/business-harness';
import {usageBalance} from '../../src/billing/state';

interface ProbeEnv extends Env{PROBE_KEY:string;}
export default {async fetch(request:Request,env:ProbeEnv){
 if(!env.PROBE_KEY||request.headers.get('x-mayor-probe-key')!==env.PROBE_KEY)return Response.json({error:'unauthorized'},{status:401});
 const path=new URL(request.url).pathname;
 if(request.method==='GET'&&path==='/ready')return Response.json({ready:true});
 if(request.method!=='POST'||path!=='/run')return Response.json({error:'not_found'},{status:404});
 const checks:Record<string,boolean>={},readbacks:string[]=[];let stage='seed';
 try{
  const actor:Actor={tenantId:crypto.randomUUID().replaceAll('-',''),userId:crypto.randomUUID()},other:Actor={tenantId:crypto.randomUUID().replaceAll('-',''),userId:actor.userId},now=new Date().toISOString();
  await env.AGENT_DB.batch([actor,other].flatMap(item=>[
   env.AGENT_DB.prepare('INSERT INTO agent_tenants(id,name,created_at) VALUES(?,?,?)').bind(item.tenantId,'Synthetic agent acceptance business',now),
   env.AGENT_DB.prepare("INSERT INTO agent_memberships(tenant_id,user_id,role) VALUES(?,?,'owner')").bind(item.tenantId,item.userId),
  ]));
  await confirmProfile(env,actor,{name:'Cedar Bike Service · synthetic acceptance',assistantName:'Mayor Cedar',industry:'Neighborhood bicycle repair workshop',services:['Commuter bicycle repairs','Brake adjustments','Flat-tire repair','Seasonal maintenance'],locations:['Brooklyn, New York'],staff:[],timeZone:'America/New_York',businessGoals:['Build a useful repeat-maintenance process'],bottlenecks:['Maintenance follow-up handoffs are not documented'],currentTools:['Mayor internal tasks']},0);
  await env.AGENT_DB.prepare("INSERT INTO mayor_tasks(id,tenant_id,title,due_at,priority,status,revision,created_by,updated_by,created_at,updated_at) VALUES(?,?,?,NULL,'normal','open',1,?,?,?,?)").bind(crypto.randomUUID(),actor.tenantId,'Review which maintenance notes the workshop already records',actor.userId,actor.userId,now,now).run();
  const approve=async(proposal:Awaited<ReturnType<typeof prepareHarnessGoal>>)=>{readbacks.push(proposal.readback);await confirmHarnessProposal(env,actor,{id:proposal.id});};
  stage='goal';
  await approve(await prepareHarnessGoal(env,actor,{revision:0,title:'Grow repeat service bookings',description:'The owner entered these monthly figures. They have not been verified against sales records.',metric:{baseline:12,current:14,target:20,unit:'repeat bookings/month'},deadline:null,archived:false}));
  stage='skill';
  await approve(await prepareHarnessSkill(env,actor,{revision:0,title:'Retention planning',instructions:'Suggest one reversible maintenance-retention experiment and one useful internal planning task based on the supplied goal and saved workshop records. Avoid duplicating open tasks. Treat every suggestion as a draft. Do not invent contact consent, sales history, response times or customer information.',allowedTools:['profile','tasks','goals','connector_status'],archived:false}));
  stage='identity';
  await approve(await prepareHarnessIdentity(env,actor,{revision:0,mission:'Help this neighborhood workshop stay organized and learn whether a repeat-maintenance process helps.',tone:'direct',principles:['Use recorded facts','Ask before customer-facing actions'],workingStyle:'Choose small practical next steps and describe how to measure a proposed experiment.'}));
  let state=await readBusinessHarness(env,actor);const goal=state.goals.find(item=>item.title==='Grow repeat service bookings')!,skill=state.skills.find(item=>item.title==='Retention planning')!;
  stage='config';await approve(await prepareHarnessConfig(env,actor,{revision:state.config.revision,enabled:false,goalIds:[goal.id],skillIds:[skill.id],schedule:null,connectorOptions:{}}));
  const before=await usageBalance(env,actor),requestId=crypto.randomUUID();stage='real-workers-ai';
  let inferenceDiagnostic:Record<string,unknown>|null=null,modelOutput:unknown=null,providerResponse:unknown=null,providerRequest:unknown=null;
  const capturedAi={run:(async(...args:Parameters<Env['AI']['run']>)=>{
   const input=args[1] as Record<string,unknown>;providerRequest={model:args[0],stream:input?.stream,response_format:input?.response_format,max_tokens:input?.max_tokens,chat_template_kwargs:input?.chat_template_kwargs};
   const output=await env.AI.run(...args);
   if(output instanceof ReadableStream)providerResponse={stream:true};
   else{const envelope=output as {choices?:{finish_reason?:string;message?:{content?:unknown;tool_calls?:unknown;reasoning?:unknown;reasoning_content?:unknown}}[];response?:unknown;tool_calls?:unknown;usage?:unknown};providerResponse={response:envelope.response,tool_calls:envelope.tool_calls,usage:envelope.usage,choices:envelope.choices?.map(choice=>({finish_reason:choice.finish_reason,message:{content:choice.message?.content,tool_calls:choice.message?.tool_calls},reasoningCharacterCount:typeof choice.message?.reasoning==='string'?choice.message.reasoning.length:0,reasoningContentCharacterCount:typeof choice.message?.reasoning_content==='string'?choice.message.reasoning_content.length:0}))};}
   return output;
  }) as Env['AI']['run']};
  const started=Date.now(),result=await runBusinessHarnessNow(env,actor,{requestId},{infer:async(modelEnv,context)=>{
   try{modelOutput=await inferHarnessPlan({...modelEnv,AI:capturedAi as Env['AI']},context);}catch(error){inferenceDiagnostic={stage:'inference',name:error instanceof Error?error.name:'runtime',message:error instanceof Error?error.message:'Inference failed',text:typeof (error as {text?:unknown})?.text==='string'?(error as {text:string}).text.slice(0,16000):null};throw error;}
   try{validateHarnessPlan(modelOutput,{goalIds:context.goals.map(item=>item.id),skillIds:context.skills.map(item=>item.id),sourceIds:context.sources.map(item=>item.id),metrics:context.metrics,manualMetrics:context.goals.flatMap(item=>item.metric?[item.metric]:[]),dates:context.dates});}catch(error){inferenceDiagnostic={stage:'validation',name:error instanceof Error?error.name:'runtime',message:error instanceof Error?error.message:'Validation failed'};throw error;}
   return modelOutput;
  }}),elapsedMs=Date.now()-started;
  checks.realReportReady=result.run.status==='ready'&&Boolean(result.report);
  const after=await usageBalance(env,actor);checks.oneReplyAttempt=after.usage.replies.used-before.usage.replies.used===1;
  stage='replay';const replay=await runBusinessHarnessNow(env,actor,{requestId}),replayedBalance=await usageBalance(env,actor);
  checks.idempotentRun=replay.replay===true&&replay.run.id===result.run.id;checks.replayCostsNothing=replayedBalance.usage.replies.used===after.usage.replies.used;
  checks.pausedSchedule=(await readBusinessHarness(env,actor)).config.enabled===false;
  const report=result.report;
  if(report){
   checks.manualMetricIsCanonical=report.goalProgress.some(item=>item.goalId===goal.id&&item.source==='manual_entry'&&item.metric?.current===14&&item.progress===.25);
   checks.hasActualToolTrace=report.toolTrace.some(item=>item.tool==='tasks'&&item.status==='completed');
   checks.noExternalReads=report.toolTrace.filter(item=>['gmail_unread','calendar_openings'].includes(item.tool)).every(item=>item.status!=='completed');
   checks.noExecutionClaims=!/\b(?:I|we|Mayor|agent)\s+(?:(?:have|already)\s+)?(?:sent|published|booked|charged|paid)\b/i.test(JSON.stringify(report));
   checks.hasReviewableTask=report.taskDrafts.length>0;
   const draft=report.taskDrafts[0];
   if(draft){stage='task-review';const proposal=await prepareHarnessTask(env,actor,{runId:result.run.id,draftId:draft.id,title:draft.title,priority:draft.priority,dueAt:null,customerId:null});readbacks.push(proposal.readback);await confirmHarnessProposal(env,actor,{id:proposal.id});await confirmHarnessProposal(env,actor,{id:proposal.id});const count=await env.AGENT_DB.prepare('SELECT COUNT(*) AS count FROM mayor_tasks WHERE tenant_id=?').bind(actor.tenantId).first<{count:number}>();checks.taskApprovedExactlyOnce=count?.count===2;}
  }
  stage='isolation';const isolated=await readBusinessHarness(env,other);checks.businessIsolation=isolated.goals.length===0&&isolated.skills.length===0&&isolated.latestReport===null&&isolated.identity.displayName==='Mayor';
  state=await readBusinessHarness(env,actor);checks.nameAuthority=state.identity.displayName==='Mayor Cedar';
  const passed=Object.values(checks).every(Boolean);
  return Response.json({synthetic:true,passed,checks,elapsedMs,model:'@cf/qwen/qwen3-30b-a3b-fp8',inferenceDiagnostic,modelOutput,providerRequest,providerResponse,readbacks,report,run:result.run,history:state.history,usage:after.usage,limitation:'Actual Cloudflare Workers AI and isolated remote D1 using explicitly synthetic business records. Tests report generation, manual goal provenance, usage, replay, reviewed task approval and tenant isolation; no customer outreach, public posts, live calendar changes or production business mutations.'},{status:passed?200:502,headers:{'cache-control':'no-store'}});
 }catch(error){return Response.json({synthetic:true,passed:false,stage,checks,category:error instanceof Error?error.name:'runtime_error',message:error instanceof Error?error.message:'Acceptance probe failed'},{status:502,headers:{'cache-control':'no-store'}});}
}} satisfies ExportedHandler<ProbeEnv>;
