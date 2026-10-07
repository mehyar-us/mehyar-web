import {env as testEnv} from 'cloudflare:workers';
import {beforeEach,it,expect} from 'vitest';
import type {Actor,Env} from '../../src/env';
import {connectTwilio,selectTwilioNumber} from '../../src/phone-connections';
import {receiveTwilioCall,connectTwilioStream} from '../../src/twilio-calls';
import {verifiedCallNumber,type VerificationStep} from '../../src/phone-verification';
const env={...testEnv,PHONE_TEST_ENABLED:'true'} as unknown as Env;
const credential={accountSid:'AC'+'1'.repeat(32),apiKeySid:'SK'+'2'.repeat(32),apiKeySecret:'3'.repeat(32),authToken:'4'.repeat(32),testCaller:'+12025550123',verifyServiceSid:'VA'+'5'.repeat(32)};
const number={sid:'PN'+'6'.repeat(32),account_sid:credential.accountSid,phone_number:'+12025550124',capabilities:{voice:true}};
let actor:Actor,callSid:string,sends:number,checks:number,checkStatus:string,override:Record<string,unknown>,failure:boolean,afterCheck:(()=>Promise<void>)|undefined;
let transport:typeof fetch;
beforeEach(async()=>{
 actor={tenantId:crypto.randomUUID().replaceAll('-',''),userId:crypto.randomUUID()};callSid='CA'+crypto.randomUUID().replaceAll('-','');sends=0;checks=0;checkStatus='approved';override={};failure=false;afterCheck=undefined;
 await env.AGENT_DB.prepare('INSERT INTO agent_tenants(id,name,created_at) VALUES(?,?,?)').bind(actor.tenantId,'Phone verification fixture',new Date().toISOString()).run();
 await env.AGENT_DB.prepare("INSERT INTO agent_memberships(tenant_id,user_id,role) VALUES(?,?,'owner')").bind(actor.tenantId,actor.userId).run();
 transport=(async(url,init)=>{
  const target=new URL(String(url));
  expect(init?.redirect).toBe('manual');expect(new Headers(init?.headers).get('authorization')).toBe('Basic '+btoa(`${credential.apiKeySid}:${credential.apiKeySecret}`));
  if(target.hostname==='verify.twilio.com'){
   if(init?.method==='GET')return Response.json({sid:credential.verifyServiceSid,account_sid:credential.accountSid});
   const body=new URLSearchParams(String(init?.body)),send=target.pathname.endsWith('/Verifications');
   if(send){sends++;expect(Object.fromEntries(body)).toEqual({To:credential.testCaller,Channel:'sms'});}else{checks++;expect(body.get('VerificationSid')).toBe('VE'+'7'.repeat(32));expect(body.get('To')).toBeNull();await afterCheck?.();}
   if(failure)throw new Error('synthetic network uncertainty');
   return Response.json({sid:'VE'+'7'.repeat(32),account_sid:credential.accountSid,service_sid:credential.verifyServiceSid,to:credential.testCaller,channel:'sms',status:send?'pending':checkStatus,...override});
  }
  expect(target.hostname).toBe('api.twilio.com');
  return Response.json(target.pathname.includes('/Calls/')?{sid:callSid,account_sid:credential.accountSid,from:credential.testCaller,to:number.phone_number,direction:'inbound',status:'in-progress'}:target.pathname.endsWith('/IncomingPhoneNumbers.json')?{incoming_phone_numbers:[number],next_page_uri:null}:number);
 }) as typeof fetch;
 await connectTwilio(env,actor,credential,transport);await selectTwilioNumber(env,actor,number.sid,transport);
});
async function signed(url:string,params:URLSearchParams,method='POST'){
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(credential.authToken),{name:'HMAC',hash:'SHA-1'},false,['sign']);
 const input=url+[...params.keys()].sort().map(key=>key+params.get(key)).join('');
 const signature=btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(input)))));
 return new Request(url,{method,headers:{'x-twilio-signature':signature,...(method==='POST'?{'content-type':'application/x-www-form-urlencoded'}:{upgrade:'websocket'})},...(method==='POST'?{body:params}: {})});
}
function next(xml:string):VerificationStep{
 const match=xml.match(/\/verify\/[a-f0-9]+\/([a-f0-9-]+)\/(send|check)\/([a-f0-9-]+)/)!;
 expect(match).not.toBeNull();return {id:match[1],action:match[2] as 'send'|'check',nonce:match[3]};
}
async function invoke(step?:VerificationStep,digits=''){
 const path=step?`/api/phone/twilio/verify/${actor.tenantId}/${step.id}/${step.action}/${step.nonce}`:`/api/phone/twilio/incoming/${actor.tenantId}`;
 const params=new URLSearchParams({AccountSid:credential.accountSid,CallSid:callSid,From:credential.testCaller,To:number.phone_number,...(step?{Digits:digits}:{})});
 return (await receiveTwilioCall(await signed(env.APP_ORIGIN+path,params),env,actor.tenantId,transport,step)).text();
}
async function pending(){const offered=next(await invoke());const xml=await invoke(offered,'1');return {offered,step:next(xml)};}
async function state(id:string){return env.AGENT_DB.prepare('SELECT * FROM mayor_phone_verifications WHERE call_id=?').bind(id).first<Record<string,unknown>>();}
it('requires opt-in, deduplicates concurrent sends, checks the exact verification and keeps OTP out of storage',async()=>{
 const xml=await invoke(),offered=next(xml);expect(xml).toContain('input="dtmf"');expect(sends).toBe(0);
 const results=await Promise.all([invoke(offered,'1'),invoke(offered,'1')]);expect(sends).toBe(1);expect(results.filter(xml=>xml.includes('<Hangup/>'))).toHaveLength(1);
 const step=next(results.find(xml=>xml.includes('<Gather'))!);
 const streamUrl=env.APP_ORIGIN+`/api/phone/twilio/stream/${step.id}`;
 await expect(connectTwilioStream(await signed(streamUrl,new URLSearchParams(),'GET'),env,step.id)).rejects.toThrow('Finish or decline');
 expect(await verifiedCallNumber(env,step.id)).toBeNull();
 const approved=await invoke(step,'123456');expect(approved).toContain('calling number is verified');expect(approved).toContain('<Connect>');expect(checks).toBe(1);
 expect(await invoke(step,'123456')).toContain('<Hangup/>');expect(checks).toBe(1);
 expect(JSON.stringify(await state(step.id))).not.toContain('123456');
 await env.AGENT_DB.prepare("UPDATE mayor_phone_calls SET state='streaming' WHERE id=?").bind(step.id).run();
 expect(await verifiedCallNumber(env,step.id)).toEqual({tenantId:actor.tenantId,number:credential.testCaller,connectionRevision:2});
 const audit=await env.AGENT_DB.prepare('SELECT event FROM mayor_audit WHERE resource_id=?').bind(step.id).all();
 expect(audit.results.map(row=>row.event)).toEqual(['phone.verification.sending','phone.verification.pending','phone.verification.checking','phone.verification.approved']);
});
it.each(['2',''])('continues without sending when caller declines or times out (%s)',async digits=>{
 const step=next(await invoke());expect(await invoke(step,digits)).toContain('<Connect>');expect(sends).toBe(0);expect((await state(step.id))?.state).toBe('declined');expect(await verifiedCallNumber(env,step.id)).toBeNull();
});
it('does not retry an uncertain SMS request after webhook replay',async()=>{
 const step=next(await invoke());failure=true;expect(await invoke(step,'1')).toContain('verification is unavailable');expect(await invoke(step,'1')).toContain('<Hangup/>');expect(sends).toBe(1);expect((await state(step.id))?.state).toBe('failed');
});
it.each(['account_sid','service_sid','to','sid','channel'] as const)('rejects a mismatched %s in a verification receipt',async field=>{
 const {step}=await pending();override={[field]:field==='sid'?'VE'+'8'.repeat(32):'wrong'};
 expect(await invoke(step,'123456')).toContain('verification is unavailable');expect((await state(step.id))?.state).toBe('failed');expect(await verifiedCallNumber(env,step.id)).toBeNull();
});
it('limits failed code checks to five and rejects replay of earlier steps',async()=>{
 let {step}=await pending();checkStatus='pending';
 for(let i=0;i<5;i++){const xml=await invoke(step,'000000');expect(await invoke(step,'000000')).toContain('<Hangup/>');if(i<4)step=next(xml);else expect(xml).toContain('verification is unavailable');}
 expect(checks).toBe(5);expect((await state(step.id))?.attempts).toBe(5);expect((await state(step.id))?.state).toBe('failed');
});
it('limits SMS requests across calls from the same number',async()=>{
 for(let i=0;i<4;i++){callSid='CA'+crypto.randomUUID().replaceAll('-','');const step=next(await invoke()),xml=await invoke(step,'1');expect(xml.includes('<Gather')).toBe(i<3);}
 expect(sends).toBe(3);
});
it('rejects wrong call IDs and nonces without contacting Verify',async()=>{
 const step=next(await invoke());expect(await invoke({...step,id:crypto.randomUUID()},'1')).toContain('<Hangup/>');expect(await invoke({...step,nonce:crypto.randomUUID()},'1')).toContain('<Hangup/>');expect(sends).toBe(0);
});
it('rejects a forged callback signature before provider requests',async()=>{
 const step=next(await invoke());await expect(receiveTwilioCall(new Request(env.APP_ORIGIN+`/api/phone/twilio/verify/${actor.tenantId}/${step.id}/send/${step.nonce}`,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:'Digits=1'}),env,actor.tenantId,transport,step)).rejects.toThrow('Invalid signature');expect(sends).toBe(0);
});
it('does not approve when the provider connection changes during verification',async()=>{
 const {step}=await pending();afterCheck=async()=>{await env.AGENT_DB.prepare('UPDATE mayor_phone_connections SET revision=revision+1 WHERE tenant_id=?').bind(actor.tenantId).run();};
 expect(await invoke(step,'123456')).toContain('verification is unavailable');expect((await state(step.id))?.state).toBe('failed');expect(await verifiedCallNumber(env,step.id)).toBeNull();
});
it.each(['ended','expired','verification_expired','revoked_owner','changed_connection','disabled'] as const)('does not retain number verification after %s',async mode=>{
 const {step}=await pending();await invoke(step,'123456');await env.AGENT_DB.prepare("UPDATE mayor_phone_calls SET state='streaming' WHERE id=?").bind(step.id).run();
 if(mode==='ended')await env.AGENT_DB.prepare("UPDATE mayor_phone_calls SET state='ended' WHERE id=?").bind(step.id).run();
 if(mode==='expired')await env.AGENT_DB.prepare("UPDATE mayor_phone_calls SET expires_at='2000' WHERE id=?").bind(step.id).run();
 if(mode==='verification_expired')await env.AGENT_DB.prepare("UPDATE mayor_phone_verifications SET expires_at='2000' WHERE call_id=?").bind(step.id).run();
 if(mode==='revoked_owner')await env.AGENT_DB.prepare("UPDATE agent_memberships SET status='revoked' WHERE tenant_id=?").bind(actor.tenantId).run();
 if(mode==='changed_connection')await env.AGENT_DB.prepare('UPDATE mayor_phone_connections SET revision=revision+1 WHERE tenant_id=?').bind(actor.tenantId).run();
 expect(await verifiedCallNumber(mode==='disabled'?{...env,PHONE_TEST_ENABLED:'false'}:env,step.id)).toBeNull();
});
it('submits only one concurrent code check for the same step',async()=>{
 const {step}=await pending();const results=await Promise.all([invoke(step,'123456'),invoke(step,'123456')]);
 expect(checks).toBe(1);expect(results.filter(xml=>xml.includes('calling number is verified'))).toHaveLength(1);expect(results.filter(xml=>xml.includes('<Response><Hangup/></Response>'))).toHaveLength(1);
});
it('invalidates an approved call when the selected number changes',async()=>{
 const {step}=await pending();await invoke(step,'123456');
 await env.AGENT_DB.prepare("UPDATE mayor_phone_calls SET state='streaming' WHERE id=?").bind(step.id).run();
 expect(await verifiedCallNumber(env,step.id)).not.toBeNull();
 const replacement={...number,sid:'PN'+'8'.repeat(32),phone_number:'+12025550125'};
 await selectTwilioNumber(env,actor,replacement.sid,(async()=>Response.json(replacement)) as typeof fetch);
 expect(await verifiedCallNumber(env,step.id)).toBeNull();
});
it('rejects a stale number selection that finishes after a newer selection',async()=>{
 const replacement={...number,sid:'PN'+'8'.repeat(32),phone_number:'+12025550125'};
 const racing=(async()=>{
  await selectTwilioNumber(env,actor,replacement.sid,(async()=>Response.json(replacement)) as typeof fetch);
  return Response.json(number);
 }) as typeof fetch;
 await expect(selectTwilioNumber(env,actor,number.sid,racing)).rejects.toThrow('Your phone connection changed');
 expect(await env.AGENT_DB.prepare("SELECT selected_number FROM mayor_phone_connections WHERE tenant_id=? AND provider='twilio'").bind(actor.tenantId).first()).toEqual({selected_number:replacement.phone_number});
});
it('does not send after the offer expires',async()=>{
 const step=next(await invoke());await env.AGENT_DB.prepare("UPDATE mayor_phone_verifications SET expires_at='2000' WHERE call_id=?").bind(step.id).run();
 expect(await invoke(step,'1')).toContain('<Hangup/>');expect(sends).toBe(0);
});
it('does not retain a late provider approval after the call ends',async()=>{
 const {step}=await pending();afterCheck=async()=>{await env.AGENT_DB.prepare("UPDATE mayor_phone_calls SET state='ended' WHERE id=?").bind(step.id).run();};
 expect(await invoke(step,'123456')).toContain('<Hangup/>');expect((await state(step.id))?.state).not.toBe('approved');expect(await verifiedCallNumber(env,step.id)).toBeNull();
});
it('rejects a Verify service from another account without replacing the saved connection',async()=>{
 const bad=(async(url:RequestInfo|URL,init?:RequestInit)=>new URL(String(url)).hostname==='verify.twilio.com'?Response.json({sid:credential.verifyServiceSid,account_sid:'AC'+'9'.repeat(32)}):transport(url,init)) as typeof fetch;
 await expect(connectTwilio(env,actor,credential,bad)).rejects.toThrow('Choose a Verify service');
 expect(await env.AGENT_DB.prepare('SELECT revision FROM mayor_phone_connections WHERE tenant_id=?').bind(actor.tenantId).first()).toEqual({revision:2});
});
it('rejects a callback for another tenant before sending or checking any code',async()=>{
 const step=next(await invoke()),old=actor;actor={...actor,tenantId:crypto.randomUUID().replaceAll('-','')};
 await expect(invoke(step,'1')).rejects.toThrow();actor=old;expect(sends).toBe(0);expect(checks).toBe(0);
});
