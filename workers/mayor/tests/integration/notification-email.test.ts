import {env as testEnv} from 'cloudflare:workers';
import {it,expect,afterEach} from 'vitest';
import type {Env,Actor} from '../../src/env';
import {createAuth} from '../../src/auth';
import {saveEmailPreference,readEmailPreference,queueNotificationEmails,deliverNotificationEmails,prepareEmailPreference,confirmEmailPreference} from '../../src/notification-email';
import {refreshAttentionNotifications,markNotificationRead} from '../../src/notifications';
import {MayorVoice} from '../../src/voice';
const dbEnv=testEnv as unknown as Env,actors:Actor[]=[];
async function fixture(){
 const user=await (await createAuth(dbEnv).$context).internalAdapter.createUser({email:`${crypto.randomUUID()}@example.test`,name:'Email fixture',emailVerified:true});
 const actor={tenantId:crypto.randomUUID(),userId:user.id};actors.push(actor);
 await dbEnv.AGENT_DB.prepare('INSERT INTO agent_tenants(id,name,created_at) VALUES(?,?,?)').bind(actor.tenantId,'Email fixture',new Date().toISOString()).run();
 await dbEnv.AGENT_DB.prepare("INSERT INTO agent_memberships(tenant_id,user_id,role) VALUES(?,?,'owner')").bind(actor.tenantId,actor.userId).run();
 const sent:any[]=[];let error:unknown;
 const env={...dbEnv,MAYOR_EMAIL_FROM:'mayor@example.test',MAYOR_EMAIL:{send:async(message:any)=>{sent.push(message);if(error)throw error;return {messageId:'test-receipt'};}}} as unknown as Env;
 await refreshAttentionNotifications(env,actor);
 return {env,actor,user,sent,fail:(value:unknown)=>{error=value;}};
}
afterEach(async()=>{for(const actor of actors.splice(0)){
 await dbEnv.AGENT_DB.prepare('UPDATE mayor_email_preferences SET enabled=0 WHERE tenant_id=? AND user_id=?').bind(actor.tenantId,actor.userId).run();
 await dbEnv.AGENT_DB.prepare("UPDATE mayor_email_outbox SET state='cancelled' WHERE tenant_id=? AND user_id=? AND state IN ('pending','sending')").bind(actor.tenantId,actor.userId).run();
}});
it('requires opt-in and a verified sign-in email; rejects custom recipients and another user',async()=>{
 const f=await fixture();expect((await readEmailPreference(f.env,f.actor)).enabled).toBe(false);
 expect(await queueNotificationEmails(f.env)).toBe(0);
 await expect(saveEmailPreference(f.env,f.actor,{enabled:true,email:'other@example.test'} as any)).rejects.toThrow();
 await expect(saveEmailPreference(f.env,{...f.actor,userId:crypto.randomUUID()},{enabled:true})).rejects.toThrow();
 await f.env.AGENT_DB.prepare('UPDATE auth_user SET emailVerified=0 WHERE id=?').bind(f.actor.userId).run();
 await expect(saveEmailPreference(f.env,f.actor,{enabled:true})).rejects.toThrow();
 expect(f.sent).toEqual([]);
});
it.each(['accepted','uncertain','failed'] as const)('does not let twenty %s businesses starve a new business after the grouping window',async state=>{
 const older=[];
 for(let i=0;i<20;i++){
  const f=await fixture();await saveEmailPreference(f.env,f.actor,{enabled:true});older.push(f);
 }
 const now=Date.now(),runner=older[0];
 if(state==='uncertain')runner.fail(new Error('synthetic ambiguous send'));
 if(state==='failed')runner.fail(Object.assign(new Error('synthetic explicit rejection'),{code:'E_RECIPIENT_NOT_ALLOWED'}));
 expect(await queueNotificationEmails(runner.env,now)).toBe(20);
 await deliverNotificationEmails(runner.env,now);expect(runner.sent).toHaveLength(20);
 const fresh=await fixture();await saveEmailPreference(fresh.env,fresh.actor,{enabled:true});
 expect(await queueNotificationEmails(fresh.env,now+2*86400000)).toBe(1);
 await deliverNotificationEmails(fresh.env,now+2*86400000);
 expect(fresh.sent).toHaveLength(1);expect(fresh.sent[0].to).toBe(fresh.user.email);
 expect(runner.sent).toHaveLength(20);
});
it('coalesces concurrent queue/send attempts and records acceptance without claiming delivery',async()=>{
 const f=await fixture();await saveEmailPreference(f.env,f.actor,{enabled:true});
 await Promise.all([queueNotificationEmails(f.env),queueNotificationEmails(f.env)]);
 await Promise.all([deliverNotificationEmails(f.env),deliverNotificationEmails(f.env)]);
 expect(f.sent).toHaveLength(1);expect(f.sent[0].to).toBe(f.user.email);expect(f.sent[0].text).toContain('/?notifications=1');
 expect(f.sent[0].text).not.toContain('Email fixture');
 const preference=await readEmailPreference(f.env,f.actor);expect(preference.lastDelivery?.state).toBe('accepted');expect(JSON.stringify(preference)).not.toContain('test-receipt');
 await refreshAttentionNotifications(f.env,f.actor);expect(await queueNotificationEmails(f.env)).toBe(0);
});
it.each(['read','optout','revoked','email_changed'] as const)('cancels queued messages after %s',async mode=>{
 const f=await fixture();await saveEmailPreference(f.env,f.actor,{enabled:true});await queueNotificationEmails(f.env);
 if(mode==='read'){const n=await refreshAttentionNotifications(f.env,f.actor);await markNotificationRead(f.env,f.actor,n.notifications[0].id);}
 if(mode==='optout')await saveEmailPreference(f.env,f.actor,{enabled:false});
 if(mode==='revoked')await f.env.AGENT_DB.prepare("UPDATE agent_memberships SET status='revoked' WHERE tenant_id=? AND user_id=?").bind(f.actor.tenantId,f.actor.userId).run();
 if(mode==='email_changed')await f.env.AGENT_DB.prepare('UPDATE auth_user SET email=? WHERE id=?').bind('changed@example.test',f.actor.userId).run();
 await deliverNotificationEmails(f.env);expect(f.sent).toHaveLength(0);
 const row=await f.env.AGENT_DB.prepare('SELECT state FROM mayor_email_outbox WHERE tenant_id=?').bind(f.actor.tenantId).first();expect(row).toMatchObject({state:'cancelled'});
});
it('can requeue a cancelled message after explicit opt-in is restored',async()=>{
 const f=await fixture();await saveEmailPreference(f.env,f.actor,{enabled:true});await queueNotificationEmails(f.env);
 await saveEmailPreference(f.env,f.actor,{enabled:false});await saveEmailPreference(f.env,f.actor,{enabled:true});
 expect(await queueNotificationEmails(f.env)).toBe(1);await deliverNotificationEmails(f.env);expect(f.sent).toHaveLength(1);
});
it('does not retry an ambiguous send, even after another day or new opt-in',async()=>{
 const f=await fixture();await saveEmailPreference(f.env,f.actor,{enabled:true});await queueNotificationEmails(f.env);
 f.fail(new Error('private transport error'));await deliverNotificationEmails(f.env);
 expect((await readEmailPreference(f.env,f.actor)).lastDelivery?.state).toBe('uncertain');
 await saveEmailPreference(f.env,f.actor,{enabled:true});await queueNotificationEmails(f.env,Date.now()+2*86400000);await deliverNotificationEmails(f.env,Date.now()+2*86400000);
 expect(f.sent).toHaveLength(1);
 const row=await f.env.AGENT_DB.prepare('SELECT failure_code FROM mayor_email_outbox WHERE tenant_id=?').bind(f.actor.tenantId).first();expect(row).toMatchObject({failure_code:'receipt_missing'});
});
it('retries explicit rate-limit rejection at most three times',async()=>{
 const f=await fixture(),now=Date.now();await saveEmailPreference(f.env,f.actor,{enabled:true});await queueNotificationEmails(f.env,now);
 f.fail(Object.assign(new Error('rejected'),{code:'E_RATE_LIMIT_EXCEEDED'}));
 await deliverNotificationEmails(f.env,now);await deliverNotificationEmails(f.env,now+60000);expect(f.sent).toHaveLength(1);
 await deliverNotificationEmails(f.env,now+300000);await deliverNotificationEmails(f.env,now+600000);await deliverNotificationEmails(f.env,now+900000);
 expect(f.sent).toHaveLength(3);expect((await readEmailPreference(f.env,f.actor)).lastDelivery?.state).toBe('failed');
});
it('marks abandoned in-flight sends uncertain instead of sending again',async()=>{
 const f=await fixture(),now=Date.now();await saveEmailPreference(f.env,f.actor,{enabled:true});await queueNotificationEmails(f.env,now);
 await f.env.AGENT_DB.prepare("UPDATE mayor_email_outbox SET state='sending',lease_until=? WHERE tenant_id=?").bind(new Date(now-1).toISOString(),f.actor.tenantId).run();
 await deliverNotificationEmails(f.env,now);expect(f.sent).toHaveLength(0);expect((await readEmailPreference(f.env,f.actor)).lastDelivery?.state).toBe('uncertain');
});
it('does not replay a quarantined snapshot after renewed opt-in and elapsed grouping window',async()=>{
 const f=await fixture(),now=Date.now();
 await saveEmailPreference(f.env,f.actor,{enabled:true});await queueNotificationEmails(f.env,now);
 await f.env.AGENT_DB.prepare("UPDATE mayor_email_outbox SET state='uncertain',failure_code='restored_snapshot',lease_token=NULL,lease_until=NULL WHERE tenant_id=?").bind(f.actor.tenantId).run();
 await saveEmailPreference(f.env,f.actor,{enabled:false});
 await saveEmailPreference(f.env,f.actor,{enabled:true});
 expect(await queueNotificationEmails(f.env,now+2*86400000)).toBe(0);
 await deliverNotificationEmails(f.env,now+2*86400000);
 expect(f.sent).toHaveLength(0);
 expect((await readEmailPreference(f.env,f.actor)).lastDelivery?.state).toBe('uncertain');
});
it('sends a newly reopened occurrence only after the 24-hour grouping window',async()=>{
 const f=await fixture(),now=Date.now();await saveEmailPreference(f.env,f.actor,{enabled:true});await queueNotificationEmails(f.env,now);await deliverNotificationEmails(f.env,now);
 await f.env.AGENT_DB.prepare("UPDATE mayor_notifications SET state='resolved' WHERE tenant_id=?").bind(f.actor.tenantId).run();
 const reopened=await refreshAttentionNotifications(f.env,f.actor);expect(reopened.notifications.length).toBeGreaterThan(0);
 expect(await queueNotificationEmails(f.env,now+3600000)).toBe(0);
 expect(await queueNotificationEmails(f.env,now+86460000)).toBe(1);await deliverNotificationEmails(f.env,now+86460000);expect(f.sent).toHaveLength(2);
 expect(await queueNotificationEmails(f.env,now+2*86400000)).toBe(0);
});

it('rejects stale, expired, different-account and changed-recipient conversational proposals',async()=>{
 const f=await fixture(),proposal=await prepareEmailPreference(f.env,f.actor,{enabled:true});
 expect((await readEmailPreference(f.env,f.actor)).enabled).toBe(false);
 await expect(confirmEmailPreference(f.env,f.actor,{...proposal,expiresAt:0})).rejects.toThrow();
 await expect(confirmEmailPreference(f.env,{...f.actor,tenantId:crypto.randomUUID()},proposal)).rejects.toThrow();
 await f.env.AGENT_DB.prepare('UPDATE auth_user SET email=? WHERE id=?').bind('new@example.test',f.actor.userId).run();
 await expect(confirmEmailPreference(f.env,f.actor,proposal)).rejects.toThrow();
 await f.env.AGENT_DB.prepare('UPDATE auth_user SET email=? WHERE id=?').bind(f.user.email,f.actor.userId).run();
 const results=await Promise.allSettled([confirmEmailPreference(f.env,f.actor,proposal),confirmEmailPreference(f.env,f.actor,proposal)]);
 expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
 const staleDisable=await prepareEmailPreference(f.env,f.actor,{enabled:false});
 await saveEmailPreference(f.env,f.actor,{enabled:true});
 await expect(confirmEmailPreference(f.env,f.actor,staleDisable)).rejects.toThrow();
 expect((await readEmailPreference(f.env,f.actor)).enabled).toBe(true);
 const audit=await f.env.AGENT_DB.prepare("SELECT event FROM mayor_audit WHERE tenant_id=? AND event LIKE 'email_alerts.%'").bind(f.actor.tenantId).all();expect(audit.results).toHaveLength(2);
 expect(f.sent).toHaveLength(0);
});
async function conversationalFixture(enabled=true){
 const f=await fixture(),voice=Object.create(MayorVoice.prototype) as any;
 for(const field of ['generations','pending','pendingCalendar','pendingPolicy','pendingBooking','pendingChange','pendingCallback','pendingCustomer'])voice[field]=new Map();
 const ai={run:async()=>{
  const events=[{choices:[{delta:{tool_calls:[{id:'email-1',index:0,type:'function',function:{name:'proposeEmailNotifications',arguments:JSON.stringify({enabled})}}]}}]},{choices:[{delta:{},finish_reason:'stop'}]}];
  return new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode(events.map(event=>'data: '+JSON.stringify(event)+'\n\n').join('')+'data: [DONE]\n\n'));controller.close();}});
 }};
 Object.assign(voice,{env:{...f.env,AI:ai},ready:new Set(),authorize:async()=>f.actor});
 const context={connection:{id:'email-preference',send:()=>{}},signal:new AbortController().signal,messages:[]};
 return {...f,voice,context};
}
it('enables through a separate completed readback and disables by conversation without sending inline',async()=>{
 const f=await conversationalFixture();let readback='';for await(const text of await f.voice.onTurn('Email me when my business needs attention.',f.context))readback+=text;
 expect(readback).toContain(f.user.email);expect(readback).toContain('24 hours');expect(readback).toContain('does not read your inbox');
 expect((await readEmailPreference(f.env,f.actor)).enabled).toBe(false);
 expect(await f.voice.onTurn('Yes',f.context)).toContain('enabled');expect((await readEmailPreference(f.env,f.actor)).enabled).toBe(true);expect(f.sent).toHaveLength(0);
 const disable=await prepareEmailPreference(f.env,f.actor,{enabled:false});f.voice.pendingCustomer.set(f.context.connection.id,{emailPreference:disable,expiresAt:disable.expiresAt});f.voice.ready.add(f.context.connection.id);
 expect(await f.voice.onTurn('Yes',f.context)).toContain('are off');expect((await readEmailPreference(f.env,f.actor)).enabled).toBe(false);
});
it.each(['interrupted','unread','expired','revoked'] as const)('does not enable attention emails when confirmation is %s',async mode=>{
 const f=await conversationalFixture(),response=await f.voice.onTurn('Enable attention emails.',f.context);
 expect(f.voice.pending.size).toBe(0);
 if(mode==='unread')await response.return();else for await(const chunk of response){}
 if(mode!=='unread'){
  expect(f.voice.pendingCustomer.get(f.context.connection.id)).toMatchObject({emailPreference:{enabled:true,actor:f.actor}});
  expect(f.voice.ready.has(f.context.connection.id)).toBe(true);
 }
 if(mode==='interrupted')f.voice.onInterrupt(f.context.connection);
 if(mode==='expired')f.voice.pendingCustomer.get(f.context.connection.id).expiresAt=0;
 if(mode==='revoked')await f.env.AGENT_DB.prepare("UPDATE agent_memberships SET status='revoked' WHERE tenant_id=? AND user_id=?").bind(f.actor.tenantId,f.actor.userId).run();
 const responseToConfirmation=f.voice.onTurn('Yes',{...f.context,messages:[{role:'assistant',content:'Say yes to enable.'}]});
 if(mode==='revoked')await expect(responseToConfirmation).rejects.toThrow('workspace is not available');
 else {const reply=await responseToConfirmation;expect(typeof reply).toBe('string');expect(reply).not.toContain('emails are enabled');}
 const preference=await f.env.AGENT_DB.prepare('SELECT enabled FROM mayor_email_preferences WHERE tenant_id=?').bind(f.actor.tenantId).first();expect(preference?.enabled??0).toBe(0);expect(f.sent).toHaveLength(0);
});
