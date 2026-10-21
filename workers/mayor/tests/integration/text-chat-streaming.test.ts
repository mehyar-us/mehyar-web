import {env as testEnv} from 'cloudflare:workers';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {MayorVoice} from '../../src/voice';
import {createAuth} from '../../src/auth';
import type {Env} from '../../src/env';
const env=testEnv as unknown as Env;let identity:any,voice:any,history:any[],receipts:Map<string,string|null>;
beforeEach(async()=>{
 const ctx=await createAuth(env).$context,user=await ctx.internalAdapter.createUser({email:`${crypto.randomUUID()}@example.test`,name:'Stream fixture',emailVerified:true}),session=await ctx.internalAdapter.createSession(user.id);
 identity={tenantId:crypto.randomUUID().replaceAll('-',''),userId:user.id,sessionId:session.id};
 await env.AGENT_DB.prepare('INSERT INTO agent_tenants(id,name,created_at) VALUES(?,?,?)').bind(identity.tenantId,'Stream fixture',new Date().toISOString()).run();
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
function request(text:string,id=crypto.randomUUID(),stream=false){
 return new Request('https://mayor.example.test/agents/mayor-voice/test/chat',{method:'POST',headers:{'content-type':'application/json','x-mayor-tenant':identity.tenantId,'x-mayor-user':identity.userId,'x-mayor-session':identity.sessionId,...(stream?{'x-mayor-stream':'ndjson'}:{})},body:JSON.stringify({text,requestId:id})});
}
async function readFrames(response:Response,onFrame?:(frame:any)=>void):Promise<any[]>{
 const frames:any[]=[];const reader=response.body!.getReader();const decoder=new TextDecoder();let buffer='';
 for(;;){const {done,value}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});
  let index=buffer.indexOf('\n');while(index>=0){const line=buffer.slice(0,index);buffer=buffer.slice(index+1);if(line.trim()){const frame=JSON.parse(line);frames.push(frame);onFrame?.(frame);}index=buffer.indexOf('\n');}}
 return frames;
}
const sleep=(ms:number)=>new Promise(r=>setTimeout(r,ms));

it('streams delta/event/done frames in turn order — first delta lands before the turn finishes',async()=>{
 let turnFinished=false;const seen:{frame:any;turnFinished:boolean}[]=[];
 voice.onTurn=async function*(_text:string,context:any){
  yield 'First ';
  await sleep(120);
  context.connection.send(JSON.stringify({type:'connector_card',card:{id:'card-1'}}));
  yield 'part.';
  turnFinished=true;
 };
 const id=crypto.randomUUID();
 const response=await voice.onRequest(request('Connect my calendar',id,true));
 expect(response.status).toBe(200);expect(response.headers.get('content-type')).toContain('application/x-ndjson');
 const frames=await readFrames(response,frame=>seen.push({frame,turnFinished}));
 expect(frames.map(f=>f.type)).toEqual(['delta','event','delta','done']);
 expect(frames[0].text).toBe('First ');
 expect(frames[1].event).toEqual({type:'connector_card',card:{id:'card-1'}});
 expect(frames[3]).toMatchObject({reply:'First part.',requestId:id});
 // The first delta was delivered while the turn was still running.
 expect(seen[0].turnFinished).toBe(false);
 expect(history.map((m:any)=>m.role)).toEqual(['user','assistant']);
 // Receipt parity: replaying the same requestId returns the stored
 // whole-reply body, events in arrival order — the fallback contract.
 const replay=await voice.onRequest(request('Connect my calendar',id));
 expect(replay.headers.get('content-type')).toContain('application/json');
 expect(await replay.json()).toEqual({reply:'First part.',events:[{type:'connector_card',card:{id:'card-1'}}],requestId:id});
 expect(history).toHaveLength(2);
});

it('without the stream header the whole-reply contract is byte-identical (old client)',async()=>{
 voice.onTurn=async()=>'Whole reply';
 const response=await voice.onRequest(request('Hello'));
 expect(response.status).toBe(200);expect(response.headers.get('content-type')).toContain('application/json');
 const body=await response.json();expect(body.reply).toBe('Whole reply');expect(body.events).toEqual([]);expect(typeof body.requestId).toBe('string');
});

it('a usage denial surfaces as ONE error frame (429, verbatim message) — the held notice is never framed as an event',async()=>{
 voice.onTurn=async(_text:string,context:any)=>{context.connection.send(JSON.stringify({type:'usage_notice',kind:'turn',allowed:false,remaining:0,limit:100,message:'Your business has used its Free reply allowance for this period.'}));return '';};
 const response=await voice.onRequest(request('One more thing',crypto.randomUUID(),true));
 const frames=await readFrames(response);
 expect(frames).toEqual([{type:'error',status:429,message:'Your business has used its Free reply allowance for this period.'}]);
 expect(history.map((m:any)=>m.role)).toEqual(['user']);
});

it('an allowed usage notice is still delivered — held during the turn, flushed before done',async()=>{
 voice.onTurn=async(_text:string,context:any)=>{context.connection.send(JSON.stringify({type:'usage_notice',kind:'turn',allowed:true,remaining:9,limit:100}));return 'All set';};
 const frames=await readFrames(await voice.onRequest(request('Hi',crypto.randomUUID(),true)));
 // The notice is emitted by the turn BEFORE the reply exists, but it is
 // held and flushed after the deltas, before done — its handler only
 // updates the usage line, so the position is not load-bearing.
 expect(frames.map(f=>f.type)).toEqual(['delta','event','done']);
 expect(frames[1].event).toMatchObject({type:'usage_notice',allowed:true,remaining:9});
});

it('a turn that dies mid-stream ends with an in-flow error frame (502 + support reference), partial already delivered',async()=>{
 voice.onTurn=async function*(){yield 'Start of';throw new Error('provider died');};
 const frames=await readFrames(await voice.onRequest(request('Do it',crypto.randomUUID(),true)));
 expect(frames.map(f=>f.type)).toEqual(['delta','error']);
 expect(frames[1].status).toBe(502);expect(frames[1].message).toContain('Support reference:');
 expect(voice.textBusy).toBe(false);
});

it('pre-stream failures stay JSON in streaming mode (busy 409, exactly as the fallback)',async()=>{
 voice.textBusy=true;
 const response=await voice.onRequest(request('Hi',crypto.randomUUID(),true));
 expect(response.status).toBe(409);expect(response.headers.get('content-type')).toContain('application/json');
});

it('a turn longer than the retired 25s wall completes over the stream',async()=>{
 voice.onTurn=async function*(){yield 'Wait for it';await sleep(26000);yield ' — done';};
 const frames=await readFrames(await voice.onRequest(request('Long task',crypto.randomUUID(),true)));
 expect(frames.map(f=>f.type)).toEqual(['delta','delta','done']);
 expect(frames[2].reply).toBe('Wait for it — done');
},45000);
