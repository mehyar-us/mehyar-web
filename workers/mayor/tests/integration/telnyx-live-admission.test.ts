/**
 * telnyx-live-admission.test.ts — production (live-mode) Telnyx admission.
 * Phone-live P1 (2026-10-21): a tenant whose inbound config is saved with
 * saveTelnyxLiveSetup admits ANY caller to its selected number, while every
 * other protection (signature, revision, provider-side binding, consent,
 * destination + application match) applies unchanged. Test mode — including
 * envelopes sealed before live mode existed — still admits only the
 * designated test caller.
 */
import {env as testEnv} from 'cloudflare:workers';
import {beforeEach,it,expect} from 'vitest';
import type {Env} from '../../src/env';
import {connectTelnyx,selectTelnyxNumber,saveTelnyxLiveSetup,saveTelnyxCallSetup} from '../../src/telnyx-connections';
import {admitTelnyxInitiated} from '../../src/telnyx-admission';
import {recordTelnyxHangup} from '../../src/telnyx-hangup';
const env={...testEnv,PHONE_TEST_ENABLED:'true'} as unknown as Env;
const number={id:'12345',phone_number:'+12025550124',status:'active',connection_id:'76543'};
const stranger='+12025550999';
let actor:{tenantId:string;userId:string},keys:CryptoKeyPair,publicKey:string;
const appFor=(tenantId:string)=>({data:{id:'76543',active:true,record_type:'call_control_application',webhook_api_version:'2',webhook_event_url:`${env.APP_ORIGIN}/api/phone/telnyx/incoming/${tenantId}`}});
const transportFor=(tenantId:string,numberOverride?:Partial<typeof number>)=>((async(url:RequestInfo|URL)=>{
 const href=String(url);
 if(href.includes('/call_control_applications/'))return Response.json(appFor(tenantId));
 if(new URL(href).search)return Response.json({data:[{...number,...numberOverride}],meta:{page_number:1,total_pages:1}});
 return Response.json({data:{...number,...numberOverride}});
}) as unknown as typeof fetch);
const encoded=(bytes:ArrayBuffer)=>btoa(String.fromCharCode(...new Uint8Array(bytes)));
async function makeTenant(){
 const a={tenantId:crypto.randomUUID(),userId:crypto.randomUUID()};
 await env.AGENT_DB.prepare('INSERT INTO agent_tenants(id,name,created_at) VALUES(?,?,?)').bind(a.tenantId,'Telnyx live fixture',new Date().toISOString()).run();
 await env.AGENT_DB.prepare("INSERT INTO agent_memberships(tenant_id,user_id,role) VALUES(?,?,'owner')").bind(a.tenantId,a.userId).run();
 await env.AGENT_DB.prepare('INSERT INTO mayor_phone_recording_consent(tenant_id,consent_version,acknowledged_at,acknowledged_by) VALUES(?,1,?,?)').bind(a.tenantId,new Date().toISOString(),a.userId).run();
 return a;
}
beforeEach(async()=>{
 actor=await makeTenant();
 keys=await crypto.subtle.generateKey('Ed25519',true,['sign','verify']) as CryptoKeyPair;
 publicKey=encoded(await crypto.subtle.exportKey('raw',keys.publicKey));
 const transport=transportFor(actor.tenantId);
 await connectTelnyx(env,actor,{apiKey:'KEY_live_admission_test_only'},transport);
 await selectTelnyxNumber(env,actor,number.id,transport);
});
const liveSetup=(a:{tenantId:string;userId:string},transport:typeof fetch)=>saveTelnyxLiveSetup(env,a,{publicKey,applicationId:'76543',mode:'live',confirm:'save_live_setup'},transport);
function eventPayload(type:'call.initiated'|'call.hangup',from:string,to:string,connectionId='76543'){
 const payload:any={call_control_id:'v3:'+crypto.randomUUID(),call_leg_id:crypto.randomUUID(),call_session_id:crypto.randomUUID(),connection_id:connectionId,from,to};
 if(type==='call.initiated')payload.direction='incoming';
 return {data:{id:crypto.randomUUID(),event_type:type,occurred_at:new Date().toISOString(),payload}};
}
async function signed(event:any){
 const raw=JSON.stringify(event),timestamp=String(Math.floor(Date.now()/1000));
 const signature=encoded(await crypto.subtle.sign('Ed25519',keys.privateKey,new TextEncoder().encode(`${timestamp}|${raw}`)));
 return new Request('https://mayor.example.test/telnyx',{method:'POST',headers:{'content-type':'application/json','telnyx-timestamp':timestamp,'telnyx-signature-ed25519':signature},body:raw});
}
const count=async(tenantId:string)=>(await env.AGENT_DB.prepare('SELECT COUNT(*) AS total FROM mayor_telnyx_admissions WHERE tenant_id=?').bind(tenantId).first<{total:number}>())!.total;

it('saves live setup and admits a call from any caller',async()=>{
 await expect(liveSetup(actor,transportFor(actor.tenantId))).resolves.toMatchObject({saved:true,callsReady:false,routingChanged:false});
 const admitted=await admitTelnyxInitiated(env,actor.tenantId,await signed(eventPayload('call.initiated',stranger,number.phone_number)),transportFor(actor.tenantId));
 expect(admitted.newAdmission).toBe(true);
 expect(await count(actor.tenantId)).toBe(1);
});

it('live mode still rejects a call to a different number',async()=>{
 await liveSetup(actor,transportFor(actor.tenantId));
 await expect(admitTelnyxInitiated(env,actor.tenantId,await signed(eventPayload('call.initiated',stranger,'+12025550000')),transportFor(actor.tenantId))).rejects.toMatchObject({code:'call_not_designated'});
 expect(await count(actor.tenantId)).toBe(0);
});

it('live mode still rejects a call on a different voice application',async()=>{
 await liveSetup(actor,transportFor(actor.tenantId));
 await expect(admitTelnyxInitiated(env,actor.tenantId,await signed(eventPayload('call.initiated',stranger,number.phone_number,'99999')),transportFor(actor.tenantId))).rejects.toMatchObject({code:'call_not_designated'});
 expect(await count(actor.tenantId)).toBe(0);
});

it('records a hangup for a live-mode call from any caller',async()=>{
 await liveSetup(actor,transportFor(actor.tenantId));
 const result=await recordTelnyxHangup(env,actor.tenantId,await signed(eventPayload('call.hangup',stranger,number.phone_number)));
 expect(result.ended).toBe(true);
});

it('live setup refuses when no number is selected yet',async()=>{
 const bare=await makeTenant();
 await connectTelnyx(env,bare,{apiKey:'KEY_live_no_number_test_only'},transportFor(bare.tenantId));
 await expect(liveSetup(bare,transportFor(bare.tenantId))).rejects.toMatchObject({code:'phone_unavailable'});
});

it('live setup refuses when the selected number is assigned to another application',async()=>{
 const moved=transportFor(actor.tenantId,{connection_id:'55555'});
 await expect(liveSetup(actor,moved)).rejects.toMatchObject({code:'number_application_mismatch'});
});

it('test mode still admits only the designated caller (legacy envelope, no mode)',async()=>{
 const legacy=await makeTenant();
 const transport=transportFor(legacy.tenantId);
 const inbound={publicKey,applicationId:'76543',testCaller:'+12025550123'};
 await connectTelnyx(env,legacy,{apiKey:'KEY_legacy_test_only',inbound},transport);
 await selectTelnyxNumber(env,legacy,number.id,transport);
 await expect(admitTelnyxInitiated(env,legacy.tenantId,await signed(eventPayload('call.initiated',stranger,number.phone_number)),transport)).rejects.toMatchObject({code:'call_not_designated'});
 const admitted=await admitTelnyxInitiated(env,legacy.tenantId,await signed(eventPayload('call.initiated','+12025550123',number.phone_number)),transport);
 expect(admitted.newAdmission).toBe(true);
});

it('saving test setup after live setup returns the tenant to designated-caller admission',async()=>{
 await liveSetup(actor,transportFor(actor.tenantId));
 await saveTelnyxCallSetup(env,actor,{publicKey,applicationId:'76543',testCaller:'+12025550123',confirm:'save_test_setup'},transportFor(actor.tenantId));
 await expect(admitTelnyxInitiated(env,actor.tenantId,await signed(eventPayload('call.initiated',stranger,number.phone_number)),transportFor(actor.tenantId))).rejects.toMatchObject({code:'call_not_designated'});
});
