import {env as testEnv} from 'cloudflare:workers';
import {it,expect} from 'vitest';
import type {Env} from '../../src/env';
import {connectTwilio,selectTwilioNumber,disconnectTwilio} from '../../src/phone-connections';
import {connectTelnyx,selectTelnyxNumber,disconnectTelnyx} from '../../src/telnyx-connections';
const env=testEnv as unknown as Env;
async function fixture(provider:'twilio'|'telnyx'){
 const actor={tenantId:crypto.randomUUID(),userId:crypto.randomUUID()};
 await env.AGENT_DB.prepare('INSERT INTO agent_tenants(id,name,created_at) VALUES(?,?,?)').bind(actor.tenantId,'Phone access fixture',new Date().toISOString()).run();
 await env.AGENT_DB.prepare("INSERT INTO agent_memberships(tenant_id,user_id,role) VALUES(?,?,'owner')").bind(actor.tenantId,actor.userId).run();
 const input={accountSid:'AC'+'1'.repeat(32),apiKeySid:'SK'+'2'.repeat(32),apiKeySecret:'3'.repeat(32)};
 const number={sid:'PN'+'4'.repeat(32),account_sid:input.accountSid,phone_number:'+12025550109',capabilities:{voice:true}};
 const telnyx={id:'12345',phone_number:number.phone_number,status:'active'};
 const transport=(async(url:RequestInfo|URL)=>{const target=new URL(String(url));return Response.json(provider==='twilio'?(target.pathname.endsWith('IncomingPhoneNumbers.json')?{incoming_phone_numbers:[number],next_page_uri:null}:number):(target.search?{data:[telnyx],meta:{page_number:1,total_pages:1}}:{data:telnyx}));}) as typeof fetch;
 return {actor,connect:(e:Env)=>provider==='twilio'?connectTwilio(e,actor,input,transport):connectTelnyx(e,actor,{apiKey:'KEY_phone_access_fixture'},transport),select:(e:Env)=>provider==='twilio'?selectTwilioNumber(e,actor,number.sid,transport):selectTelnyxNumber(e,actor,telnyx.id,transport),disconnect:(e:Env)=>provider==='twilio'?disconnectTwilio(e,actor):disconnectTelnyx(e,actor)};
}
// Inject a revocation at the database mutation boundary, after application preflight.
function racingEnv(batch:boolean,change:()=>Promise<unknown>):Env{
 let fired=false;const hook=async()=>{if(!fired){fired=true;await change();}};
 return {...env,AGENT_DB:{
  batch:async(statements:D1PreparedStatement[])=>{if(batch)await hook();return env.AGENT_DB.batch(statements);},
  prepare:(sql:string)=>{
   const wrap=(statement:D1PreparedStatement):D1PreparedStatement=>new Proxy(statement,{get(target,key){
    if(key==='bind')return (...args:unknown[])=>wrap(target.bind(...args));
    if(key==='run')return async()=>{if(!batch&&sql.startsWith('UPDATE mayor_phone_connections'))await hook();return target.run();};
    const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
   }});return wrap(env.AGENT_DB.prepare(sql));
  },
 } as D1Database};
}
for(const provider of ['twilio','telnyx'] as const){
 for(const mode of ['new','reconnect','select','disconnect'] as const){
  it(`${provider} refuses ${mode} after revocation at the write boundary`,async()=>{
   const f=await fixture(provider);
   if(mode!=='new')await f.connect(env);
   const read=()=>env.AGENT_DB.prepare('SELECT * FROM mayor_phone_connections WHERE tenant_id=?').bind(f.actor.tenantId).all();
   const before=(await read()).results;
   const guarded=racingEnv(mode==='new'||mode==='reconnect',()=>env.AGENT_DB.prepare("UPDATE agent_memberships SET status='revoked' WHERE tenant_id=?").bind(f.actor.tenantId).run());
   await expect(mode==='select'?f.select(guarded):mode==='disconnect'?f.disconnect(guarded):f.connect(guarded)).rejects.toMatchObject({code:mode==='select'?'connection_changed':mode==='disconnect'?'workspace_not_found':'phone_access_changed'});
   expect((await read()).results).toEqual(before);
   const audit=await env.AGENT_DB.prepare("SELECT COUNT(*) AS total FROM mayor_audit WHERE tenant_id=? AND event='phone.connected'").bind(f.actor.tenantId).first<{total:number}>();
   expect(audit?.total).toBe(mode==='new'?0:1);
  });
 }
 for(const loss of ['demotion','expiry','tenant_inactive'] as const){
  it(`${provider} refuses new credentials after ${loss} at the write boundary`,async()=>{
   const f=await fixture(provider);
   const change=()=>env.AGENT_DB.prepare(loss==='demotion'?"UPDATE agent_memberships SET role='viewer' WHERE tenant_id=?":loss==='expiry'?"UPDATE agent_memberships SET expires_at='2000-01-01T00:00:00.000Z' WHERE tenant_id=?":"UPDATE agent_tenants SET status='inactive' WHERE id=?").bind(f.actor.tenantId).run();
   await expect(f.connect(racingEnv(true,change))).rejects.toMatchObject({code:'phone_access_changed'});
   expect(await env.AGENT_DB.prepare('SELECT id FROM mayor_phone_connections WHERE tenant_id=?').bind(f.actor.tenantId).first()).toBeNull();
  });
 }
 it(`${provider} denies a manager's selection if the credential owner loses access at write time`,async()=>{
  const f=await fixture(provider);await f.connect(env);const owner=f.actor.userId;
  f.actor.userId=crypto.randomUUID();
  await env.AGENT_DB.prepare("INSERT INTO agent_memberships(tenant_id,user_id,role) VALUES(?,?,'manager')").bind(f.actor.tenantId,f.actor.userId).run();
  const guarded=racingEnv(false,()=>env.AGENT_DB.prepare("UPDATE agent_memberships SET status='revoked' WHERE tenant_id=? AND user_id=?").bind(f.actor.tenantId,owner).run());
  await expect(f.select(guarded)).rejects.toMatchObject({code:'connection_changed'});
  expect(await env.AGENT_DB.prepare('SELECT selected_number FROM mayor_phone_connections WHERE tenant_id=?').bind(f.actor.tenantId).first()).toEqual({selected_number:null});
 });
}
