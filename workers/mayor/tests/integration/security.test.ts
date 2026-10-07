import {env as testEnv} from 'cloudflare:workers';
import {beforeAll,describe,it,expect} from 'vitest';
import worker from '../../src';
import {createAuth,handleAuthRequest} from '../../src/auth';
import {encryptCredential,decryptCredential} from '../../src/auth/vault';
import {confirmProfile,readMemory} from '../../src/memory';
import type {Env} from '../../src/env';
import {discoverCalendars,selectCalendar,selectedCalendar} from '../../src/calendars';
import {confirmSchedulingPolicy,readSchedulingPolicy,type SchedulingPolicy} from '../../src/scheduling-policy';
import {proposeBooking,confirmBooking,reconcileBooking,listBookingRequests} from '../../src/appointments';
import {stableId} from '../../src/connectors/http';
import {connectTwilio,phoneConnections,twilioNumbers,selectTwilioNumber,disconnectTwilio} from '../../src/phone-connections';
import {receiveTwilioCall,connectTwilioStream,validTwilioSignature} from '../../src/twilio-calls';
import {connectTelnyx,telnyxNumbers,selectTelnyxNumber,disconnectTelnyx} from '../../src/telnyx-connections';
const env=testEnv as unknown as Env;
const origin='https://mayor.example.test';
let cookieA='',cookieB='',userA='',userB='',tenantA='';
function request(path:string,cookie='',body?:unknown,requestOrigin=origin){return new Request(origin+path,{method:body===undefined?'GET':'POST',headers:{origin:requestOrigin,cookie,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});}
async function signedSession(email:string){
  const ctx=await createAuth(env).$context;
  const user=await ctx.internalAdapter.createUser({email,name:'Fixture user',emailVerified:true});
  const session=await ctx.internalAdapter.createSession(user.id);
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.BETTER_AUTH_SECRET!),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const signature=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(session.token));
  const signed=encodeURIComponent(`${session.token}.${btoa(String.fromCharCode(...new Uint8Array(signature)))}`);
  return {userId:user.id,cookie:`__Secure-mehyar-agent.session_token=${signed}`};
}
beforeAll(async()=>{
  const a=await signedSession('a@example.test'),b=await signedSession('b@example.test');cookieA=a.cookie;cookieB=b.cookie;userA=a.userId;userB=b.userId;
  const response=await worker.fetch(request('/api/businesses',cookieA,{name:'Fixture business'}),env,{} as ExecutionContext);
  expect(response.status).toBe(201);tenantA=(await response.json() as {id:string}).id;
});
describe('real D1 auth and business boundaries',()=>{
  it('refuses phone provider redirects without saving credentials or following the target',async()=>{
    const actor={tenantId:tenantA,userId:userA};
    const input={accountSid:'AC'+'a'.repeat(32),apiKeySid:'SK'+'b'.repeat(32),apiKeySecret:'c'.repeat(32)};
    const before=await env.AGENT_DB.prepare('SELECT * FROM mayor_phone_connections WHERE tenant_id=?').bind(tenantA).all();
    for(const provider of ['twilio','verify','telnyx']){
      let calls=0;
      const transport=(async(url:RequestInfo|URL,init?:RequestInit)=>{
        calls++;expect(init?.redirect).toBe('manual');
        expect(new URL(String(url)).hostname).toBe(provider==='verify'?'verify.twilio.com':`api.${provider}.com`);
        return new Response(null,{status:302,headers:{location:'https://attacker.test/credentials'}});
      }) as typeof fetch;
      await expect(provider==='telnyx'?connectTelnyx(env,actor,{apiKey:'KEY_fixture_only_redirect'},transport):connectTwilio(env,actor,{...input,...(provider==='verify'?{authToken:'d'.repeat(32),testCaller:'+12025550123',verifyServiceSid:'VA'+'e'.repeat(32)}:{})},transport)).rejects.toThrow();
      expect(calls).toBe(1);
    }
    expect((await env.AGENT_DB.prepare('SELECT * FROM mayor_phone_connections WHERE tenant_id=?').bind(tenantA).all()).results).toEqual(before.results);
  });
  it('stores Telnyx keys encrypted, checks number voice settings, and rejects cross-tenant access',async()=>{
    const actor={tenantId:tenantA,userId:userA},input={apiKey:'KEY_fixture_only_1234567890'},id='1293384261075731499';
    let status='active',voiceId=id,reads=0;
    const transport=(async(url:RequestInfo|URL,init?:RequestInit)=>{
      reads++;const target=new URL(String(url));expect(target.origin).toBe('https://api.telnyx.com');expect(init?.method).toBe('GET');expect(init?.redirect).toBe('manual');expect(new Headers(init?.headers).get('authorization')).toBe('Bearer '+input.apiKey);
      const number={id,phone_number:'+12025550109',status};
      return Response.json(target.pathname.endsWith('/voice')?{data:{...number,id:voiceId}}:target.search?{data:[number],meta:{page_number:1,total_pages:1}}:{data:number});
    }) as typeof fetch;
    const connected=await connectTelnyx(env,actor,input,transport);expect(connected.callsReady).toBe(false);expect(JSON.stringify(connected)).not.toContain(input.apiKey);
    const row=await env.AGENT_DB.prepare("SELECT * FROM mayor_phone_connections WHERE tenant_id=? AND provider='telnyx'").bind(tenantA).first<any>();
    expect(row.ciphertext).toMatch(/^v1\./);expect(JSON.stringify(row)).not.toContain(input.apiKey);
    expect((await telnyxNumbers(env,actor,transport)).numbers[0].id).toBe(id);
    const before=reads;await expect(telnyxNumbers(env,{tenantId:tenantA,userId:userB},transport)).rejects.toThrow();expect(reads).toBe(before);
    await expect(selectTelnyxNumber(env,actor,'../evil',transport)).rejects.toThrow();expect(reads).toBe(before);
    status='purchase-pending';await expect(selectTelnyxNumber(env,actor,id,transport)).rejects.toThrow();status='active';
    voiceId='other';await expect(selectTelnyxNumber(env,actor,id,transport)).rejects.toThrow();voiceId=id;
    expect(await selectTelnyxNumber(env,actor,id,transport)).toMatchObject({selected:true,callsReady:false,routingChanged:false});
    await env.AGENT_DB.prepare("UPDATE mayor_phone_connections SET account_id='tampered' WHERE id=?").bind(row.id).run();
    const preTamperRead=reads;await expect(telnyxNumbers(env,actor,transport)).rejects.toThrow('Reconnect');expect(reads).toBe(preTamperRead);
    await disconnectTelnyx(env,actor);
    expect(await env.AGENT_DB.prepare('SELECT ciphertext,status,selected_number FROM mayor_phone_connections WHERE id=?').bind(row.id).first()).toMatchObject({ciphertext:'',status:'revoked',selected_number:null});
  });
  it('completes Telnyx pagination, handles empty new accounts, and rejects malformed pages',async()=>{
    const actor={tenantId:tenantA,userId:userA},input={apiKey:'KEY_fixture_only_pagination'},pages:number[]=[];
    const transport=(async(url:RequestInfo|URL)=>{const page=Number(new URL(String(url)).searchParams.get('page[number]'));pages.push(page);return Response.json({data:[{id:String(page),phone_number:'+1202555010'+page,status:'active'}],meta:{page_number:page,total_pages:2}});}) as typeof fetch;
    expect((await connectTelnyx(env,actor,input,transport)).numbers).toHaveLength(2);expect(pages).toEqual([1,2]);
    const malformed=(async()=>Response.json({data:[],meta:{page_number:9,total_pages:10}})) as typeof fetch;
    await expect(connectTelnyx(env,actor,input,malformed)).rejects.toThrow();
    const empty=(async()=>Response.json({data:[],meta:{page_number:1,total_pages:0}})) as typeof fetch;
    expect((await connectTelnyx(env,actor,input,empty)).numbers).toEqual([]);
    await disconnectTelnyx(env,actor);
  });
  it('does not select a Telnyx number after disconnection during provider reads',async()=>{
    const actor={tenantId:tenantA,userId:userA},input={apiKey:'KEY_fixture_only_revocation'},number={id:'1293384261075731499',phone_number:'+12025550109',status:'active'};
    const transport=(async()=>Response.json({data:[number],meta:{page_number:1,total_pages:1}})) as typeof fetch;
    await connectTelnyx(env,actor,input,transport);
    const racing=(async(url:RequestInfo|URL)=>{if(String(url).endsWith('/voice'))await disconnectTelnyx(env,actor);return Response.json({data:number});}) as typeof fetch;
    await expect(selectTelnyxNumber(env,actor,number.id,racing)).rejects.toThrow();
    expect(await env.AGENT_DB.prepare("SELECT status,selected_number FROM mayor_phone_connections WHERE tenant_id=? AND provider='telnyx'").bind(tenantA).first()).toMatchObject({status:'revoked',selected_number:null});
  });
  it('authenticates designated live Twilio calls and admits a media stream only once',async()=>{
    const actor={tenantId:tenantA,userId:userA},configured={...env,PHONE_TEST_ENABLED:'true'};
    const credential={accountSid:'AC'+'1'.repeat(32),apiKeySid:'SK'+'2'.repeat(32),apiKeySecret:'3'.repeat(32),authToken:'4'.repeat(32),testCaller:'+12025550123'};
    const number={sid:'PN'+'5'.repeat(32),account_sid:credential.accountSid,phone_number:'+12025550101',capabilities:{voice:true}};
    const callSid='CA'+'6'.repeat(32);let live=true,reads=0;
    const transport=(async(url:RequestInfo|URL)=>{reads++;const path=new URL(String(url)).pathname;return Response.json(path.includes('/Calls/')?{sid:callSid,account_sid:credential.accountSid,from:credential.testCaller,to:number.phone_number,direction:'inbound',status:live?'ringing':'completed'}:path.endsWith('/IncomingPhoneNumbers.json')?{incoming_phone_numbers:[number],next_page_uri:null}:number);}) as typeof fetch;
    await connectTwilio(configured,actor,credential,transport);await selectTwilioNumber(configured,actor,number.sid,transport);
    const url=origin+`/api/phone/twilio/incoming/${tenantA}`;
    const params=new URLSearchParams({AccountSid:credential.accountSid,CallSid:callSid,From:credential.testCaller,To:number.phone_number});
    const sign=async(target:string,body:URLSearchParams)=>{
      const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(credential.authToken),{name:'HMAC',hash:'SHA-1'},false,['sign']);
      const text=target+[...body.keys()].sort().map(k=>k+body.get(k)).join('');
      return btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(text)))));
    };
    const signature=await sign(url,params);
    const incoming=()=>new Request(url,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded','x-twilio-signature':signature},body:params});
    expect(await validTwilioSignature(credential.authToken,url+'/tampered',params,signature)).toBe(false);
    const duplicate=new URLSearchParams(params);duplicate.append('From','other');expect(await validTwilioSignature(credential.authToken,url,duplicate,signature)).toBe(false);
    const before=reads;await expect(receiveTwilioCall(incoming(),env,tenantA,transport)).rejects.toThrow();expect(reads).toBe(before);
    live=false;await expect(receiveTwilioCall(incoming(),configured,tenantA,transport)).rejects.toThrow();live=true;
    const xml=await (await receiveTwilioCall(incoming(),configured,tenantA,transport)).text();expect(xml).toContain('an AI assistant');
    expect(await (await receiveTwilioCall(incoming(),configured,tenantA,transport)).text()).toBe(xml);
    const streamPath=xml.match(/\/api\/phone\/twilio\/stream\/[a-f0-9-]{36}/)![0],id=streamPath.split('/').pop()!;
    expect(await env.AGENT_DB.prepare('SELECT caller_number FROM mayor_phone_calls WHERE id=?').bind(id).first()).toEqual({caller_number:credential.testCaller});
    let internalCall='';
    const namespace={idFromName:()=>({}),get:()=>({fetch:async(request:Request)=>{
      internalCall=request.headers.get('x-mayor-call')??'';expect(request.headers.get('x-mayor-user')).toBeNull();
      const pair=new WebSocketPair();pair[1].accept();pair[1].addEventListener('message',()=>pair[1].send(JSON.stringify({type:'status',status:'listening'})));pair[1].addEventListener('close',()=>pair[1].close());
      return new Response(null,{status:101,webSocket:pair[0]});
    }})};
    const mediaEnv={...configured,MAYOR_PHONE:namespace as unknown as Env['MAYOR_PHONE']};
    const mediaUrl=origin+streamPath,mediaSignature=await sign(mediaUrl,new URLSearchParams());
    const media=()=>new Request(mediaUrl,{headers:{upgrade:'websocket','x-twilio-signature':mediaSignature}});
    await expect(connectTwilioStream(new Request(mediaUrl,{headers:{upgrade:'websocket'}}),mediaEnv,id)).rejects.toThrow();
    const response=await connectTwilioStream(media(),mediaEnv,id);expect(response.status).toBe(101);const socket=response.webSocket!;socket.accept();
    const received=new Promise<string>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('adapter_timeout')),2000);socket.addEventListener('message',event=>{clearTimeout(timer);resolve(String(event.data));},{once:true});});
    socket.send(JSON.stringify({event:'start',streamSid:'MZfixture',start:{callSid}}));expect(await received).toContain('listening');expect(internalCall).toBe(id);
    await expect(connectTwilioStream(media(),mediaEnv,id)).rejects.toThrow();socket.close();
  });
  it('encrypts Twilio keys, selects only verified owned voice numbers, and revokes without exposing secrets',async()=>{
    const actor={tenantId:tenantA,userId:userA};
    const input={accountSid:'AC'+'a'.repeat(32),apiKeySid:'SK'+'b'.repeat(32),apiKeySecret:'c'.repeat(32)};
    const number={sid:'PN'+'d'.repeat(32),account_sid:input.accountSid,phone_number:'+12025550101',capabilities:{voice:true}};
    let calls=0,revokeDuringRead=false;
    const transport=(async(url:RequestInfo|URL,init?:RequestInit)=>{
      calls++;expect(new URL(String(url)).origin).toBe('https://api.twilio.com');expect(String(url)).not.toContain(input.apiKeySecret);expect(init?.method).toBe('GET');expect(init?.redirect).toBe('manual');
      if(revokeDuringRead)await disconnectTwilio(env,actor);
      return Response.json(new URL(String(url)).pathname.endsWith('/IncomingPhoneNumbers.json')?{incoming_phone_numbers:[number],next_page_uri:null}:number);
    }) as typeof fetch;
    await expect(connectTwilio(env,{...actor,userId:userB},input,transport)).rejects.toThrow();expect(calls).toBe(0);
    const result=await connectTwilio(env,actor,input,transport);expect(result.callsReady).toBe(false);expect(JSON.stringify(result)).not.toContain(input.apiKeySecret);
    const row=await env.AGENT_DB.prepare("SELECT ciphertext FROM mayor_phone_connections WHERE tenant_id=? AND provider='twilio'").bind(tenantA).first<{ciphertext:string}>();expect(row?.ciphertext).not.toContain(input.apiKeySecret);
    expect((await selectTwilioNumber(env,actor,number.sid,transport)).routingChanged).toBe(false);
    expect(JSON.stringify(await phoneConnections(env,actor))).not.toContain(input.apiKeySecret);
    number.capabilities.voice=false;await expect(selectTwilioNumber(env,actor,number.sid,transport)).rejects.toThrow();number.capabilities.voice=true;
    await env.AGENT_DB.prepare("UPDATE mayor_phone_connections SET account_id=? WHERE tenant_id=?").bind('AC'+'e'.repeat(32),tenantA).run();
    await expect(twilioNumbers(env,actor,transport)).rejects.toThrow();
    await connectTwilio(env,actor,input,transport);revokeDuringRead=true;
    await expect(selectTwilioNumber(env,actor,number.sid,transport)).rejects.toThrow();
    const disconnected=await env.AGENT_DB.prepare('SELECT ciphertext,selected_number FROM mayor_phone_connections WHERE tenant_id=?').bind(tenantA).first<any>();expect(disconnected.ciphertext).toBe('');expect(disconnected.selected_number).toBeNull();
    expect((await worker.fetch(request(`/api/businesses/${tenantA}/phone-connections/twilio/connect`,cookieA,input,'https://attacker.test'),env,{} as ExecutionContext)).status).toBe(403);
    expect((await worker.fetch(request(`/api/businesses/${tenantA}/phone-connections`,cookieB),env,{} as ExecutionContext)).status).toBe(404);
  });
  it('never sends Twilio credentials to a provider-supplied foreign pagination URL',async()=>{
    let calls=0;
    const transport=(async()=>{calls++;return Response.json({incoming_phone_numbers:[],next_page_uri:'https://attacker.test/numbers'});}) as typeof fetch;
    await expect(connectTwilio(env,{tenantId:tenantA,userId:userA},{accountSid:'AC'+'a'.repeat(32),apiKeySid:'SK'+'b'.repeat(32),apiKeySecret:'c'.repeat(32)},transport)).rejects.toThrow();expect(calls).toBe(1);
  });
  it('recovers a Microsoft lost response by transaction ID without another POST',async()=>{
    const actor={tenantId:tenantA,userId:userA};
    const policy:SchedulingPolicy={timeZone:'UTC',weeklyHours:Array.from({length:7},(_,day)=>({day,startMinute:0,endMinute:1440})),closedDates:[],appointmentTypes:[{name:'Consultation',durationMinutes:30,bufferBeforeMinutes:0,bufferAfterMinutes:0}],staff:[],minimumNoticeMinutes:0,maximumAdvanceDays:30,cancellationNoticeMinutes:0};
    await confirmSchedulingPolicy(env,actor,policy,(await readSchedulingPolicy(env,actor)).revision);
    const grantId='booking-microsoft',scopes=['Calendars.ReadWrite'];
    const ciphertext=await encryptCredential({accountEmail:'fixture@example.test',accessToken:'fixture-ms-token',accessTokenExpiresAt:new Date(Date.now()+3600000).toISOString(),grantedScopes:scopes},{...actor,provider:'microsoft',accountId:grantId},env.TOKEN_ENCRYPTION_KEY!);
    await env.AGENT_DB.prepare(`INSERT INTO auth_provider_grants(id,user_id,provider,account_id,tenant_scope,ciphertext,granted_scopes,selected_capabilities,status,updated_at) VALUES(?,?,'microsoft',?,?,?,?,?,'authorized',?)`).bind(grantId,userA,grantId,tenantA,ciphertext,JSON.stringify(scopes),'["calendar_manage"]',new Date().toISOString()).run();
    const start=Math.ceil((Date.now()+172800000)/60000)*60000;
    const input={title:'Microsoft fixture',appointmentType:'Consultation',start:new Date(start).toISOString(),end:new Date(start+1800000).toISOString(),attendees:['guest@example.test']};
    let creates=0,requestId='',matching=false,pages=0;
    const transport=(async(url:RequestInfo|URL,init?:RequestInit)=>{
      const parsed=new URL(String(url));
      if(parsed.pathname.endsWith('/calendars'))return Response.json({value:[{id:'ms-bookings',name:'Microsoft bookings',canEdit:true}]});
      if(parsed.pathname.endsWith('/calendarView'))return Response.json({value:[]});
      if(init?.method==='POST'){creates++;requestId=JSON.parse(String(init.body)).transactionId;throw new Error('synthetic_lost_response');}
      pages++;
      if(!parsed.searchParams.has('page'))return Response.json({value:[],'@odata.nextLink':'https://graph.microsoft.com/v1.0/me/calendars/ms-bookings/events?page=2'});
      return Response.json({value:[{id:'ms-event','@odata.etag':'ms-etag',transactionId:matching?requestId:'different-request',subject:input.title,isCancelled:false,start:{dateTime:input.start.replace('Z',''),timeZone:'UTC'},end:{dateTime:input.end.replace('Z',''),timeZone:'UTC'},attendees:[{emailAddress:{address:input.attendees[0]}}]}]});
    }) as typeof fetch;
    await selectCalendar(env,actor,{provider:'microsoft',grantId,calendarId:'ms-bookings'},transport);
    const proposal=await proposeBooking(env,actor,input);
    expect((await confirmBooking(env,actor,proposal.id,transport)).status).toBe('uncertain');
    expect((await reconcileBooking(env,actor,proposal.id,transport)).status).toBe('uncertain');
    matching=true;expect((await reconcileBooking(env,actor,proposal.id,transport)).status).toBe('applied');
    expect(creates).toBe(1);expect(pages).toBe(4);
  });
  it('persists confirmed rules and books once; prevents overlaps and retains uncertain writes',async()=>{
    const actor={tenantId:tenantA,userId:userA};
    const policy:SchedulingPolicy={timeZone:'UTC',weeklyHours:Array.from({length:7},(_,day)=>({day,startMinute:0,endMinute:1440})),closedDates:[],appointmentTypes:[{name:'Consultation',durationMinutes:30,bufferBeforeMinutes:0,bufferAfterMinutes:0}],staff:[],minimumNoticeMinutes:0,maximumAdvanceDays:30,cancellationNoticeMinutes:60};
    await confirmSchedulingPolicy(env,actor,policy,(await readSchedulingPolicy(env,actor)).revision);
    await expect(confirmSchedulingPolicy(env,actor,policy,0)).rejects.toThrow();
    await expect(readSchedulingPolicy(env,{...actor,userId:userB})).rejects.toThrow();
    await expect(confirmSchedulingPolicy(env,{...actor,userId:userB},policy,1)).rejects.toThrow();
    const scopes=['https://www.googleapis.com/auth/calendar'];const grantId='booking-google';
    const ciphertext=await encryptCredential({accountEmail:'fixture@example.test',accessToken:'fixture-booking-token',accessTokenExpiresAt:new Date(Date.now()+3600000).toISOString(),grantedScopes:scopes},{...actor,provider:'google',accountId:grantId},env.TOKEN_ENCRYPTION_KEY!);
    await env.AGENT_DB.prepare(`INSERT INTO auth_provider_grants(id,user_id,provider,account_id,tenant_scope,ciphertext,granted_scopes,selected_capabilities,status,updated_at) VALUES(?,?,'google',?,?,?,?,?,'authorized',?)`).bind(grantId,userA,grantId,tenantA,ciphertext,JSON.stringify(scopes),'["calendar_manage"]',new Date().toISOString()).run();
    let creates=0,mode='ok';let recoveryEvent:unknown=null;
    const transport=(async(url:RequestInfo|URL,init?:RequestInit)=>{
      const path=new URL(String(url)).pathname;
      if(path.endsWith('/calendarList'))return Response.json({items:[{id:'bookings',summary:'Bookings',accessRole:'owner'}]});
      if(path.endsWith('/freeBusy'))return Response.json({calendars:{bookings:{busy:mode==='busy'?[{start:'2000-01-01T00:00:00Z',end:'2100-01-01T00:00:00Z'}]:[]}}});
      if(path.includes('/events/'))return recoveryEvent?Response.json(recoveryEvent):new Response('',{status:404});
      creates++;if(mode==='lost')throw new Error('synthetic_lost_response');
      const body=JSON.parse(String(init?.body));
      return Response.json({...body,etag:'etag-fixture',status:'confirmed'});
    }) as typeof fetch;
    await selectCalendar(env,actor,{provider:'google',grantId,calendarId:'bookings'},transport);
    const start=Math.ceil((Date.now()+86400000)/60000)*60000;
    const input={title:'Fixture appointment',appointmentType:'Consultation',start:new Date(start).toISOString(),end:new Date(start+1800000).toISOString(),attendees:[]};
    const proposal=await proposeBooking(env,actor,input);
    await expect(confirmBooking(env,{...actor,userId:userB},proposal.id,transport)).rejects.toThrow();
    expect((await confirmBooking(env,actor,proposal.id,transport)).status).toBe('applied');
    expect((await confirmBooking(env,actor,proposal.id,transport)).status).toBe('applied');expect(creates).toBe(1);
    const overlap=await proposeBooking(env,actor,input);await expect(confirmBooking(env,actor,overlap.id,transport)).rejects.toThrow();expect(creates).toBe(1);
    const later={...input,start:new Date(start+3600000).toISOString(),end:new Date(start+5400000).toISOString()};
    mode='busy';const busy=await proposeBooking(env,actor,later);expect((await confirmBooking(env,actor,busy.id,transport)).status).toBe('rejected');expect(creates).toBe(1);
    mode='lost';const lost=await proposeBooking(env,actor,later);expect((await confirmBooking(env,actor,lost.id,transport)).status).toBe('uncertain');
    expect((await confirmBooking(env,actor,lost.id,transport)).status).toBe('uncertain');expect(creates).toBe(2);
    const retry=await proposeBooking(env,actor,later);await expect(confirmBooking(env,actor,retry.id,transport)).rejects.toThrow();expect(creates).toBe(2);
    await expect(reconcileBooking(env,{...actor,userId:userB},lost.id,transport)).rejects.toThrow();
    expect((await reconcileBooking(env,actor,lost.id,transport)).status).toBe('uncertain');expect(creates).toBe(2);
    recoveryEvent={id:await stableId(lost.id),etag:'recovered-etag',status:'confirmed',summary:'Wrong title',start:{dateTime:later.start},end:{dateTime:later.end},attendees:[]};
    expect((await reconcileBooking(env,actor,lost.id,transport)).status).toBe('uncertain');
    (recoveryEvent as any).summary=later.title;
    const recovery=await Promise.all([reconcileBooking(env,actor,lost.id,transport),reconcileBooking(env,actor,lost.id,transport)]);
    expect(recovery.every(r=>r.status==='applied')).toBe(true);expect(creates).toBe(2);
    expect((await env.AGENT_DB.prepare("SELECT count(*) AS n FROM mayor_audit WHERE resource_id=? AND event='appointment.booked'").bind(lost.id).first<{n:number}>())?.n).toBe(1);
    expect((await listBookingRequests(env,actor)).find(r=>r.id===lost.id)?.status).toBe('applied');
    mode='ok';const concurrentInput={...input,start:new Date(start+7200000).toISOString(),end:new Date(start+9000000).toISOString()};
    const [first,second]=await Promise.all([proposeBooking(env,actor,concurrentInput),proposeBooking(env,actor,concurrentInput)]);
    const outcomes=await Promise.allSettled([confirmBooking(env,actor,first.id,transport),confirmBooking(env,actor,second.id,transport)]);
    expect(outcomes.filter(result=>result.status==='fulfilled'&&result.value.status==='applied')).toHaveLength(1);expect(creates).toBe(3);
  });
  it('selects only live writable calendars, isolates tenants, and invalidates revoked consent',async()=>{
    const actor={tenantId:tenantA,userId:userA};
    for(const provider of ['google','microsoft'] as const){
      const grantId=`calendar-${provider}`;
      const scopes=provider==='google'?['https://www.googleapis.com/auth/calendar']:['Calendars.ReadWrite'];
      const ciphertext=await encryptCredential({accountEmail:'fixture@example.test',accessToken:'fixture-calendar-token',accessTokenExpiresAt:new Date(Date.now()+3600000).toISOString(),grantedScopes:scopes},{...actor,provider,accountId:grantId},env.TOKEN_ENCRYPTION_KEY!);
      await env.AGENT_DB.prepare(`INSERT INTO auth_provider_grants(id,user_id,provider,account_id,tenant_scope,ciphertext,granted_scopes,selected_capabilities,status,updated_at) VALUES(?,?,?,?,?,?,?,?,'authorized',?)`)
        .bind(grantId,userA,provider,grantId,tenantA,ciphertext,JSON.stringify(scopes),'["calendar_manage"]',new Date().toISOString()).run();
      let calls=0;
      const transport=(async()=>{calls++;return Response.json(provider==='google'?{items:[{id:'readonly',summary:'Read only',accessRole:'reader'},{id:'write',summary:'Team calendar',accessRole:'owner'}]}:{value:[{id:'readonly',name:'Read only',canEdit:false},{id:'write',name:'Team calendar',canEdit:true}]});}) as typeof fetch;
      const input={provider,grantId};
      await expect(selectCalendar(env,actor,{...input,calendarId:'invented'},transport)).rejects.toThrow();
      await expect(selectCalendar(env,actor,{...input,calendarId:'readonly'},transport)).rejects.toThrow();
      await selectCalendar(env,actor,{...input,calendarId:'write'},transport);
      expect((await selectedCalendar(env,actor))?.available).toBe(true);
      const previous=calls;
      await expect(discoverCalendars(env,{...actor,userId:userB},input,transport)).rejects.toThrow();expect(calls).toBe(previous);
      await env.AGENT_DB.prepare("UPDATE auth_provider_grants SET status='revoked' WHERE id=?").bind(grantId).run();
      expect((await selectedCalendar(env,actor))?.available).toBe(false);
      await expect(selectCalendar(env,actor,{...input,calendarId:'write'},transport)).rejects.toThrow();expect(calls).toBe(previous);
    }
    expect((await worker.fetch(request(`/api/businesses/${tenantA}/calendars/selected`,cookieB),env,{} as ExecutionContext)).status).toBe(404);
  });
  it('rejects unauthenticated API and agent requests',async()=>{
    for(const path of ['/api/businesses','/api/voice/session','/agents/mayor-voice/other'])expect((await worker.fetch(request(path),env,{} as ExecutionContext)).status).toBe(401);
  });
  it('returns the signed session, blocks cross-origin writes and cross-business memory',async()=>{
    const session=await handleAuthRequest(request('/api/auth/get-session',cookieA),env);
    expect((await session.json() as any).user.id).toBe(userA);
    expect((await worker.fetch(request('/api/businesses',cookieA,{name:'Injected'},'https://attacker.test'),env,{} as ExecutionContext)).status).toBe(403);
    expect((await worker.fetch(request(`/api/businesses/${tenantA}/profile`,cookieB),env,{} as ExecutionContext)).status).toBe(404);
    expect((await worker.fetch(request('/api/voice/session',cookieB,{tenantId:tenantA}),env,{} as ExecutionContext)).status).toBe(404);
  });
  it('stores confirmed memory with optimistic versions and denies another tenant',async()=>{
    await confirmProfile(env,{tenantId:tenantA,userId:userA},{name:'Confirmed name'},0);
    await expect(confirmProfile(env,{tenantId:tenantA,userId:userA},{name:'Stale'},0)).rejects.toThrow();
    await expect(confirmProfile(env,{tenantId:tenantA,userId:userB},{name:'Other user'},1)).rejects.toThrow();
    const memory=await readMemory(env,{tenantId:tenantA,userId:userA});expect(memory.profile.name).toBe('Confirmed name');expect(memory.revision).toBe(1);
  });
  it('binds encrypted provider credentials to the tenant and account',async()=>{
    const binding={tenantId:tenantA,userId:userA,provider:'google' as const,accountId:'fixture-account'};
    const encrypted=await encryptCredential({accountEmail:'fixture@example.test',accessToken:'fixture-token',grantedScopes:[]},binding,env.TOKEN_ENCRYPTION_KEY!);
    expect(encrypted).not.toContain('fixture-token');
    await expect(decryptCredential(encrypted,{...binding,tenantId:'other'},env.TOKEN_ENCRYPTION_KEY!)).rejects.toThrow();
  });
  it('does not expose token retrieval or raw auth endpoints',async()=>{
    for(const suffix of ['get-access-token','refresh-token','account-info','sign-in/social'])expect((await handleAuthRequest(request(`/api/auth/${suffix}`,cookieA,{}),env)).status).toBe(404);
  });
  it('uses PKCE and nonce with identity-only Google consent',async()=>{
    const configured={...env,GOOGLE_CLIENT_ID:'fixture-client',GOOGLE_CLIENT_SECRET:'fixture-secret'};
    const response=await handleAuthRequest(request('/api/auth/start/google','',{capabilities:[]}),configured);
    expect(response.status).toBe(200);
    const url=new URL((await response.json() as {url:string}).url);
    expect(url.hostname).toBe('accounts.google.com');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('nonce')).toBeTruthy();
    expect(url.searchParams.get('redirect_uri')).toBe(origin+'/api/auth/callback/google');
    expect(url.searchParams.get('scope')).not.toMatch(/calendar|gmail|drive/);
    expect(url.searchParams.get('prompt')).not.toBe('consent');
  });
  it('requests fresh offline consent for Google calendar connections while retaining PKCE and nonce',async()=>{
    const configured={...env,GOOGLE_CLIENT_ID:'fixture-client',GOOGLE_CLIENT_SECRET:'fixture-secret',GOOGLE_ENABLED_CAPABILITIES:'calendar_manage'};
    const response=await handleAuthRequest(request('/api/auth/start/google',cookieA,{capabilities:['calendar_manage'],tenantId:tenantA}),configured);
    expect(response.status).toBe(200);
    const url=new URL((await response.json() as {url:string}).url);
    expect(url.searchParams.get('prompt')).toBe('consent');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('nonce')).toBeTruthy();
    expect(url.searchParams.get('scope')).toContain('calendar.events');
    expect(url.searchParams.get('scope')).not.toMatch(/gmail|drive/);
  });
  it('saves setup intent but denies another business and never asserts provider readiness',async()=>{
    const path=`/api/businesses/${tenantA}/phone-setup`;
    const saved=await worker.fetch(request(path,cookieA,{mode:'new',provider:'telnyx'}),env,{} as ExecutionContext);
    expect(saved.status).toBe(200);expect((await saved.json() as any).connectionVerified).toBe(false);
    const read=await worker.fetch(request(path,cookieA),env,{} as ExecutionContext);
    expect((await read.json() as any).setup.mode).toBe('new');
    expect((await worker.fetch(request(path,cookieB),env,{} as ExecutionContext)).status).toBe(404);
    expect((await worker.fetch(request(path,cookieB,{mode:'existing'}),env,{} as ExecutionContext)).status).toBe(404);
  });
});
