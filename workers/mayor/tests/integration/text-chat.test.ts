import {env as testEnv} from 'cloudflare:workers';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {MayorVoice} from '../../src/voice';
import {createAuth} from '../../src/auth';
import type {Env} from '../../src/env';
import worker from '../../src';
const env=testEnv as unknown as Env;let identity:any,voice:any,history:any[],receipts:Map<string,string|null>;
beforeEach(async()=>{
 const ctx=await createAuth(env).$context,user=await ctx.internalAdapter.createUser({email:`${crypto.randomUUID()}@example.test`,name:'Text fixture',emailVerified:true}),session=await ctx.internalAdapter.createSession(user.id);
 identity={tenantId:crypto.randomUUID().replaceAll('-',''),userId:user.id,sessionId:session.id};
 await env.AGENT_DB.prepare('INSERT INTO agent_tenants(id,name,created_at) VALUES(?,?,?)').bind(identity.tenantId,'Text fixture',new Date().toISOString()).run();
 await env.AGENT_DB.prepare("INSERT INTO agent_memberships(tenant_id,user_id,role) VALUES(?,?,'owner')").bind(identity.tenantId,user.id).run();
 voice=Object.create(MayorVoice.prototype);history=[];receipts=new Map();
 for(const key of ['identities','accessWatches','generations','pending','pendingCalendar','pendingPolicy','pendingBooking','pendingChange','pendingCallback','pendingCustomer'])voice[key]=new Map();
 Object.assign(voice,{env,ready:new Set(),recoveryRevision:0,recoveryQueue:Promise.resolve(),ctx:{waitUntil:()=>{}},getConversationHistory:(limit:number)=>history.slice(-limit),sql:(strings:TemplateStringsArray,...values:any[])=>{
 const query=strings.join('?');if(query.startsWith('SELECT'))return receipts.has(values[0])?[{response:receipts.get(values[0])}]:[];
 if(query.startsWith('INSERT'))receipts.set(values[0],null);if(query.startsWith('UPDATE'))receipts.set(values[1],values[0]);return [];
 }});
 vi.spyOn(Object.getPrototypeOf(MayorVoice.prototype),'saveMessage').mockImplementation((role:unknown,content:unknown)=>{history.push({role,content});});
});
afterEach(()=>vi.restoreAllMocks());
function request(text='Which services can you actually run today?',id=crypto.randomUUID()){
 return new Request('https://mayor.example.test/agents/mayor-voice/test/chat',{method:'POST',headers:{'content-type':'application/json','x-mayor-tenant':identity.tenantId,'x-mayor-user':identity.userId,'x-mayor-session':identity.sessionId},body:JSON.stringify({text,requestId:id})});
}
it('delivers authenticated text with durable recovery and replays a receipt without charging a second turn',async()=>{
 const id=crypto.randomUUID();const first=await voice.onRequest(request(undefined,id));expect(first.status).toBe(200);const payload=await first.json();expect(payload.reply).toContain('not active services');expect(history).toHaveLength(2);
 const repeated=await voice.onRequest(request(undefined,id));expect(await repeated.json()).toEqual(payload);expect(history).toHaveLength(2);
 const copy=await env.AGENT_DB.prepare('SELECT messages_json FROM mayor_conversation_recovery WHERE tenant_id=?').bind(identity.tenantId).first<any>();expect(JSON.parse(copy.messages_json)).toHaveLength(2);
});
it('denies revoked access before returning cached replies',async()=>{
 const id=crypto.randomUUID();expect((await voice.onRequest(request(undefined,id))).status).toBe(200);
 await env.AGENT_DB.prepare("UPDATE agent_memberships SET status='revoked' WHERE tenant_id=?").bind(identity.tenantId).run();expect((await voice.onRequest(request(undefined,id))).status).toBe(401);
});
it('rejects overlap without saving or cancelling either voice or text work',async()=>{
 voice.textBusy=true;expect((await voice.onRequest(request())).status).toBe(409);voice.textBusy=false;voice.callOwner={id:'active'};expect((await voice.onRequest(request())).status).toBe(409);expect(history).toEqual([]);
});
it('validates text size before history or model work',async()=>{expect((await voice.onRequest(request('x'.repeat(4001)))).status).toBe(400);expect(history).toEqual([]);});
it('denies public attempts to spoof internal identity headers',async()=>{const response=await worker.fetch(request(),env,{} as ExecutionContext);expect(response.status).toBe(401);});
it('retains uncertain request receipts after model failure instead of repeating side effects',async()=>{
 voice.onTurn=async()=>{throw new Error('provider failure');};const id=crypto.randomUUID();expect((await voice.onRequest(request('Do something',id))).status).toBe(502);expect((await voice.onRequest(request('Do something',id))).status).toBe(409);expect(voice.textBusy).toBe(false);expect(history).toHaveLength(1);
});
it('correlates a failed turn without logging prompts, identity or provider exception text',async()=>{
 const warning=vi.spyOn(console,'warn').mockImplementation(()=>{});
 voice.onTurn=async()=>{throw new Error('secret-provider-token');};
 const response=await voice.onRequest(request('private business question'));
 const body=await response.json();expect(response.status).toBe(502);
 expect(body.supportReference).toMatch(/^[a-f0-9-]{36}$/);expect(body.message).toContain(body.supportReference);
 expect(warning).toHaveBeenCalledWith('mayor_text_failure',{supportReference:body.supportReference,stage:'turn',kind:'internal',elapsedMs:expect.any(Number)});
 const output=JSON.stringify(warning.mock.calls);for(const secret of ['secret-provider-token','private business question',identity.userId,identity.sessionId,identity.tenantId])expect(output).not.toContain(secret);
 expect(voice.textBusy).toBe(false);
});
it('routes a real authenticated Worker request through the Durable Object and recovers its reply',async()=>{
 vi.restoreAllMocks();const session=await env.AGENT_DB.prepare('SELECT token FROM auth_session WHERE id=?').bind(identity.sessionId).first<{token:string}>();
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.BETTER_AUTH_SECRET!),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const signature=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(session!.token));
 const cookie='__Secure-mehyar-agent.session_token='+encodeURIComponent(session!.token+'.'+btoa(String.fromCharCode(...new Uint8Array(signature))));
 const path=`https://mayor.example.test/api/businesses/${identity.tenantId}/conversation`;
 const response=await worker.fetch(new Request(path,{method:'POST',headers:{cookie,origin:'https://mayor.example.test','content-type':'application/json'},body:JSON.stringify({text:'Which services can you actually run today?',requestId:crypto.randomUUID()})}),env,{} as ExecutionContext);
 expect(response.status).toBe(200);expect((await response.json() as any).reply).toContain('not active services');
 const spoofed=await worker.fetch(new Request('https://mayor.example.test/agents/mayor-voice/fake/chat',{method:'POST',headers:{cookie,origin:'https://mayor.example.test','x-mayor-user':identity.userId,'x-mayor-session':identity.sessionId,'x-mayor-tenant':identity.tenantId}}),env,{} as ExecutionContext);expect(spoofed.status).toBe(404);
 const restored=await worker.fetch(new Request(path,{headers:{cookie}}),env,{} as ExecutionContext);expect((await restored.json() as any).messages).toHaveLength(2);
});

