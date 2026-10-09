import {env as testEnv} from 'cloudflare:workers';
import {beforeEach,it,expect} from 'vitest';
import type {Env} from '../../src/env';
import type {VoiceIdentity} from '../../src/voice-access';
import {createAuth} from '../../src/auth';
import {readConversationRecovery,writeConversationRecovery,resetConversationRecovery,type RecoveryMessage} from '../../src/conversation-recovery';
const env=testEnv as unknown as Env;
let identity:VoiceIdentity;
const messages:RecoveryMessage[]=[{role:'user',content:'Book a haircut Tuesday.'},{role:'assistant',content:'What time works for you?'}];
beforeEach(async()=>{
 const ctx=await createAuth(env).$context;
 const user=await ctx.internalAdapter.createUser({email:`${crypto.randomUUID()}@example.test`,name:'Reset fixture',emailVerified:true});
 const session=await ctx.internalAdapter.createSession(user.id);
 identity={tenantId:crypto.randomUUID().replaceAll('-',''),userId:user.id,sessionId:session.id};
 await env.AGENT_DB.prepare('INSERT INTO agent_tenants(id,name,created_at) VALUES(?,?,?)').bind(identity.tenantId,'Reset fixture',new Date().toISOString()).run();
 await env.AGENT_DB.prepare("INSERT INTO agent_memberships(tenant_id,user_id,role) VALUES(?,?,'owner')").bind(identity.tenantId,identity.userId).run();
});
async function archiveRows(){
 return (await env.AGENT_DB.prepare('SELECT thread_id,messages_json FROM mayor_conversation_archive WHERE tenant_id=? AND user_id=?').bind(identity.tenantId,identity.userId).all<{thread_id:string;messages_json:string}>()).results;
}
it('archives the current thread and starts a fresh recovery lineage',async()=>{
 await writeConversationRecovery(env,identity,0,messages);
 const result=await resetConversationRecovery(env,identity);
 expect(result.reset).toBe(true);
 expect(result.archived).toBe(true);
 expect(result.threadId).toMatch(/^[0-9a-f-]{36}$/);
 // The live snapshot is gone; the next read starts a fresh thread.
 expect(await readConversationRecovery(env,identity)).toEqual({revision:0,messages:[]});
 // Past history is preserved in the archive, never deleted.
 const rows=await archiveRows();
 expect(rows).toHaveLength(1);
 expect(rows[0].thread_id).toBe(result.threadId);
 expect(JSON.parse(rows[0].messages_json)).toEqual(messages);
 // A new turn starts a fresh revision lineage on the same thread key.
 expect(await writeConversationRecovery(env,identity,0,[messages[0]])).toBe(1);
 expect(await readConversationRecovery(env,identity)).toEqual({revision:1,messages:[messages[0]]});
});
it('resets an empty thread without archiving anything',async()=>{
 const result=await resetConversationRecovery(env,identity);
 expect(result.reset).toBe(true);
 expect(result.archived).toBe(false);
 expect(await readConversationRecovery(env,identity)).toEqual({revision:0,messages:[]});
 expect(await archiveRows()).toHaveLength(0);
});
it.each(['tenant','user','viewer'] as const)('denies reset for %s and keeps the snapshot intact',async reason=>{
 await writeConversationRecovery(env,identity,0,messages);
 const candidate={...identity};
 if(reason==='tenant')candidate.tenantId=crypto.randomUUID();
 if(reason==='user')candidate.userId=crypto.randomUUID();
 if(reason==='viewer')await env.AGENT_DB.prepare("UPDATE agent_memberships SET role='viewer' WHERE tenant_id=?").bind(identity.tenantId).run();
 await expect(resetConversationRecovery(env,candidate)).rejects.toThrow();
 // Restore the owner role so the intact-snapshot assertion can read again.
 if(reason==='viewer')await env.AGENT_DB.prepare("UPDATE agent_memberships SET role='owner' WHERE tenant_id=?").bind(identity.tenantId).run();
 expect(await readConversationRecovery(env,identity)).toEqual({revision:1,messages});
 expect(await archiveRows()).toHaveLength(0);
});
