import {env as testEnv} from 'cloudflare:workers';
import {it,expect} from 'vitest';
import type {Env} from '../../src/env';
import {refreshAttentionNotifications,listNotifications,markNotificationRead} from '../../src/notifications';
import {confirmProfile} from '../../src/memory';
const env=testEnv as unknown as Env;
async function fixture(){
 const actor={tenantId:crypto.randomUUID(),userId:crypto.randomUUID()};
 await env.AGENT_DB.prepare('INSERT INTO agent_tenants(id,name,created_at) VALUES(?,?,?)').bind(actor.tenantId,'Notification fixture',new Date().toISOString()).run();
 await env.AGENT_DB.prepare("INSERT INTO agent_memberships(tenant_id,user_id,role) VALUES(?,?,'owner')").bind(actor.tenantId,actor.userId).run();
 return actor;
}
it('deduplicates attention, preserves reads, resolves completed onboarding and reopens incomplete onboarding',async()=>{
 const actor=await fixture();
 const first=await refreshAttentionNotifications(env,actor);
 expect(first.notifications).toHaveLength(1);
 const id=first.notifications[0].id;
 await markNotificationRead(env,actor,id);
 await markNotificationRead(env,actor,id);
 const again=await refreshAttentionNotifications(env,actor);
 expect(again.notifications).toHaveLength(1);
 expect(again.notifications[0]).toMatchObject({id,read:true,action:'chat'});
 await confirmProfile(env,actor,{name:'Real business',services:['Consulting']},0);
 expect((await refreshAttentionNotifications(env,actor)).notifications).toEqual([]);
 await expect(markNotificationRead(env,actor,id)).rejects.toThrow();
 await confirmProfile(env,actor,{services:[]},1);
 expect((await refreshAttentionNotifications(env,actor)).notifications[0]).toMatchObject({id,read:false});
});
it('isolates inboxes by both tenant and user',async()=>{
 const actor=await fixture(),other=await fixture();
 const id=(await refreshAttentionNotifications(env,actor)).notifications[0].id;
 expect((await listNotifications(env,other)).notifications).toEqual([]);
 await expect(markNotificationRead(env,other,id)).rejects.toThrow();
 const colleague={...actor,userId:crypto.randomUUID()};
 await env.AGENT_DB.prepare("INSERT INTO agent_memberships(tenant_id,user_id,role) VALUES(?,?,'manager')").bind(actor.tenantId,colleague.userId).run();
 expect((await listNotifications(env,colleague)).notifications).toEqual([]);
 await expect(markNotificationRead(env,colleague,id)).rejects.toThrow();
 expect((await refreshAttentionNotifications(env,colleague)).notifications[0].id).not.toBe(id);
 expect((await listNotifications(env,actor)).notifications[0].read).toBe(false);
});
it('denies access after the membership loses management permission',async()=>{
 const actor=await fixture();
 const id=(await refreshAttentionNotifications(env,actor)).notifications[0].id;
 await env.AGENT_DB.prepare("UPDATE agent_memberships SET role='staff' WHERE tenant_id=? AND user_id=?").bind(actor.tenantId,actor.userId).run();
 await expect(listNotifications(env,actor)).rejects.toThrow();
 await expect(refreshAttentionNotifications(env,actor)).rejects.toThrow();
 await expect(markNotificationRead(env,actor,id)).rejects.toThrow();
});
