import {handleMayorMcp,handleMcpTokens} from './mcp';
import {handleConnectionsRequest} from './connections';
import {runMvpMaintenance} from './mvp-maintenance';
import {syncPhoneReviewNotifications} from './phone-review-notifications';
import {runTelnyxRecovery} from './telnyx-recovery';
import {receiveTelnyxCall,connectTelnyxStream,type PhoneLifetime} from './telnyx-calls';
import { routeAgentRequest } from 'agents';
import { z } from 'zod';
import { getSession, handleAuthRequest } from './auth';
import { HttpError,json,readJson,requireOrigin,digest } from './http';
import { requireMembership,CHAT_ROLES } from './permissions';
import { readMemory,confirmProfile } from './memory';
import {verticalSchema} from './verticals';
import { onboardingProgress } from './onboarding';
import {calendarGuide} from './calendar-guide';
import {getPhoneSetup,savePhoneSetup,phoneSetupSchema,phoneSetupGuide} from './phone-setup';
import {getRecordingConsent,acknowledgeRecordingConsent,RECORDING_CONSENT_TEXT,RECORDING_CONSENT_VERSION} from './phone-recording-consent';
import type { Env } from './env';
import {calendarConnectionSchema,calendarSelectionSchema,discoverCalendars,selectCalendar,selectedCalendar} from './calendars';
import {ConnectorError} from './connectors/types';
import {readSchedulingPolicy} from './scheduling-policy';
import {readSchedulingSetup,proposeSchedulingSetup,confirmSchedulingSetup,schedulingDetailsSchema} from './scheduling-setup';
import {listBookingRequests,reconcileBooking} from './appointments';
import {listAppointments} from './appointment-changes';
import {connectTwilio,phoneConnections,twilioNumbers,selectTwilioNumber,disconnectTwilio,twilioConnectionSchema} from './phone-connections';
import {manageVoiceApplication,phoneProvider} from './phone-management';
import {receiveTwilioCall,connectTwilioStream} from './twilio-calls';
import {runAppointmentRecovery} from './recovery';
import {listNotifications,refreshAttentionNotifications,markNotificationRead} from './notifications';
import {readRecurringCheck,pauseRecurringCheck,runRecurringChecks} from './recurring-checks';
import {readEmailPreference,saveEmailPreference,emailPreferenceSchema,queueNotificationEmails,deliverNotificationEmails} from './notification-email';
import {runAttentionCycle} from './attention-cycle';
import {saveTelnyxCallSetup,telnyxCallSetupSchema,connectTelnyx,telnyxNumbers,selectTelnyxNumber,disconnectTelnyx,telnyxConnectionSchema} from './telnyx-connections';
import {gmailConnections,gmailReadSchema,readUnreadGmail} from './gmail';
import {readConversationRecovery,resetConversationRecovery} from './conversation-recovery';
import {recordMissedCall,sendTextBack,simulateTextBack,missedCallCard,listRecentMissedCalls,missedCallInputSchema} from './missed-call-textback';
import {startTelnyxConsent} from './auth/phone-oauth-state';
import {finishTelnyxConsent} from './auth/telnyx-callback';
import {telnyxOAuthConfig} from './auth/telnyx-vault';
import {handleOperationsRequest} from './operations';
import {handleBillingPublic,handleBillingRequest} from './billing';
import {runBusinessAudits} from './business-audit';
import {handleBusinessRoutinesRequest,runBusinessRoutines,routineNotifications,markRoutineBriefRead} from './business-routines';
import {handleBusinessHarnessRequest,runBusinessHarnesses,harnessNotifications,markHarnessReportRead} from './business-harness';
import {handleCouncilRequest} from './council';
import {runProactiveCycle,buildBriefing,buildRoi,setRoiConfig,roiConfigSchema,recordNoShow,noShowSchema,listSuggestionCards,sendSuggestionCard,editSuggestionCard,dismissSuggestionCard,setProactiveSettings,proactiveSettingsSchema} from './proactive';
export {MayorPhone} from './phone-voice';
export { MayorVoice } from './voice';

async function rateLimit(env:Env,subject:string,max:number) {
  const bucket=Math.floor(Date.now()/60000);
  const row=await env.AGENT_DB.prepare(`INSERT INTO mayor_rate_limits(subject,bucket,count) VALUES(?,?,1)
    ON CONFLICT(subject,bucket) DO UPDATE SET count=count+1 RETURNING count`).bind(subject,bucket).first<{count:number}>();
  if(!row||row.count>max)throw new HttpError(429,'rate_limited','Please wait a minute and try again.');
}
async function businessNotifications(env:Env,actor:{tenantId:string;userId:string}){
  const [existing,routines,harness]=await Promise.all([listNotifications(env,actor),routineNotifications(env,actor),harnessNotifications(env,actor)]);
  const notifications=[...existing.notifications,...routines,...harness].sort((left,right)=>right.createdAt.localeCompare(left.createdAt)||right.id.localeCompare(left.id));
  return {notifications:notifications.slice(0,50),hasMore:existing.hasMore||notifications.length>50};
}
async function handle(request:Request,env:Env,lifetime?:PhoneLifetime) {
  const url=new URL(request.url);
  const mcp=await handleMayorMcp(request,env);
  if(mcp)return mcp;
  const publicBilling=await handleBillingPublic(request,env);
  if(publicBilling)return publicBilling;
  if(['/business-audit','/business-audit/','/business-audit/report'].includes(url.pathname)&&request.method==='GET'){
    if(!env.ASSETS)return new Response('The audit page is not built yet.',{status:503});
    // Fetch the clean asset path: ASSETS redirects .html back to this route.
    const target=new URL('/business-audit',request.url);
    return env.ASSETS.fetch(new Request(target,request));
  }
  const telnyxIncoming=url.pathname.match(/^\/api\/phone\/telnyx\/incoming\/([a-f0-9-]{32,36})$/);
  const telnyxStream=url.pathname.match(/^\/api\/phone\/telnyx\/stream\/([a-f0-9-]{36})\/([a-f0-9]{64})$/);
  if(telnyxIncoming||telnyxStream){
    if(!lifetime)throw new HttpError(503,'phone_unavailable','Phone unavailable.');
    if(telnyxIncoming)return receiveTelnyxCall(request,env,telnyxIncoming[1],lifetime);
    return connectTelnyxStream(request,env,telnyxStream![1],telnyxStream![2],lifetime);
  }
  const incoming=url.pathname.match(/^\/api\/phone\/twilio\/incoming\/([a-f0-9]{32})$/);
  if(incoming&&request.method==='POST')return receiveTwilioCall(request,env,incoming[1]);
  const phoneVerification=url.pathname.match(/^\/api\/phone\/twilio\/verify\/([a-f0-9]{32})\/([a-f0-9-]{36})\/(send|check)\/([a-f0-9-]{36})$/);
  if(phoneVerification&&request.method==='POST')return receiveTwilioCall(request,env,phoneVerification[1],fetch,{id:phoneVerification[2],action:phoneVerification[3] as 'send'|'check',nonce:phoneVerification[4]});
  const stream=url.pathname.match(/^\/api\/phone\/twilio\/stream\/([a-f0-9-]{36})$/);
  if(stream&&request.method==='GET')return connectTwilioStream(request,env,stream[1]);
  if(url.pathname==='/api/health') return json({service:'The Mayor',status:'ok',environment:env.ENVIRONMENT});
  if(url.pathname==='/api/phone-guide'&&request.method==='GET'){
    const input=phoneSetupSchema.parse({mode:url.searchParams.get('mode')??'new',...(url.searchParams.has('provider')?{provider:url.searchParams.get('provider')}:{})});
    return json(phoneSetupGuide(input));
  }
  if(url.pathname==='/api/auth/callback/telnyx'&&request.method==='GET'){
    const session=await getSession(request,env);
    if(session)await rateLimit(env,session.user.id,60);
    return finishTelnyxConsent(request,env,session);
  }
  if(url.pathname.startsWith('/api/auth/'))return handleAuthRequest(request,env);
  if(!url.pathname.startsWith('/api/')&&!url.pathname.startsWith('/agents/'))return env.ASSETS?env.ASSETS.fetch(request):new Response('The Mayor frontend is not built yet.',{status:503});
  const session=await getSession(request,env);
  if(!session)throw new HttpError(401,'authentication_required','Sign in to talk to The Mayor.');
  if(request.method!=='GET'||url.pathname.startsWith('/agents/'))requireOrigin(request,env.APP_ORIGIN);
  await rateLimit(env,session.user.id,60);
  const businessRoute=url.pathname.match(/^\/api\/businesses\/([a-f0-9]{32})\//);
  if(businessRoute){
    const actor={tenantId:businessRoute[1],userId:session.user.id};
    const connections=await handleConnectionsRequest(request,env,actor);
    if(connections)return connections;
    const mcpTokens=await handleMcpTokens(request,env,actor);
    if(mcpTokens)return mcpTokens;
    const billing=await handleBillingRequest(request,env,actor);
    if(billing)return billing;
    const routines=await handleBusinessRoutinesRequest(request,env,actor);
    if(routines)return routines;
    const harness=await handleBusinessHarnessRequest(request,env,actor);
    if(harness)return harness;
    const operations=await handleOperationsRequest(request,env,actor);
    if(operations)return operations;
  }
  const conversation=url.pathname.match(/^\/api\/businesses\/([a-f0-9]{32})\/conversation$/);
  if(conversation){
    const tenantId=conversation[1],identity={tenantId,userId:session.user.id,sessionId:session.session.id};
    await requireMembership(env,identity,CHAT_ROLES);
    if(request.method==='GET')return json(await readConversationRecovery(env,identity));
    if(request.method==='POST'){
      const input=z.object({requestId:z.uuid(),text:z.string().trim().min(1).max(4000)}).strict().parse(await readJson(request,20000));
      const name=await digest(`${tenantId}:${session.user.id}`),headers=new Headers({'content-type':'application/json'});
      headers.set('x-mayor-tenant',tenantId);headers.set('x-mayor-user',session.user.id);headers.set('x-mayor-session',session.session.id);
      return await routeAgentRequest(new Request(`${env.APP_ORIGIN}/agents/mayor-voice/${name}/chat`,{method:'POST',headers,body:JSON.stringify(input)}),{...env,MayorVoice:env.MAYOR_VOICE},{routingRetry:false})??json({message:'Conversation is temporarily unavailable.'},503);
    }
  }
  const conversationReset=url.pathname.match(/^\/api\/businesses\/([a-f0-9]{32})\/conversation\/reset$/);
  if(conversationReset&&request.method==='POST'){
    const tenantId=conversationReset[1],identity={tenantId,userId:session.user.id,sessionId:session.session.id};
    await requireMembership(env,identity,CHAT_ROLES);
    const name=await digest(`${tenantId}:${session.user.id}`),headers=new Headers({'content-type':'application/json'});
    headers.set('x-mayor-tenant',tenantId);headers.set('x-mayor-user',session.user.id);headers.set('x-mayor-session',session.session.id);
    // Reset the live agent thread first; the recovery snapshot is archived
    // only after the live thread is confirmed fresh, so a failure changes nothing.
    let live:Response|null=null;
    try{live=await routeAgentRequest(new Request(`${env.APP_ORIGIN}/agents/mayor-voice/${name}/reset`,{method:'POST',headers}),{...env,MayorVoice:env.MAYOR_VOICE},{routingRetry:false});}catch{live=null;}
    if(live&&live.status===409)throw new HttpError(409,'voice_call_active','End the voice conversation before starting a new chat.');
    if(!live||!live.ok)throw new HttpError(502,'conversation_reset_failed','Could not start a new conversation. Your conversation is unchanged — try again.');
    return json(await resetConversationRecovery(env,identity));
  }
  const council=url.pathname.match(/^\/api\/businesses\/([a-f0-9]{32})\/council$/);
  if(council){
    const tenantId=council[1],identity={tenantId,userId:session.user.id,sessionId:session.session.id};
    return handleCouncilRequest(request,env,identity);
  }
  if(url.pathname==='/api/businesses'&&request.method==='GET') {
    const result=await env.AGENT_DB.prepare(`SELECT t.id,t.name,m.role FROM agent_tenants t JOIN agent_memberships m ON m.tenant_id=t.id
      WHERE m.user_id=? AND m.status='active' AND (m.expires_at IS NULL OR m.expires_at>?) AND t.status='active'`).bind(session.user.id,new Date().toISOString()).all();
    return json({businesses:result.results});
  }
  if(url.pathname==='/api/businesses'&&request.method==='POST') {
    const input=z.object({name:z.string().trim().min(1).max(160)}).strict().parse(await readJson(request,2048));
    // A stable initial workspace prevents repeated start clicks creating duplicates.
    const id=(await digest(`mayor-first-business:${session.user.id}`)).slice(0,32);
    const now=new Date().toISOString();
    await env.AGENT_DB.batch([
      env.AGENT_DB.prepare("INSERT OR IGNORE INTO agent_tenants(id,name,status,created_at) VALUES(?,?,'active',?)").bind(id,input.name,now),
      env.AGENT_DB.prepare("INSERT OR IGNORE INTO agent_memberships(tenant_id,user_id,role,status) VALUES(?,?,'owner','active')").bind(id,session.user.id),
    ]);
    return json({id},201);
  }
  const gmail=url.pathname.match(/^\/api\/businesses\/([a-f0-9]{32})\/gmail(?:\/(unread))?$/);
  if(gmail){const actor={tenantId:gmail[1],userId:session.user.id};
    if(!gmail[2]&&request.method==='GET')return json(await gmailConnections(env,actor));
    if(gmail[2]==='unread'&&request.method==='POST')return json(await readUnreadGmail(env,actor,gmailReadSchema.parse(await readJson(request,2048))));
  }
  const profile=url.pathname.match(/^\/api\/businesses\/([a-f0-9]{32})\/profile$/);
  const emailPreference=url.pathname.match(/^\/api\/businesses\/([a-f0-9]{32})\/email-preferences$/);
  if(emailPreference){
    const actor={tenantId:emailPreference[1],userId:session.user.id};
    if(request.method==='GET')return json(await readEmailPreference(env,actor));
    if(request.method==='POST')return json(await saveEmailPreference(env,actor,emailPreferenceSchema.parse(await readJson(request,1024))));
  }
  const recurring=url.pathname.match(/^\/api\/businesses\/([a-f0-9]{32})\/recurring-check(?:\/(pause))?$/);
  if(recurring){
    const actor={tenantId:recurring[1],userId:session.user.id};
    if(!recurring[2]&&request.method==='GET')return json(await readRecurringCheck(env,actor));
    if(recurring[2]==='pause'&&request.method==='POST')return json(await pauseRecurringCheck(env,actor));
  }
  const notifications=url.pathname.match(/^\/api\/businesses\/([a-f0-9]{32})\/notifications(?:\/(refresh|[a-f0-9-]{36}\/read))?$/);
  if(notifications){
    const actor={tenantId:notifications[1],userId:session.user.id},action=notifications[2];
    if(!action&&request.method==='GET')return json(await businessNotifications(env,actor));
    if(action==='refresh'&&request.method==='POST'){await refreshAttentionNotifications(env,actor);return json(await businessNotifications(env,actor));}
    if(action?.endsWith('/read')&&request.method==='POST'){const id=z.uuid().parse(action.slice(0,-5));return json(await markHarnessReportRead(env,actor,id)??await markRoutineBriefRead(env,actor,id)??await markNotificationRead(env,actor,id));}
  }
  const missedCalls=url.pathname.match(/^\/api\/businesses\/([a-f0-9]{32})\/missed-calls(?:\/([a-f0-9-]{36})\/(text-back)?)?$/);
  if(missedCalls){
    const actor={tenantId:missedCalls[1],userId:session.user.id},callId=missedCalls[2],action=missedCalls[3];
    if(!callId&&request.method==='GET')return json({missedCalls:await listRecentMissedCalls(env,actor)});
    if(callId&&!action&&request.method==='GET')return json(await missedCallCard(env,actor,callId));
    if(callId&&action==='text-back'&&request.method==='POST')return json(await sendTextBack(env,actor,callId));
  }
  const testMissedCall=url.pathname.match(/^\/api\/businesses\/([a-f0-9]{32})\/phone\/test-missed-call$/);
  if(testMissedCall&&request.method==='POST'){
    const actor={tenantId:testMissedCall[1],userId:session.user.id};
    const input=missedCallInputSchema.parse({...(await readJson(request,2048) as Record<string,unknown>),source:'test'});
    const call=await recordMissedCall(env,actor,input);
    return json({test:true,missedCall:call,note:'TEST ONLY — no real customer was contacted unless a real number was provided.'});
  }
  const testTextBack=url.pathname.match(/^\/api\/businesses\/([a-f0-9]{32})\/phone\/test-missed-call\/([a-f0-9-]{36})\/text-back$/);
  if(testTextBack&&request.method==='POST'){
    const actor={tenantId:testTextBack[1],userId:session.user.id};
    return json(await simulateTextBack(env,actor,testTextBack[2]));
  }
  const schedulingSetup=url.pathname.match(/^\/api\/businesses\/([a-f0-9]{32})\/scheduling-setup(?:\/(propose|confirm|activate))?$/);
  if(schedulingSetup){
    const actor={tenantId:schedulingSetup[1],userId:session.user.id},action=schedulingSetup[2];
    if(!action&&request.method==='GET')return json(await readSchedulingSetup(env,actor));
    if(action==='propose'&&request.method==='POST')return json(await proposeSchedulingSetup(env,actor,schedulingDetailsSchema.partial().parse(await readJson(request,4096))));
    if(action==='confirm'&&request.method==='POST'){
      const proposal=await proposeSchedulingSetup(env,actor,schedulingDetailsSchema.partial().parse(await readJson(request,4096)));
      return json(await confirmSchedulingSetup(env,actor,proposal));
    }
  }
  const telnyxSetup=url.pathname.match(/^\/api\/businesses\/([a-f0-9]{32})\/phone-connections\/telnyx\/test-setup$/);
  if(telnyxSetup&&request.method==='POST')return json(await saveTelnyxCallSetup(env,{tenantId:telnyxSetup[1],userId:session.user.id},telnyxCallSetupSchema.parse(await readJson(request,2048))));
  const phoneManagement=url.pathname.match(/^\/api\/businesses\/([a-f0-9]{32})\/phone-connections\/(twilio|telnyx)\/application$/);
  if(phoneManagement&&(request.method==='GET'||request.method==='POST')){
    if(request.method==='POST')z.object({confirm:z.literal('prepare_application')}).strict().parse(await readJson(request,256));
    return json(await manageVoiceApplication(env,{tenantId:phoneManagement[1],userId:session.user.id},phoneProvider.parse(phoneManagement[2]),request.method==='POST'));
  }
  const phoneConnection=url.pathname.match(/^\/api\/businesses\/([a-f0-9]{32})\/phone-connections(?:\/(twilio|telnyx)\/(connect|numbers|select|disconnect|authorize))?$/);
  if(phoneConnection){
    const actor={tenantId:phoneConnection[1],userId:session.user.id},provider=phoneConnection[2],action=phoneConnection[3];
    if(!action&&request.method==='GET')return json(await phoneConnections(env,actor));
    if(action==='numbers'&&request.method==='GET')return json(await (provider==='telnyx'?telnyxNumbers:twilioNumbers)(env,actor));
    if(request.method==='POST'){
      if(action==='authorize'&&provider==='telnyx')return json(await startTelnyxConsent(request,env,session,actor.tenantId,telnyxOAuthConfig(env)));
      if(action==='connect'){const input=await readJson(request,2048);return json(provider==='telnyx'?await connectTelnyx(env,actor,telnyxConnectionSchema.parse(input)):await connectTwilio(env,actor,twilioConnectionSchema.parse(input)));}
      if(action==='select'){const input=z.object({id:z.string().max(64)}).strict().parse(await readJson(request,1024));return json(await (provider==='telnyx'?selectTelnyxNumber:selectTwilioNumber)(env,actor,input.id));}
      if(action==='disconnect')return json(await (provider==='telnyx'?disconnectTelnyx:disconnectTwilio)(env,actor));
    }
  }
  const recordingConsent=url.pathname.match(/^\/api\/businesses\/([a-f0-9]{32})\/phone-connections\/recording-consent$/);
  if(recordingConsent){
    const actor={tenantId:recordingConsent[1],userId:session.user.id};
    if(request.method==='GET')return json({text:RECORDING_CONSENT_TEXT,version:RECORDING_CONSENT_VERSION,...await getRecordingConsent(env,actor)});
    if(request.method==='POST'){z.object({acknowledged:z.literal(true)}).strict().parse(await readJson(request,256));return json(await acknowledgeRecordingConsent(env,actor));}
  }
  const appointments=url.pathname.match(/^\/api\/businesses\/([a-f0-9]{32})\/appointments$/);
  if(appointments&&request.method==='GET')return json({appointments:await listAppointments(env,{tenantId:appointments[1],userId:session.user.id},url.searchParams.has('customerId')?z.uuid().parse(url.searchParams.get('customerId')):undefined)});
  // Crew 3 proactive engine: briefing, ROI, suggestion cards, proactive settings.
  const briefing=url.pathname.match(/^\/api\/businesses\/([a-f0-9]{32})\/briefing$/);
  if(briefing&&request.method==='GET')return json(await buildBriefing(env,{tenantId:briefing[1],userId:session.user.id}));
  const roi=url.pathname.match(/^\/api\/businesses\/([a-f0-9]{32})\/roi(?:\/(config|no-show))?$/);
  if(roi){
   const actor={tenantId:roi[1],userId:session.user.id},action=roi[2];
   if(!action&&request.method==='GET')return json(await buildRoi(env,actor,url.searchParams.get('month')??undefined));
   if(action==='config'&&request.method==='POST')return json(await setRoiConfig(env,actor,roiConfigSchema.parse(await readJson(request,1024))));
   if(action==='no-show'&&request.method==='POST')return json(await recordNoShow(env,actor,noShowSchema.parse(await readJson(request,1024))));
  }
  const suggestions=url.pathname.match(/^\/api\/businesses\/([a-f0-9]{32})\/suggestions(?:\/([a-f0-9-]{36})\/(send|edit|dismiss))?$/);
  if(suggestions){
   const actor={tenantId:suggestions[1],userId:session.user.id},cardId=suggestions[2],action=suggestions[3];
   if(!cardId&&request.method==='GET')return json(await listSuggestionCards(env,actor));
   if(cardId&&action==='send'&&request.method==='POST')return json(await sendSuggestionCard(env,actor,cardId));
   if(cardId&&action==='edit'&&request.method==='POST')return json(await editSuggestionCard(env,actor,cardId,z.object({message:z.string().trim().min(1).max(320)}).strict().parse(await readJson(request,2048)).message));
   if(cardId&&action==='dismiss'&&request.method==='POST')return json(await dismissSuggestionCard(env,actor,cardId));
  }
  const proactiveSettings=url.pathname.match(/^\/api\/businesses\/([a-f0-9]{32})\/proactive\/settings$/);
  if(proactiveSettings&&request.method==='POST')return json(await setProactiveSettings(env,{tenantId:proactiveSettings[1],userId:session.user.id},proactiveSettingsSchema.parse(await readJson(request,512))));
  const bookings=url.pathname.match(/^\/api\/businesses\/([a-f0-9]{32})\/bookings(?:\/([a-f0-9-]{36})\/check)?$/);
  if(bookings){
    const actor={tenantId:bookings[1],userId:session.user.id};
    if(!bookings[2]&&request.method==='GET')return json({bookings:await listBookingRequests(env,actor)});
    if(bookings[2]&&request.method==='POST')return json(await reconcileBooking(env,actor,bookings[2]));
  }
  const policy=url.pathname.match(/^\/api\/businesses\/([a-f0-9]{32})\/scheduling-policy$/);
  if(policy&&request.method==='GET'){const actor={tenantId:policy[1],userId:session.user.id};return json({...await readSchedulingPolicy(env,actor),setup:await readSchedulingSetup(env,actor)});}
  const guide=url.pathname.match(/^\/api\/businesses\/([a-f0-9]{32})\/calendars\/guide$/);
  if(guide&&request.method==='POST'){
    const input=z.object({website:z.string().max(2048).optional(),provider:z.enum(['google','microsoft','zoho']).optional()}).strict().parse(await readJson(request,4096));
    return json(await calendarGuide(env,{tenantId:guide[1],userId:session.user.id},input.website,fetch,input.provider));
  }
  const calendars=url.pathname.match(/^\/api\/businesses\/([a-f0-9]{32})\/calendars\/(discover|selected)$/);
  if(calendars){
    const actor={tenantId:calendars[1],userId:session.user.id};
    if(calendars[2]==='selected'&&request.method==='GET')return json({selection:await selectedCalendar(env,actor)});
    if(request.method==='POST'){
      const body=await readJson(request,4096);
      if(calendars[2]==='discover'){const result=await discoverCalendars(env,actor,calendarConnectionSchema.parse(body));return json({calendars:result.calendars});}
      return json(await selectCalendar(env,actor,calendarSelectionSchema.parse(body)));
    }
  }
  if(profile&&request.method==='GET'){const memory=await readMemory(env,{tenantId:profile[1],userId:session.user.id});return json({...memory,progress:onboardingProgress(memory.profile)});}
  if(profile&&request.method==='POST'){
    const actor={tenantId:profile[1],userId:session.user.id};
    const {revision,vertical}=z.object({vertical:verticalSchema,revision:z.number().int().min(0)}).strict().parse(await readJson(request,1024));
    return json(await confirmProfile(env,actor,{vertical},revision));
  }
  const phoneSetup=url.pathname.match(/^\/api\/businesses\/([a-f0-9]{32})\/phone-setup$/);
  if(phoneSetup){
    const actor={tenantId:phoneSetup[1],userId:session.user.id};
    if(request.method==='GET')return json({setup:await getPhoneSetup(env,actor)});
    if(request.method==='POST')return json(await savePhoneSetup(env,actor,phoneSetupSchema.parse(await readJson(request,2048))));
  }
  const voice=url.pathname.match(/^\/agents\/mayor-voice\/([a-f0-9]{64})$/);
  if(voice&&request.method==='GET'&&request.headers.get('upgrade')?.toLowerCase()==='websocket') {
    const tenantId=url.searchParams.get('business')??'';
    await requireMembership(env,{tenantId,userId:session.user.id},CHAT_ROLES);
    const name=await digest(`${tenantId}:${session.user.id}`);
    if(name!==voice[1])throw new HttpError(404,'not_found','Conversation unavailable.');
    const headers=new Headers(request.headers);
    headers.set('x-mayor-tenant',tenantId);headers.set('x-mayor-user',session.user.id);headers.set('x-mayor-session',session.session.id);
    const routed=await routeAgentRequest(new Request(request,{headers}),{...env,MayorVoice:env.MAYOR_VOICE},{routingRetry:false});
    return routed??json({error:'not_found'},404);
  }
  if(url.pathname==='/api/voice/session'&&request.method==='POST') {
    const input=z.object({tenantId:z.string().regex(/^[a-f0-9]{32}$/)}).strict().parse(await readJson(request,2048));
    await requireMembership(env,{tenantId:input.tenantId,userId:session.user.id},CHAT_ROLES);
    return json({agent:'mayor-voice',name:await digest(`${input.tenantId}:${session.user.id}`),business:input.tenantId});
  }
  return json({error:'not_found'},404);
}
export default {async fetch(request:Request,env:Env,context?:ExecutionContext) {
  try{
    const response=await handle(request,env,context);
    if(response.status===101)return response;
    const secured=new Response(response.body,response);
    secured.headers.set('x-content-type-options','nosniff');
    secured.headers.set('referrer-policy','no-referrer');
    secured.headers.set('x-frame-options','DENY');
    const path=new URL(request.url).pathname;
    if(['/business-audit','/business-audit/','/business-audit/report','/business-audit.html'].includes(path))secured.headers.set('cache-control','no-store');
    if(path==='/business-audit/report')secured.headers.set('x-robots-tag','noindex, nofollow, noarchive');
    return secured;
  }catch(error){
    if(error instanceof HttpError)return json({error:error.code,message:error.message},error.status);
    if(error instanceof z.ZodError)return json({error:'invalid_input'},400);
    if(error instanceof ConnectorError){
      if(error.operation==='google.gmail.read'){console.warn(JSON.stringify({event:'gmail_provider_failure',kind:error.kind,status:error.status??null}));return json({error:error.kind,message:'Gmail could not complete this read. Review your connection and try again.'},error.kind==='rate_limited'?429:502);}
      console.warn(JSON.stringify({event:'calendar_provider_failure',operation:error.operation,kind:error.kind,status:error.status??null}));
      return json({error:error.kind,message:'The calendar provider could not verify this request. Refresh the connection and try again.'},error.kind==='rate_limited'?429:502);
    }
    // Never log provider payloads, credentials, transcripts, or raw exception objects.
    console.error(JSON.stringify({event:'request_failed',path:new URL(request.url).pathname.startsWith('/api/phone/')?'/api/phone/[redacted]':new URL(request.url).pathname}));
    return json({error:'request_failed',message:'Something went wrong. Please try again.'},500);
  }
},async scheduled(_controller,env,context){
  context.waitUntil(runBusinessAudits(env).then(summary=>console.log(JSON.stringify({event:'business_audit_cycle',...summary}))).catch(()=>console.error(JSON.stringify({event:'business_audit_cycle_failed'}))));
  context.waitUntil(runMvpMaintenance(env).catch(()=>console.error(JSON.stringify({event:'mvp_maintenance_failed'}))));
  context.waitUntil(runAttentionCycle({checks:async()=>{
    const results=await Promise.allSettled([runRecurringChecks(env),runTelnyxRecovery(env),runBusinessRoutines(env),runBusinessHarnesses(env)]);
    await syncPhoneReviewNotifications(env);
    if(results.some(result=>result.status==='rejected'))throw new Error('Account checks incomplete');
    return results.map(result=>result.status==='fulfilled'?result.value:null);
  },queue:()=>queueNotificationEmails(env),delivery:()=>deliverNotificationEmails(env)},(stage,result)=>{
    const event={event:'attention_cycle',stage,...result};
    if(result.ok)console.log(JSON.stringify(event));else console.error(JSON.stringify(event));
  }));
  context.waitUntil(runAppointmentRecovery(env).then(summary=>{console.log(JSON.stringify({event:'appointment_recovery',...summary}));}).catch(()=>{console.error(JSON.stringify({event:'appointment_recovery_failed'}));throw new Error('Appointment recovery failed.');}));
  context.waitUntil(runProactiveCycle(env).then(summary=>{console.log(JSON.stringify({event:'proactive_cycle',...summary}));}).catch(()=>{console.error(JSON.stringify({event:'proactive_cycle_failed'}));}));
}} satisfies ExportedHandler<Env>;
