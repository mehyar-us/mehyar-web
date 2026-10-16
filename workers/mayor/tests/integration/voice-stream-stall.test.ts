import {env as testEnv} from 'cloudflare:workers';
import {afterEach,expect,it,vi} from 'vitest';
import type {Env} from '../../src/env';
import {MayorVoice,voiceStreamDeadlines} from '../../src/voice';

// The reported voice wedge, reproduced at the turn: the model stream opens
// and then goes silent forever (a stalled gateway/provider response). Before
// the deadline fix, consuming the turn's speech stream never completed — the
// call sat in thinking/speaking until the owner killed the browser. The turn
// must now finish on its own with a short spoken fallback.
const env=testEnv as unknown as Env;
const defaults={...voiceStreamDeadlines};
afterEach(()=>{Object.assign(voiceStreamDeadlines,defaults);vi.restoreAllMocks();});

async function business(){
 const actor={tenantId:crypto.randomUUID(),userId:crypto.randomUUID()};
 await env.AGENT_DB.prepare('INSERT INTO agent_tenants(id,name,created_at) VALUES(?,?,?)').bind(actor.tenantId,'Voice stall fixture',new Date().toISOString()).run();
 await env.AGENT_DB.prepare('INSERT INTO agent_memberships(tenant_id,user_id,role) VALUES(?,?,?)').bind(actor.tenantId,actor.userId,'owner').run();
 return actor;
}
function instance(actor:{tenantId:string;userId:string},ai:unknown){
 const voice=Object.create(MayorVoice.prototype) as any,connection={id:crypto.randomUUID(),send:vi.fn()};
 for(const key of ['generations','pending','pendingCalendar','pendingPolicy','pendingBooking','pendingChange','pendingCallback','pendingCustomer'])voice[key]=new Map();
 Object.assign(voice,{env:{...env,AI:ai},ready:new Set(),authorize:async()=>actor,speak:vi.fn(async()=>{}),forceEndCall:vi.fn()});
 return {voice,connection};
}

it('completes a turn whose model stream goes silent, with a spoken fallback',async()=>{
 Object.assign(voiceStreamDeadlines,{idleMs:60,totalMs:400});
 const actor=await business();
 // A stream that opens and never emits, never ends: the stall itself.
 const hangingAi={run:async()=>new ReadableStream<Uint8Array>({start(){}})};
 const {voice,connection}=instance(actor,hangingAi);
 const consume=(async()=>{
  const result=await voice.onTurn('What is your name?',{connection,messages:[],signal:new AbortController().signal});
  if(typeof result==='string')return result;
  let text='';for await(const part of result)text+=part;return text;
 })();
 const outcome=await Promise.race([
  consume.then(text=>({done:true,text})),
  new Promise<{done:false}>(resolve=>setTimeout(()=>resolve({done:false}),5000)),
 ]);
 expect(outcome.done).toBe(true);
 if(outcome.done)expect(outcome.text).toContain('took too long');
});
