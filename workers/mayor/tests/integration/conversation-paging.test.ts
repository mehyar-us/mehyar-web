import {env as testEnv} from 'cloudflare:workers';
import {beforeEach,it,expect} from 'vitest';
import type {Env} from '../../src/env';
import {createAuth} from '../../src/auth';
import {writeConversationRecovery,type RecoveryMessage} from '../../src/conversation-recovery';
import worker from '../../src';
const env=testEnv as unknown as Env;
let cookie='',tenantId='';
const messages:RecoveryMessage[]=Array.from({length:30},(_,i)=>({role:i%2?'assistant':'user',content:`Message ${i+1}`}));
beforeEach(async()=>{
 const ctx=await createAuth(env).$context;
 const user=await ctx.internalAdapter.createUser({email:`${crypto.randomUUID()}@example.test`,name:'Paging fixture',emailVerified:true});
 const session=await ctx.internalAdapter.createSession(user.id);
 tenantId=crypto.randomUUID().replaceAll('-','');
 await env.AGENT_DB.prepare('INSERT INTO agent_tenants(id,name,created_at) VALUES(?,?,?)').bind(tenantId,'Paging fixture',new Date().toISOString()).run();
 await env.AGENT_DB.prepare("INSERT INTO agent_memberships(tenant_id,user_id,role) VALUES(?,?,'owner')").bind(tenantId,user.id).run();
 await writeConversationRecovery(env,{tenantId,userId:user.id,sessionId:session.id},0,messages);
 const row=await env.AGENT_DB.prepare('SELECT token FROM auth_session WHERE id=?').bind(session.id).first<{token:string}>();
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.BETTER_AUTH_SECRET!),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const signature=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(row!.token));
 cookie='__Secure-mehyar-agent.session_token='+encodeURIComponent(row!.token+'.'+btoa(String.fromCharCode(...new Uint8Array(signature))));
});
const get=(query='')=>worker.fetch(new Request(`https://mayor.example.test/api/businesses/${tenantId}/conversation${query}`,{headers:{cookie}}),env,{} as ExecutionContext);

it('without paging params the response is exactly the pre-Slice-2 shape (no total/hasMore)',async()=>{
 const response=await get();expect(response.status).toBe(200);
 const body=await response.json() as any;
 expect(body.messages).toHaveLength(30);expect(body.revision).toBe(1);
 expect('total' in body).toBe(false);expect('hasMore' in body).toBe(false);
});
it('?limit returns the LATEST page with total and hasMore',async()=>{
 const body=await (await get('?limit=20')).json() as any;
 expect(body.total).toBe(30);expect(body.hasMore).toBe(true);
 expect(body.messages.map((m:any)=>m.content)).toEqual(messages.slice(10).map(m=>m.content));
});
it('?limit&before pages backwards to the start, then hasMore closes',async()=>{
 const body=await (await get('?limit=20&before=20')).json() as any;
 expect(body.total).toBe(30);expect(body.hasMore).toBe(false);
 expect(body.messages.map((m:any)=>m.content)).toEqual(messages.slice(0,10).map(m=>m.content));
});
it('garbage paging params fall back to sane bounds instead of failing',async()=>{
 const body=await (await get('?limit=abc&before=-5')).json() as any;
 expect(body.messages).toHaveLength(30);expect(body.hasMore).toBe(false);
 const wide=await (await get('?limit=500')).json() as any;
 expect(wide.messages).toHaveLength(30);expect(wide.hasMore).toBe(false);
});
