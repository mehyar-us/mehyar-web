// Actual MayorVoice and D1 persistence, isolated from all production resources.
import {routeAgentRequest} from 'agents';
import {calendarDnsHint} from '../../src/calendar-guide';
import {createAuth} from '../../src/auth';
import {readMemory} from '../../src/memory';
import {readSchedulingSetup} from '../../src/scheduling-setup';
import {readSchedulingPolicy} from '../../src/scheduling-policy';
import {readConversationRecovery,writeConversationRecovery} from '../../src/conversation-recovery';
import type {Env} from '../../src/env';
import type {VoiceIdentity} from '../../src/voice-access';
import {MayorVoice as ProductionMayorVoice} from '../../src/voice';
import {readBusinessHarness} from '../../src/business-harness';
import {usageBalance} from '../../src/billing/state';
// Synthetic probe only: capture bounded model output without adding production logging.
export class MayorVoice extends ProductionMayorVoice {
 private probeTrace:{toolChoice:unknown;tools:string[];output:string}[];
 constructor(ctx:DurableObjectState,env:Env){
  const traces:{toolChoice:unknown;tools:string[];output:string}[]=[];
  const run=(async(...args:Parameters<Env['AI']['run']>)=>{
   const output=await env.AI.run(...args);
   if(!(output instanceof ReadableStream)||!String(args[0]).includes('qwen'))return output;
   const input=args[1] as any;
   const trace={toolChoice:input.tool_choice,tools:(input.tools??[]).map((item:any)=>item.function?.name??item.name),output:''};
   if(traces.length<5)traces.push(trace);
   const decoder=new TextDecoder();
   return output.pipeThrough(new TransformStream<Uint8Array,Uint8Array>({transform(chunk,controller){if(trace.output.length<180000)trace.output+=decoder.decode(chunk,{stream:true}).slice(0,180000-trace.output.length);controller.enqueue(chunk);}}));
  }) as Env['AI']['run'];
  super(ctx,{...env,AI:new Proxy(env.AI,{get(target,key){const value=Reflect.get(target,key);return key==='run'?run:typeof value==='function'?value.bind(target):value;}})});
  this.probeTrace=traces;
 }
 async onRequest(request:Request){
  this.probeTrace.length=0;
  const response=await super.onRequest(request);
  if(!new URL(request.url).pathname.endsWith('/chat'))return response;
  const body=await response.json() as {events?:unknown[]};
  return Response.json({...body,events:[...(body.events??[]),{type:'synthetic_model_trace',calls:this.probeTrace.map(summarizeTrace)}]},{status:response.status});
 }
}
function summarizeTrace(trace:{toolChoice:unknown;tools:string[];output:string}){
 let content='',promptTokens=0;const toolCalls:Record<string,{name:string;arguments:string}>={};
 for(const line of trace.output.split('\n')){
  if(!line.startsWith('data: '))continue;
  let event:any;try{event=JSON.parse(line.slice(6));}catch{continue;}
  promptTokens=Math.max(promptTokens,event.usage?.prompt_tokens??0);
  for(const choice of event.choices??[]){
   content+=choice.delta?.content??'';
   for(const call of choice.delta?.tool_calls??[]){
    const item=toolCalls[call.index??0]??={name:'',arguments:''};
    item.name+=call.function?.name??'';item.arguments+=call.function?.arguments??'';
   }
  }
 }
 return {toolChoice:trace.toolChoice,tools:trace.tools,content,toolCalls,promptTokens,traceTruncated:trace.output.length>=180000};
}
const pause=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
type Turn={fixture:string;transcript:string;reply:string;audioBytes:number;metrics:Record<string,unknown>|null;earlyAbortedMetrics:Record<string,unknown>[];diagnostics:unknown[];error:string|null};
async function openVoice(env:Env,actor:VoiceIdentity,name:string,textOnly=false,httpOnly=false){
 if(httpOnly){
  const restored=await readConversationRecovery(env,actor);
  return {close:()=>{},greeting:{reply:'',audioBytes:0,done:false,errorCategory:null as string|null,protocol:[] as Record<string,unknown>[]},history:restored.messages.map(message=>({role:message.role,text:message.content})),async turn(fixture:string):Promise<Turn>{
   const started=Date.now();
   const response=await routeAgentRequest(new Request(`https://probe.invalid/agents/mayor-voice/${name}/chat`,{method:"POST",headers:{"content-type":"application/json","x-mayor-tenant":actor.tenantId,"x-mayor-user":actor.userId,"x-mayor-session":actor.sessionId},body:JSON.stringify({requestId:crypto.randomUUID(),text:fixture})}),{MayorVoice:env.MAYOR_VOICE},{routingRetry:false});
   const body=await response?.json() as {reply?:string;events?:unknown[];message?:string}|undefined;
   return {fixture,transcript:fixture,reply:body?.reply??"",audioBytes:0,metrics:{outcome:response?.ok?"completed":"failed",totalMs:Date.now()-started},earlyAbortedMetrics:[],diagnostics:body?.events??[],error:response?.ok?null:body?.message??"HTTP conversation unavailable"};
  }};
 }
 const response=await routeAgentRequest(new Request(`https://probe.invalid/agents/mayor-voice/${name}`,{headers:{upgrade:'websocket',
  'x-mayor-tenant':actor.tenantId,'x-mayor-user':actor.userId,'x-mayor-session':actor.sessionId,
 }}),{MayorVoice:env.MAYOR_VOICE},{routingRetry:false});
 const socket=response?.webSocket;if(!socket)throw new Error('Voice connection unavailable');
 socket.binaryType='arraybuffer';socket.accept();
 let ready=false,fatal:string|null=null,current:Turn|undefined,history:unknown[]=[];let configured=false,silenceTicker:ReturnType<typeof setInterval>|undefined;const greeting={reply:'',audioBytes:0,done:false,errorCategory:null as string|null,protocol:[] as Record<string,unknown>[]};
 socket.addEventListener('message',event=>{
  if(typeof event.data!=='string'){if(event.data instanceof ArrayBuffer){if(current)current.audioBytes+=event.data.byteLength;else greeting.audioBytes+=event.data.byteLength;}return;}
  const message=JSON.parse(event.data);
  if(message.type==='conversation_history'){history=message.messages;if(textOnly)ready=true;}
  // Production waits for the first capture frame before opening STT. Mirror the
  // browser: begin PCM after audio configuration, before the listening ack.
  if(message.type==='audio_config'&&!textOnly){configured=true;socket.send(new ArrayBuffer(640));}
  if(message.type==='status'&&message.status==='listening')ready=true;
  if(message.type==='error'){fatal=message.message;if(current)current.error=fatal;else greeting.errorCategory=/session|permission|sign in|membership/i.test(message.message)?'access':/rate|quota|limit|allowance/i.test(message.message)?'quota':/speech|synth|audio/i.test(message.message)?'speech':/socket|network|connection/i.test(message.message)?'transport':'pipeline';}
  if(!current){if(greeting.protocol.length<30)greeting.protocol.push({type:message.type,status:message.status??null,event:message.event??null,stage:message.stage??null});if(message.type==='transcript_delta')greeting.reply+=message.text;if(message.type==='transcript_end')greeting.reply=message.text;if(message.type==='status'&&message.status==='listening'&&greeting.reply&&greeting.audioBytes>0)greeting.done=true;return;}
  if(['website_source','profile_proposal','scheduling_setup_proposal','scheduling_policy_proposal'].includes(message.type))current.diagnostics.push(message);
  if(message.type==='transcript'&&message.role==='user')current.transcript=message.text;
  if(message.type==='transcript_delta')current.reply+=message.text;
  if(message.type==='transcript_end')current.reply=message.text;
  if(message.type==='turn_metrics'){
   // Flux can replace an early allocation even after a partial transcript. An
   // aborted allocation is not this fixture's completed response.
   if(message.outcome==='aborted'){if(current.earlyAbortedMetrics.length<10)current.earlyAbortedMetrics.push(message);}
   else current.metrics=message;
  }
 });
 socket.addEventListener('close',event=>{if(silenceTicker!==undefined)clearInterval(silenceTicker);fatal=`Voice socket closed (${event.code}): ${event.reason}`;if(!current)greeting.errorCategory='transport';});
 // The browser continues microphone PCM (including silence/mute) while a greeting plays.
 // Maintain that input during startup rather than leaving Flux without capture frames.
 if(!textOnly)silenceTicker=setInterval(()=>{if(configured&&!current){try{socket.send(new ArrayBuffer(1280));}catch{}}},40);
 const close=()=>{if(silenceTicker!==undefined)clearInterval(silenceTicker);try{socket.send(JSON.stringify({type:'end_call'}));socket.close();}catch{}};
 try{
  if(!textOnly)socket.send(JSON.stringify({type:'start_call'}));
  const until=Date.now()+15000;while(!ready&&!fatal&&Date.now()<until)await pause(20);
  if(!ready)throw new Error(fatal??'Voice startup timeout');
 }catch(error){close();throw error;}
 return {close,greeting,get history(){return history;},async turn(fixture:string):Promise<Turn>{
  if(textOnly){
   const result:Turn={fixture,transcript:'',reply:'',audioBytes:0,metrics:null,earlyAbortedMetrics:[],diagnostics:[],error:null};current=result;
   socket.send(JSON.stringify({type:'text_message',text:fixture}));
   const until=Date.now()+30000;while(!result.metrics&&!fatal&&Date.now()<until)await pause(20);
   result.error=fatal??(!result.metrics?'Text turn timeout':null);return result;
  }
  const generated=await (env.AI.run as any)('@cf/deepgram/aura-1',{text:fixture,speaker:'asteria',encoding:'linear16',sample_rate:16000,container:'none'},{returnRawResponse:true,signal:AbortSignal.timeout(15000)}) as Response;
  if(!generated.ok)throw new Error('Fixture synthesis failed');
  const pcm=await generated.arrayBuffer();if(!pcm.byteLength||pcm.byteLength>640000||pcm.byteLength%2)throw new Error('Invalid fixture audio');
  const result:Turn={fixture,transcript:'',reply:'',audioBytes:0,metrics:null,earlyAbortedMetrics:[],diagnostics:[],error:null};current=result;
  const started=Date.now();
  for(let offset=0;offset<pcm.byteLength&&!fatal;offset+=1280){
   socket.send(pcm.slice(offset,Math.min(offset+1280,pcm.byteLength)));
   await pause(Math.max(0,started+(offset+1280)/32-Date.now()));
  }
  const until=Date.now()+30000;
  while(!result.metrics&&!fatal&&Date.now()<until){socket.send(new ArrayBuffer(1280));await pause(40);}
  result.error??=fatal??(!result.metrics?'Voice turn timeout':null);return result;
 }};
}
export default {async fetch(request:Request,raw:Env&{PROBE_KEY?:string}){
 const path=new URL(request.url).pathname;
 if(!['/run','/ready'].includes(path))return new Response('Isolated synthetic Mayor memory test');
 if(!raw.PROBE_KEY||request.headers.get('x-mayor-probe-key')!==raw.PROBE_KEY)return new Response('Unauthorized',{status:401});
 if(path==='/ready'){
  try{
   // Verify the DO deployment too; an outer Worker response can precede it.
   const response=await routeAgentRequest(new Request('https://probe.invalid/agents/mayor-voice/readiness/ready'),{MayorVoice:raw.MAYOR_VOICE},{routingRetry:false});
   const ready=response?.status===404&&await response.text()==='Not found';
   return Response.json({ready},{status:ready?200:503});
  }catch{return Response.json({ready:false},{status:503});}
 }
 if(request.method!=='POST')return new Response('POST required',{status:405});
 const httpOnly=new URL(request.url).searchParams.get('transport')==='http';
 const textOnly=httpOnly||new URL(request.url).searchParams.get('transport')==='text';
 const scenario=new URL(request.url).searchParams.get('scenario')??'name';
 if(!['name','nickname','hours','setup','setup-complete','recovery','onboarding','onboarding-natural','website','calendar','agent'].includes(scenario))return new Response('Unknown fixture',{status:400});
 const nickname=scenario==='nickname',hours=scenario==='hours',setup=scenario==='setup',field=nickname?'assistantName':setup?'timeZone':hours?'hours':'name';
 const proposalEvent=setup?'scheduling_setup_proposal':'profile_proposal';
 const initialFixture=nickname?'Please call yourself Mayor Atlas.':setup?'Please save New York as the time zone for my appointment scheduling setup. Leave every other rule unknown.':hours?'Please save my business hours as Monday from nine AM to five PM.':'Please save my business name as Example Agency.';
 const correctionFixture=nickname?'Please call yourself Mayor Cedar.':setup?'For that scheduling setup, change the time zone to Chicago time. Keep the other rules unknown.':hours?'Actually, change my business hours to Monday from ten AM to four PM.':'Actually, change the business name to Example Consulting.';
 const matches=(text:string,corrected=false)=>nickname?(corrected?/mayor cedar/i:/mayor atlas/i).test(text):setup?(corrected?/Chicago|central/i:/New[_ ]York|eastern/i).test(text):hours
  ? /monday/i.test(text)&& (corrected?/\b(10(?::00)?|ten)\s*(a\.?m\.?|in the morning)\b/i:/\b(0?9(?::00)?|nine)\s*(a\.?m\.?|in the morning)\b/i).test(text)&& (corrected?/\b(4(?::00)?|four)\s*(p\.?m\.?|in the afternoon)\b/i:/\b(5(?::00)?|five)\s*(p\.?m\.?|in the afternoon)\b/i).test(text)
  :text.toLowerCase().includes(corrected?'example consulting':'example agency');
 const env={...raw,BETTER_AUTH_SECRET:raw.PROBE_KEY};
 const turns:Turn[]=[],checks:Record<string,boolean>={},profiles:Record<string,unknown>={};let connection:Awaited<ReturnType<typeof openVoice>>|undefined,stage='create-user';
 const snapshot=(label:string,memory:{profile:object;revision:number})=>{profiles[label]={profile:memory.profile,revision:memory.revision};};
 try{
  const context=await createAuth(env).$context;
  const user=await context.internalAdapter.createUser({email:`${crypto.randomUUID()}@example.test`,name:'Synthetic voice fixture',emailVerified:true},{method:'synthetic-test'});
  stage='create-session';
  const session=await context.internalAdapter.createSession(user.id,false);
  const actor={tenantId:crypto.randomUUID().replaceAll('-',''),userId:user.id,sessionId:session.id};
  stage='seed-membership';
  await env.AGENT_DB.batch([
   env.AGENT_DB.prepare('INSERT INTO agent_tenants(id,name,created_at) VALUES(?,?,?)').bind(actor.tenantId,'Synthetic voice fixture',new Date().toISOString()),
   env.AGENT_DB.prepare("INSERT INTO agent_memberships(tenant_id,user_id,role) VALUES(?,?,'owner')").bind(actor.tenantId,user.id),
  ]);
  const readSnapshot=async():Promise<{profile:Record<string,unknown>;revision:number}>=>{if(!setup)return readMemory(env,actor);const saved=await readSchedulingSetup(env,actor);return {profile:saved.details??{},revision:saved.revision};};
  if(scenario==='agent'){
   if(!httpOnly)throw new Error('Agent acceptance uses HTTP text with the actual production voice/chat actor.');
   await import('../../src/memory').then(({confirmProfile})=>confirmProfile(env,actor,{name:'Synthetic neighborhood bicycle workshop',assistantName:'Mayor Cedar',industry:'Bicycle maintenance',services:['Commuter bicycle repairs'],locations:['Brooklyn, New York'],staff:[],timeZone:'America/New_York'},0));
   connection=await openVoice(env,actor,actor.tenantId+actor.userId.replaceAll('-',''),true,true);
   const turn=async(text:string)=>{const result=await connection!.turn(text);turns.push(result);if(result.error)throw new Error('Agent conversation turn did not complete.');return result;};
   stage='voice-goal-proposal';await turn('Create an agent goal called Build a repeat-maintenance process. Description: document a useful workshop maintenance handoff. No measured numbers or deadline are known.');
   checks.goalNeedsSeparateYes=(await readBusinessHarness(env,actor)).goals.length===0;
   await turn('Yes');let state=await readBusinessHarness(env,actor);checks.goalSavedAfterYes=state.goals.some(goal=>goal.title==='Build a repeat-maintenance process'&&goal.metric===null);
   stage='voice-skill-proposal';await turn('Create a custom skill called Maintenance planning. Instructions: use the saved profile, internal tasks and goals to suggest a small reversible maintenance-retention experiment and an internal planning task. Allowed read tools: profile, tasks, goals, connector_status.');
   checks.skillNeedsSeparateYes=(await readBusinessHarness(env,actor)).skills.length===0;await turn('Yes');state=await readBusinessHarness(env,actor);checks.skillSavedAfterYes=state.skills.some(skill=>skill.title==='Maintenance planning');
   stage='voice-identity-proposal';await turn('Change the agent identity mission to Help this workshop stay organized and learn from small experiments. Use a professional tone.');
   checks.identityNeedsSeparateYes=(await readBusinessHarness(env,actor)).identity.mission==='';await turn('Yes');state=await readBusinessHarness(env,actor);checks.identitySavedAfterYes=state.identity.mission.includes('workshop')&&state.identity.tone==='professional'&&state.identity.displayName==='Mayor Cedar';
   stage='voice-config-proposal';await turn('Use the Build a repeat-maintenance process goal and the Maintenance planning custom skill for my business agent. Save these agent settings with automatic reviews paused, and no connector reads.');
   checks.configNeedsSeparateYes=(await readBusinessHarness(env,actor)).config.revision===0;await turn('Yes');state=await readBusinessHarness(env,actor);checks.configSavedAfterYes=state.config.revision===1&&state.config.enabled===false&&state.config.goalIds.includes(state.goals[0]?.id)&&state.config.skillIds.includes(state.skills[0]?.id);
   stage='readonly-report-question';const reportHelp=await turn('Is it possible to run an AI report?');state=await readBusinessHarness(env,actor);checks.readonlyQuestionCreatesNoReport=state.latestReport===null&&state.history.length===0;
   checks.readonlyQuestionNamesRealAction=/Review my business.*Today/.test(reportHelp.reply)&&!/would you like|proceed|\?\s*$/i.test(reportHelp.reply);
   stage='readonly-report-yes';const reportHelpYes=await turn('Yes');state=await readBusinessHarness(env,actor);checks.readonlyYesCreatesNoReport=state.latestReport===null&&state.history.length===0;
   checks.readonlyYesKeepsActionGuidance=/Review my business.*Today/.test(reportHelpYes.reply)&&!/saved|initiated|will be|\?\s*$/i.test(reportHelpYes.reply);
   stage='voice-agent-report';const before=await usageBalance(env,actor);await turn('Could you review my business now?');const after=await usageBalance(env,actor);state=await readBusinessHarness(env,actor);
   checks.actualAgentReport=state.latestReport!==null&&state.history[0]?.status==='ready';checks.reportUsesOnlyOneTurn=after.usage.replies.used-before.usage.replies.used===1;
   stage='read-only-yes';await turn('Yes');const tasks=await env.AGENT_DB.prepare('SELECT COUNT(*) AS count FROM mayor_tasks WHERE tenant_id=?').bind(actor.tenantId).first<{count:number}>();checks.reportDidNotArmTaskApproval=tasks?.count===0;
   const passed=Object.values(checks).every(Boolean);return Response.json({synthetic:true,passed,scenario,transport:'http',checks,turns,report:state.latestReport,identity:state.identity,config:state.config,limitation:'Actual production MayorVoice tools, real Cloudflare model and isolated remote D1/DO with synthetic records. Verifies separate confirmations and one counted report turn. No microphone, telephone, production business changes or customer outreach.'},{status:passed?200:502});
  }
  if(scenario==='recovery'){
   if(!textOnly)throw new Error('Recovery probe requires text transport');
   stage='seed-recovery-copy';
   const messages=[{role:'user' as const,content:'Please save my business name as Example Agency.'},{role:'assistant' as const,content:'Please verify the business name: Example Agency. Say yes to save.'}];
   await writeConversationRecovery(env,actor,0,messages);
   stage='restore-into-fresh-object';connection=await openVoice(env,actor,crypto.randomUUID(),true,httpOnly);
   checks.exactHistoryRestored=JSON.stringify(connection.history)===JSON.stringify(messages.map(message=>({role:message.role,text:message.content})));
   stage='reject-restored-confirmation';turns.push(await connection.turn('Yes, that is correct.'));
   checks.noRestoredActionAuthority=turns[0].reply.includes('confirmation is no longer valid')&&(await readMemory(env,actor)).revision===0;
   stage='await-recovery-copy';
   let copy=await readConversationRecovery(env,actor);const deadline=Date.now()+10000;
   while(copy.messages.length<4&&Date.now()<deadline){await pause(100);copy=await readConversationRecovery(env,actor);}
   checks.newTurnCopied=copy.messages.length===4&&copy.messages.at(-1)?.content===turns[0].reply&&copy.revision===3;
   connection.close();stage='restore-updated-copy';connection=await openVoice(env,actor,crypto.randomUUID(),true,httpOnly);
   checks.updatedHistoryRestored=JSON.stringify(connection.history)===JSON.stringify(copy.messages.map(message=>({role:message.role,text:message.content})));
   const passed=Object.values(checks).every(Boolean);
   return Response.json({passed,scenario,transport:httpOnly?'http':'text',checks,turns,limitation:'Isolated real Cloudflare D1 and fresh Durable Objects with synthetic conversation text. Verifies snapshot recovery and confirmation invalidation, not physical disaster recovery, telephone calls, or acoustic latency.'},{status:passed?200:502});
  }
  if(scenario==='calendar'){
   stage='calendar-dns';const hint=await calendarDnsHint('https://mehyar.us/','https://mayor.mehyar.us');
   return Response.json({passed:hint.providers.includes('zoho'),scenario,hint,checks:{zohoMailDetected:hint.providers.includes('zoho')},turns:[]});
  }
  stage='connect-voice';const name=crypto.randomUUID();connection=await openVoice(env,actor,name,textOnly,httpOnly);
  if(nickname&&!textOnly){const started=Date.now(),deadline=started+25000;while(!connection.greeting.done&&!connection.greeting.errorCategory&&Date.now()<deadline)await pause(20);profiles.initialGreeting={...connection.greeting,waitMs:Date.now()-started};checks.defaultIntroductionIsAI=/Mayor.*AI business assistant/i.test(connection.greeting.reply);checks.offersOwnerChosenName=/Mayor Michael.*what would you like to call me/i.test(connection.greeting.reply);checks.initialGreetingHasAudio=connection.greeting.audioBytes>0;if(!checks.defaultIntroductionIsAI||!checks.offersOwnerChosenName||!checks.initialGreetingHasAudio)throw new Error('Initial assistant introduction was missing or not transparent');}
  if(scenario==='website'){
   stage='website-proposal';
   const websiteAddress='M E H Y A R dot U S';
   const proposed=await connection.turn(`Read the website ${websiteAddress} and propose only a short business description supported by that page. Do not save yet.`);turns.push(proposed);
   const event=proposed.diagnostics.find(item=>(item as {type?:string}).type==='profile_proposal') as {patch?:{description?:string};source?:{sourceId:string;url:string;quotes:Record<string,string>}}|undefined;
   checks.sourceShown=proposed.diagnostics.some(item=>(item as {type?:string}).type==='website_source');
   checks.descriptionProposal=Boolean(event?.patch?.description&&Object.keys(event.patch).length===1&&event.source);
   checks.noEarlyWrite=(await readMemory(env,actor)).revision===0;
   if(!checks.descriptionProposal||!checks.noEarlyWrite)throw new Error('Website description proposal missing or saved prematurely');
   const source=await env.AGENT_DB.prepare('SELECT excerpt FROM mayor_website_sources WHERE id=? AND tenant_id=?').bind(event!.source!.sourceId,actor.tenantId).first<{excerpt:string}>();
   checks.exactQuote=Boolean(source?.excerpt.includes(event!.source!.quotes.description));
   checks.sourceDomain=new URL(event!.source!.url).hostname==='mehyar.us';
   stage='website-confirm';turns.push(await connection.turn('Yes, that is correct.'));
   const saved=await readMemory(env,actor);profiles.websiteConfirmed=saved;
   checks.savedExactDescription=saved.revision===1&&saved.profile.description===event!.patch!.description;
   checks.savedProvenance=saved.sources.description?.sourceId===event!.source!.sourceId&&saved.sources.description?.kind==='website_owner_confirmed';
   stage='owner-correction';turns.push(await connection.turn('My business description should be: We provide graphic design for independent shops. Prepare that correction for confirmation.'));
   checks.noEarlyCorrection=(await readMemory(env,actor)).revision===1;
   stage='owner-confirm';turns.push(await connection.turn('Yes, that is correct.'));
   const corrected=await readMemory(env,actor);profiles.ownerCorrected=corrected;
   checks.correctedDescription=corrected.revision===2&&corrected.profile.description==='We provide graphic design for independent shops.';
   checks.ownerProvenance=corrected.sources.description?.kind==='owner_conversation'&&!corrected.sources.description?.sourceId;
   checks.noInventedRules=(await readSchedulingPolicy(env,actor)).policy===null;
   const passed=Object.values(checks).every(Boolean)&&turns.every(turn=>!turn.error&&turn.metrics?.outcome==='completed');
   return Response.json({passed,scenario,transport:httpOnly?'http':textOnly?'text':'speech',checks,turns,profiles,limitation:'Real public website and real model with isolated synthetic business. Exact quotation verifies provenance, not semantic entailment or comprehensive prompt-injection resistance. No production profile changes.'},{status:passed?200:502});
  }
  if(scenario==='onboarding'||scenario==='onboarding-natural'){
   const canonical=(value:unknown):string=>JSON.stringify(value,(_key,item)=>typeof item==='string'?item.toLowerCase():item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);
   const fixtures=[
    {text:'My business is called Example Studio. Our industry is Graphic design. Please prepare those two business facts for confirmation. We have no website.',patch:{name:'Example Studio',industry:'Graphic design'}},
    {text:'Our services are Logo design and Brand identity. We serve customers Online. Prepare only those services and locations for confirmation.',patch:{services:['Logo design','Brand identity'],locations:['Online']}},
    {text:'Our business time zone is New York. I work alone with no staff members. Prepare the time zone and an empty staff list for confirmation. Our hours are still unknown.',patch:{timeZone:'America/New_York',staff:[]}},
   ];
   if(scenario==='onboarding-natural'){
    fixtures[0].text="My business is called Example Studio. Our industry is Graphic design, and we don't have a website.";
    fixtures[1].text='Our services are Logo design and Brand identity. We serve customers Online.';
    fixtures[2].text="Our business time zone is New York. I work alone with no staff members. I don't know our hours yet.";
   }
   let expected:Record<string,unknown>={};
   for(const [index,fixture] of fixtures.entries()){
    stage='onboarding-proposal-'+index;const proposed=await connection.turn(fixture.text);turns.push(proposed);
    const before=await readMemory(env,actor);
    checks['proposal'+index]=proposed.diagnostics.some(event=>{const value=event as {type?:string;patch?:unknown};return value.type==='profile_proposal'&&canonical(value.patch)===canonical(fixture.patch);});
    checks['noEarlyWrite'+index]=before.revision===index&&canonical(before.profile)===canonical(expected);
    if(!checks['proposal'+index]||!checks['noEarlyWrite'+index])throw new Error('Onboarding proposal did not preserve supplied facts and unknowns');
    stage='onboarding-confirm-'+index;const confirmed=await connection.turn('Yes, that is correct.');turns.push(confirmed);expected={...expected,...fixture.patch};
    checks['nextQuestion'+index]=(index===0?/services or products/i:/when.*available|hours/i).test(confirmed.reply);
    if(index===2)checks.unknownHoursDeferred=/hours later/i.test(confirmed.reply)&&!/when.*available|details are complete/i.test(confirmed.reply);
    const saved=await readMemory(env,actor);profiles['confirmed'+index]=saved;
    checks['savedExactly'+index]=saved.revision===index+1&&canonical(saved.profile)===canonical(expected);
    if(!checks['savedExactly'+index])throw new Error('Onboarding save differed from confirmed facts');
   }
   connection.close();connection=await openVoice(env,actor,name,textOnly,httpOnly);checks.historyRestored=connection.history.length>=12;
   stage='resume-missing-hours';const resume=await connection.turn('Resume business onboarding from my confirmed details. Ask only the next missing basic question. Do not change anything.');turns.push(resume);
   const saved=await readMemory(env,actor);checks.asksMissingHours=/hours|when.*available/i.test(resume.reply);checks.noRecallWrite=saved.revision===3&&canonical(saved.profile)===canonical(expected);checks.websiteAndHoursUnknown=!('website' in saved.profile)&&!('hours' in saved.profile);checks.rulesRemainInactive=(await readSchedulingPolicy(env,actor)).policy===null;
   stage='workspace-resume';const direct=await connection.turn('Resume onboarding from my confirmed details. Ask one missing question.');turns.push(direct);
   checks.workspaceAsksMissingHours=/hours|when.*available/i.test(direct.reply);
   const afterDirect=await readMemory(env,actor);checks.workspaceNoWrite=afterDirect.revision===3&&canonical(afterDirect.profile)===canonical(expected);
   const passed=Object.values(checks).every(Boolean)&&turns.every(turn=>!turn.error&&turn.metrics?.outcome==='completed');
   return Response.json({passed,scenario,transport:httpOnly?'http':textOnly?'text':'speech',checks,turns,profiles,limitation:'Real model and application with isolated synthetic business. Does not certify live provider access or audio.'},{status:passed?200:502});
  }
  if(scenario==='setup-complete'){
   const scenarioStarted=Date.now();
   const canonical=(value:unknown):string=>JSON.stringify(value,(_key,item)=>typeof item==='string'?item.toLowerCase():item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);
   const fixtures=[
    {text:'For appointment scheduling, use New York time and open only Monday from nine AM to five PM. Keep all other rules unknown.',patch:{timeZone:'America/New_York',weeklyHours:[{day:1,startMinute:540,endMinute:1020}]}},
    {text:'For that scheduling setup, add an appointment type called Consultation. It lasts thirty minutes, with zero minutes before and ten minutes after.',patch:{appointmentTypes:[{name:'Consultation',durationMinutes:30,bufferBeforeMinutes:0,bufferAfterMinutes:10}]}},
    {text:'For this setup, no staff choice and no closed dates. Require one hour notice for booking, allow bookings thirty days ahead, and require two hours notice for cancellation.',patch:{staff:[],closedDates:[],minimumNoticeMinutes:60,maximumAdvanceDays:30,cancellationNoticeMinutes:120}},
   ];
   let expected:Record<string,unknown>={};
   for(const [index,fixture] of fixtures.entries()){
    stage='setup-details-'+(index+1);
    const proposed=await connection.turn(fixture.text);turns.push(proposed);
    const before=await readSchedulingSetup(env,actor);profiles['beforeConfirmation'+(index+1)]=before;
    checks['proposal'+(index+1)]=proposed.diagnostics.some(event=>{const value=event as {type?:string;details?:Record<string,unknown>};return value.type==='scheduling_setup_proposal'&&canonical({...expected,...value.details})===canonical({...expected,...fixture.patch});})&&proposed.metrics?.outcome==='completed';
    checks['noEarlyWrite'+(index+1)]=before.revision===index&&canonical(before.details)===canonical(expected)&&(await readSchedulingPolicy(env,actor)).policy===null;
    if(!checks['proposal'+(index+1)]||!checks['noEarlyWrite'+(index+1)])throw new Error('Setup proposal boundary failed');
    stage='confirm-details-'+(index+1);turns.push(await connection.turn('Yes, that is correct.'));
    expected={...expected,...fixture.patch};
    const saved=await readSchedulingSetup(env,actor);profiles['afterConfirmation'+(index+1)]=saved;
    checks['savedExactly'+(index+1)]=saved.revision===index+1&&canonical(saved.details)===canonical(expected)&&(await readSchedulingPolicy(env,actor)).policy===null;
    if(!checks['savedExactly'+(index+1)])throw new Error('Confirmed setup differed from explicitly supplied details');
   }
   checks.readyForReview=(await readSchedulingSetup(env,actor)).readyForReview;
   stage='reconnect-before-activation';connection.close();connection=await openVoice(env,actor,name,textOnly,httpOnly);
   checks.historyRestored=connection.history.length>=12;
   stage='review-activation';const review=await connection.turn('Please review all my saved scheduling details so I can confirm and activate these booking rules.');turns.push(review);
   checks.fullReview=review.diagnostics.some(event=>{const value=event as {type?:string;policy?:unknown};return value.type==='scheduling_policy_proposal'&&canonical(value.policy)===canonical(expected);})&&/please verify/i.test(review.reply);
   checks.notActiveBeforeConfirmation=(await readSchedulingPolicy(env,actor)).policy===null;
   if(!checks.fullReview||!checks.notActiveBeforeConfirmation)throw new Error('Full policy review boundary failed');
   stage='confirm-activation';turns.push(await connection.turn('Yes, that is correct.'));
   const activated=await readSchedulingPolicy(env,actor);profiles.activePolicy=activated;
   checks.policyActivatedExactly=activated.revision===1&&canonical(activated.policy)===canonical(expected);
   checks.setupSuperseded=(await readSchedulingSetup(env,actor)).active;
   stage='recall-active-policy';const recall=await connection.turn('What minimum notice do clients need before booking an appointment? Do not change anything.');turns.push(recall);
   checks.activeRuleRecall=/60|sixty|one hour|1 hour/i.test(recall.reply);
   checks.recallDidNotWrite=(await readSchedulingPolicy(env,actor)).revision===1;
   stage='change-active-hours';const changed=await connection.turn('Change the appointment hours to Tuesday only, from ten AM to four PM. Leave all other booking rules unchanged.');turns.push(changed);
   const tuesday={...expected,weeklyHours:[{day:2,startMinute:600,endMinute:960}]};
   checks.changeReadback=changed.diagnostics.some(event=>{const value=event as {type?:string;policy?:unknown};return value.type==='scheduling_policy_proposal'&&canonical(value.policy)===canonical(tuesday);});
   const beforeChange=await readSchedulingPolicy(env,actor);checks.changeNotSaved=beforeChange.revision===1&&canonical(beforeChange.policy)===canonical(expected);
   if(!checks.changeReadback||!checks.changeNotSaved)throw new Error('Active policy change did not preserve the confirmation boundary');
   stage='correct-active-hours';const corrected=await connection.turn('Actually, make those appointment hours Wednesday only, eleven AM to three PM instead. Keep all the other booking rules.');turns.push(corrected);
   const wednesday={...expected,weeklyHours:[{day:3,startMinute:660,endMinute:900}]};
   checks.correctionReadback=corrected.diagnostics.some(event=>{const value=event as {type?:string;policy?:unknown};return value.type==='scheduling_policy_proposal'&&canonical(value.policy)===canonical(wednesday);});
   const beforeCorrection=await readSchedulingPolicy(env,actor);checks.correctionNotSaved=beforeCorrection.revision===1&&canonical(beforeCorrection.policy)===canonical(expected);
   if(!checks.correctionReadback||!checks.correctionNotSaved)throw new Error('Policy correction did not replace only the pending proposal');
   stage='confirm-active-hours';turns.push(await connection.turn('Yes, that is correct.'));
   const finalPolicy=await readSchedulingPolicy(env,actor);profiles.correctedPolicy=finalPolicy;
   checks.onlyCorrectionSaved=finalPolicy.revision===2&&canonical(finalPolicy.policy)===canonical(wednesday);
   connection.close();connection=await openVoice(env,actor,name,textOnly,httpOnly);
   // A transcript-only fixture can outrun the production 12-turn/minute limit.
   // Pace the thirteenth turn; do not change or clear any allowance counters.
   const probePacingMs=Math.max(0,60050-(Date.now()-scenarioStarted));
   if(probePacingMs)await pause(probePacingMs);
   stage='recall-corrected-hours';const finalRecall=await connection.turn('What are my active appointment hours now? Do not change anything.');turns.push(finalRecall);
   checks.correctedHoursRecall=/Wednesday/i.test(finalRecall.reply)&&/11|eleven/i.test(finalRecall.reply)&&/15:00|3(?:[:.]00)?\s*p|three/i.test(finalRecall.reply)&&!/Monday|Tuesday/i.test(finalRecall.reply);
   checks.correctedRecallDidNotWrite=(await readSchedulingPolicy(env,actor)).revision===2;

   const passed=Object.values(checks).every(Boolean)&&turns.every(turn=>!turn.error&&(textOnly?turn.audioBytes===0:turn.audioBytes>0)&&turn.metrics?.outcome==='completed');
   return Response.json({passed,scenario,transport:httpOnly?'http':textOnly?'text':'speech',checks,turns,profiles,probePacingMs,limitation:'Actual MayorVoice and real model with isolated D1/DO and a seeded synthetic membership. '+(textOnly?'Text-only fallback. ':'Synthetic speech input and returned audio. ')+'No live calendar, phone call, production customer mutation or acoustic/device latency measurement.'},{status:passed?200:502});
  }
  stage='spoken-proposal';
  const proposed=await connection.turn(initialFixture);turns.push(proposed);
  checks.proposalReturned=proposed.diagnostics.some(event=>(event as {type?:string}).type===proposalEvent)&&(textOnly||proposed.audioBytes>0)&&matches(proposed.reply)&&proposed.metrics?.outcome==='completed';
  const before=await readSnapshot();snapshot('beforeConfirmation',before);checks.notSavedBeforeConfirmation=before.revision===0&&Object.keys(before.profile).length===0;
  if(!checks.proposalReturned||!checks.notSavedBeforeConfirmation)throw new Error('Proposal/readback gate failed');
  stage='spoken-confirmation';turns.push(await connection.turn('Yes, that is correct.'));
  // Speech conveys the name's words, not capitalization. Do not rewrite stored data.
  const saved=await readSnapshot();snapshot('afterConfirmation',saved);checks.savedAfterConfirmation=saved.revision===1&&matches(String(saved.profile[field]??''))&&Object.keys(saved.profile).length===1;
  if(!checks.savedAfterConfirmation)throw new Error('Spoken confirmation did not save the expected profile');
  stage='spoken-correction';const correction=await connection.turn(correctionFixture);turns.push(correction);
  checks.correctionReturned=correction.diagnostics.some(event=>(event as {type?:string}).type===proposalEvent)&&(textOnly||correction.audioBytes>0)&&matches(correction.reply,true)&&correction.metrics?.outcome==='completed';
  const pendingCorrection=await readSnapshot();snapshot('beforeCorrectionConfirmation',pendingCorrection);
  checks.correctionNotSavedBeforeConfirmation=pendingCorrection.revision===1&&pendingCorrection.profile[field]===saved.profile[field];
  if(!checks.correctionReturned||!checks.correctionNotSavedBeforeConfirmation)throw new Error('Correction readback gate failed');
  stage='confirm-correction';turns.push(await connection.turn('Yes, that is correct.'));
  const corrected=await readSnapshot();snapshot('afterCorrectionConfirmation',corrected);
  checks.correctionSaved=corrected.revision===2&&matches(String(corrected.profile[field]??''),true)&&Object.keys(corrected.profile).length===1;
  if(!checks.correctionSaved)throw new Error('Spoken correction did not save the expected profile');
  stage='reconnect';connection.close();connection=await openVoice(env,actor,nickname?crypto.randomUUID():name,textOnly,httpOnly);
  if(!nickname)checks.historyRestored=connection.history.length>=8;
  if(nickname&&!textOnly){const started=Date.now(),deadline=started+25000;while(!connection.greeting.done&&!connection.greeting.errorCategory&&Date.now()<deadline)await pause(20);profiles.reconnectedGreeting={...connection.greeting,waitMs:Date.now()-started};checks.freshObjectUsesSavedName=matches(connection.greeting.reply,true)&&/AI business assistant/i.test(connection.greeting.reply)&&connection.greeting.audioBytes>0;if(!checks.freshObjectUsesSavedName)throw new Error('Fresh voice object did not introduce its confirmed saved name');}
  stage='spoken-recall';const recall=await connection.turn(nickname?'What is your assistant name?':setup?'Which time zone is saved in my scheduling setup, and are my booking rules active?':hours?'What are my business hours?':'What is my business name?');turns.push(recall);
  checks.recallAnswered=(textOnly||recall.audioBytes>0)&&matches(recall.reply,true)&&recall.metrics?.outcome==='completed';
  const afterRecall=await readSnapshot();snapshot('afterRecall',afterRecall);checks.recallDidNotWrite=afterRecall.revision===2;
  if(setup)checks.rulesRemainInactive=(await readSchedulingPolicy(env,actor)).policy===null;
  const passed=Object.values(checks).every(Boolean)&&turns.every(turn=>!turn.error&&(textOnly?turn.audioBytes===0:turn.audioBytes>0)&&turn.metrics?.outcome==='completed');
  return Response.json({passed,scenario,transport:httpOnly?'http':textOnly?'text':'speech',checks,turns,profiles,
   limitation:'Actual MayorVoice with isolated D1/DO and a seeded authenticated membership. '+(textOnly?'Text fallback only; no speech input or output. ':'Synthetic PCM input and returned audio. ')+'Excludes Google browser sign-in, microphone, acoustic playback, production customer data, calendars and phone calls.'
  },{status:passed?200:502});
 }catch(error){return Response.json({passed:false,scenario,transport:httpOnly?'http':textOnly?'text':'speech',stage,error:(error as Error).message,checks,turns,profiles},{status:502});}
 finally{connection?.close();}
}};
