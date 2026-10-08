import {env as testEnv} from 'cloudflare:workers';
import {beforeEach,it,expect} from 'vitest';
import type {Actor,Env} from '../../src/env';
import {recordMissedCall,simulateTextBack,listRecentMissedCalls} from '../../src/missed-call-textback';
import {listNotifications} from '../../src/notifications';

const env=testEnv as unknown as Env;
let actor:Actor;
async function fixture(){
 const a={tenantId:crypto.randomUUID().replaceAll('-',''),userId:crypto.randomUUID()};
 await env.AGENT_DB.prepare('INSERT INTO agent_tenants(id,name,created_at) VALUES(?,?,?)').bind(a.tenantId,'Missed-call fixture',new Date().toISOString()).run();
 await env.AGENT_DB.prepare("INSERT INTO agent_memberships(tenant_id,user_id,role) VALUES(?,?,'owner')").bind(a.tenantId,a.userId).run();
 return a;
}
beforeEach(async()=>{actor=await fixture();});

it('simulates a text-back without touching a provider',async()=>{
 const call=await recordMissedCall(env,actor,{callerNumber:'+15550131234',businessNumber:'+15550139876',source:'test'});
 // simulateTextBack takes no transport: simulation has no network capability by construction.
 const result=await simulateTextBack(env,actor,call.id);
 expect(result).toMatchObject({alreadySent:false,simulated:true});
 const stored=await env.AGENT_DB.prepare('SELECT status,textback_sent_at,textback_message_id FROM mayor_missed_calls WHERE id=?').bind(call.id).first<any>();
 expect(stored.status).toBe('texted');
 expect(stored.textback_sent_at).toBeTruthy();
 expect(stored.textback_message_id).toBeNull(); // a live send would record a provider message id
 const sms=await env.AGENT_DB.prepare('SELECT direction,status,provider_message_id,body,to_number,from_number FROM mayor_sms_log WHERE related_missed_call_id=?').bind(call.id).first<any>();
 expect(sms).toMatchObject({direction:'outbound',status:'simulated',to_number:'+15550131234',from_number:'+15550139876'});
 expect(sms.provider_message_id).toBeNull(); // no provider was ever contacted
 expect(sms.body).toContain('Sorry we missed your call');
 const rows=await listRecentMissedCalls(env,actor);
 expect(rows[0]).toMatchObject({id:call.id,source:'test',status:'texted'});
 const notifications=await listNotifications(env,actor);
 // listNotifications maps rows to {id,title,message,action,...}; locate by the routed action.
 const item=notifications.notifications.find(n=>n.action==='missed-calls');
 expect(item).toMatchObject({title:'Missed call recovered',action:'missed-calls',read:false});
});

it('is idempotent when the text-back was already simulated',async()=>{
 const call=await recordMissedCall(env,actor,{callerNumber:'+15550131234',businessNumber:'+15550139876',source:'test'});
 await simulateTextBack(env,actor,call.id);
 const again=await simulateTextBack(env,actor,call.id);
 expect(again).toMatchObject({alreadySent:true});
 const count=await env.AGENT_DB.prepare('SELECT COUNT(*) AS total FROM mayor_sms_log WHERE related_missed_call_id=?').bind(call.id).first<{total:number}>();
 expect(count!.total).toBe(1);
 const notices=await env.AGENT_DB.prepare("SELECT COUNT(*) AS total FROM mayor_notifications WHERE tenant_id=? AND kind='missed_call_texted'").bind(actor.tenantId).first<{total:number}>();
 expect(notices!.total).toBe(1);
});

it('refuses to simulate a non-test call',async()=>{
 const id=crypto.randomUUID();
 await env.AGENT_DB.prepare("INSERT INTO mayor_missed_calls(id,tenant_id,caller_number,business_number,occurred_at,source,status) VALUES(?,?,?,'+15550139876',?,'webhook','missed')").bind(id,actor.tenantId,'+15550131234',new Date().toISOString()).run();
 await expect(simulateTextBack(env,actor,id)).rejects.toMatchObject({code:'simulation_test_only'});
});

it('404s on an unknown call',async()=>{
 await expect(simulateTextBack(env,actor,crypto.randomUUID())).rejects.toMatchObject({code:'missed_call_not_found'});
});
