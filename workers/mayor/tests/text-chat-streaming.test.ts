import {it,expect,vi,afterEach} from 'vitest';
import {readFileSync} from 'node:fs';
import {createTextChat,readNdjsonTurn,applyTextOutcome,textChatLimits,AMBIGUOUS_TURN_COPY,type TextTurnOutcome} from '../web/text-chat';
import {streamTextTurn,textStreamLimits,StreamIdleTimeout} from '../src/text-turn';

/** Chat reenvision Slice 2 — streaming transport pins. */

function streamOf(chunks:string[],splitEvery=7):ReadableStream<Uint8Array>{
 const bytes=new TextEncoder().encode(chunks.join(''));
 let offset=0;
 return new ReadableStream({pull(controller){
  if(offset>=bytes.length){controller.close();return;}
  const next=bytes.slice(offset,offset+splitEvery);offset+=next.length;controller.enqueue(next);
 }});
}
const frames=(list:unknown[])=>list.map(f=>JSON.stringify(f)).join('\n')+'\n';

it('reads NDJSON frames split mid-line and assembles the reply from the done frame',async()=>{
 const deltas:string[]=[];const events:unknown[]=[];
 const result=await readNdjsonTurn(streamOf([frames([
  {type:'delta',text:'Hello '},
  {type:'event',event:{type:'connector_card',card:{id:'c1'}}},
  {type:'delta',text:'there'},
  {type:'done',reply:'Hello there',requestId:'r1'},
 ])]),{onDelta:t=>deltas.push(t),onEvent:e=>events.push(e)});
 expect(deltas).toEqual(['Hello ','there']);
 expect(events).toEqual([{type:'connector_card',card:{id:'c1'}}]);
 expect(result.reply).toBe('Hello there');
});

it('an error frame throws with its status (in-flow failure state)',async()=>{
 await expect(readNdjsonTurn(streamOf([frames([{type:'delta',text:'par'},{type:'error',status:502,message:'I could not finish this reply.'}])]),{onDelta:()=>{},onEvent:()=>{}}))
  .rejects.toMatchObject({status:502,message:'I could not finish this reply.'});
});

it('a stream that ends without a terminal frame is flagged ambiguous — the ONLY home of the retired copy',async()=>{
 const error=await readNdjsonTurn(streamOf([frames([{type:'delta',text:'par'}])]),{onDelta:()=>{},onEvent:()=>{}}).catch(e=>e);
 expect(error.ambiguous).toBe(true);
 const chat=createTextChat(async()=>{throw error;},()=>{});
 const outcome=await chat.submit('Did that save?');
 expect(outcome).toMatchObject({status:'failed',failure:{message:AMBIGUOUS_TURN_COPY,ambiguous:true}});
});

it('first delta is observable in the view BEFORE the turn completes (timing logged)',async()=>{
 const log:{t:number;note:string}[]=[];const t0=Date.now();
 const send=vi.fn(async(_t:string,_id:string,_s:AbortSignal,_i:unknown,stream:{onDelta:(t:string)=>void})=>{
  await new Promise(r=>setTimeout(r,20));stream.onDelta('First');
  await new Promise(r=>setTimeout(r,60));
  return {reply:'First and done'};
 });
 const chat=createTextChat(send,()=>{},{onView:v=>{if(v.active?.partial)log.push({t:Date.now()-t0,note:`partial visible: "${v.active.partial}" phase=${v.active.phase}`});}});
 const outcome=await chat.submit('Long one');
 log.push({t:Date.now()-t0,note:'turn settled'});
 expect(await outcome).toMatchObject({status:'done'});
 const firstPartial=log.find(e=>e.note.includes('partial visible'));
 const settled=log.find(e=>e.note==='turn settled');
 console.log('slice2 timing:',JSON.stringify(log));
 expect(firstPartial).toBeDefined();expect(settled).toBeDefined();
 expect(firstPartial!.t).toBeLessThan(settled!.t);
});

it('the idle deadline — not a total wall — ends a wedged stream with the ambiguous failure',async()=>{
 const restore=textChatLimits.idleMs;textChatLimits.idleMs=40;
 try{
  const send=vi.fn((_t:string,_id:string,signal:AbortSignal)=>new Promise<{reply:string}>((_resolve,reject)=>{
   signal.addEventListener('abort',()=>{const err=new Error('aborted');err.name='AbortError';reject(err);},{once:true});
  }));
  const chat=createTextChat(send,()=>{});
  const outcome=await chat.submit('Slow service');
  expect(outcome).toMatchObject({status:'failed',failure:{ambiguous:true,message:AMBIGUOUS_TURN_COPY}});
 }finally{textChatLimits.idleMs=restore;}
});

it('streamTextTurn emits chunks as they arrive and enforces idle, not total, bounds',async()=>{
 const emitted:string[]=[];const controller=new AbortController();
 async function* slow(){yield 'a';await new Promise(r=>setTimeout(r,30));yield 'b';}
 await expect(streamTextTurn(Promise.resolve(slow()),controller.signal,t=>emitted.push(t))).resolves.toBe('ab');
 expect(emitted).toEqual(['a','b']);
 const restoreIdle=textStreamLimits.idleMs,restoreTotal=textStreamLimits.totalMs;
 textStreamLimits.idleMs=25;textStreamLimits.totalMs=60000;
 try{
  async function* wedged(){yield 'x';await new Promise(r=>setTimeout(r,5000));yield 'y';}
  await expect(streamTextTurn(Promise.resolve(wedged()),controller.signal,()=>{})).rejects.toBeInstanceOf(StreamIdleTimeout);
 }finally{textStreamLimits.idleMs=restoreIdle;textStreamLimits.totalMs=restoreTotal;}
});

it('the retired sentence exists ONLY as AMBIGUOUS_TURN_COPY in the web bundle sources',()=>{
 const sentence='Stopped waiting. Your message may have been processed. Refresh the conversation before repeating a change.';
 let total=0;
 for(const file of ['text-chat.ts','main.ts','transcript-list.tsx','chat-app.tsx','composer-cluster.tsx']){
  const source=readFileSync(new URL(`../web/${file}`,import.meta.url),'utf8');
  const count=source.split(sentence).length-1;
  if(file==='text-chat.ts')expect(count).toBe(1);
  else expect(count).toBe(0);
  total+=count;
 }
 expect(total).toBe(1);
 expect(AMBIGUOUS_TURN_COPY).toBe(sentence);
});
it('DEF-010: a malformed frame mid-stream is skipped — the turn completes, never ambiguous, queue never jams',async()=>{
 const deltas:string[]=[];
 const body=frames([{type:'delta',text:'Hello '}])+'{this is not json\n'+'12345\n'+frames([{type:'delta',text:'there'},{type:'done',reply:'Hello there',requestId:'r9'}]);
 const result=await readNdjsonTurn(streamOf([body]),{onDelta:t=>deltas.push(t),onEvent:()=>{}});
 expect(deltas).toEqual(['Hello ','there']);
 expect(result.reply).toBe('Hello there');
 // Engine level: the same stream through a full turn settles done,
 // and the NEXT turn flows — a poisoned frame cannot jam the queue.
 const chat=createTextChat(async()=>readNdjsonTurn(streamOf([body]),{onDelta:()=>{},onEvent:()=>{}}),()=>{});
 expect(await chat.submit('One')).toMatchObject({status:'done'});
 expect(await chat.submit('Two')).toMatchObject({status:'done'});
 expect(chat.snapshot().failed).toBeUndefined();
});

it('DEF-011: the reader is cancelled and released however the read ends',async()=>{
 let cancelled=false;
 const errorBody=new ReadableStream<Uint8Array>({start(controller){controller.enqueue(new TextEncoder().encode(frames([{type:'delta',text:'par'},{type:'error',status:502,message:'I could not finish this reply.'}])));},cancel(){cancelled=true;}});
 await expect(readNdjsonTurn(errorBody,{onDelta:()=>{},onEvent:()=>{}})).rejects.toMatchObject({status:502});
 expect(cancelled).toBe(true);
 const okBody=streamOf([frames([{type:'done',reply:'All good',requestId:'r2'}])]);
 await expect(readNdjsonTurn(okBody,{onDelta:()=>{},onEvent:()=>{}})).resolves.toEqual({reply:'All good'});
 // The lock is released: a fresh reader can be taken on the stream.
 expect(()=>okBody.getReader()).not.toThrow();
});

it('DEF-014: Stop → send another message — the stopped partial persists in the saved transcript',async()=>{
 const saved:{role:string;text:string}[]=[];
 const send=vi.fn(async(text:string,_id:string,signal:AbortSignal,_images:unknown,stream:{onDelta:(t:string)=>void})=>{
  if(text==='First question'){
   stream.onDelta('Partial ans');
   await new Promise<never>((_resolve,reject)=>{signal.addEventListener('abort',()=>{const err=new Error('aborted');err.name='AbortError';reject(err);},{once:true});});
  }
  return {reply:'Second answer'};
 });
 const chat=createTextChat(send,()=>{});
 // Mirror main.ts settleTextOutcome: commit the outcome into the
 // saved model, then retire the engine's stopped overlay.
 const settle=async(outcome:Promise<TextTurnOutcome>)=>{
  const resolved=await outcome;
  const applied=applyTextOutcome(saved,resolved);
  if(resolved.status==='stopped')chat.commitStopped();
  return {resolved,applied};
 };
 const first=chat.submit('First question');
 expect(first).not.toBeNull();
 await vi.waitFor(()=>expect(chat.snapshot().active?.partial).toBe('Partial ans'));
 chat.cancel();
 const stoppedOutcome=await first!;
 expect(stoppedOutcome).toMatchObject({status:'stopped',text:'First question',partial:'Partial ans'});
 // Before the settle commit, the overlay still renders the stopped item.
 expect(chat.snapshot().stopped).toMatchObject({text:'First question',partial:'Partial ans'});
 const firstSettle=await settle(Promise.resolve(stoppedOutcome));
 expect(firstSettle.applied).toBe(true);
 expect(chat.snapshot().stopped).toBeUndefined();
 const secondSettle=await settle(chat.submit('Second question')!);
 expect(secondSettle.resolved).toMatchObject({status:'done'});
 // The stopped pair survived the second submit, in order, with its marker.
 expect(saved).toEqual([
  {role:'user',text:'First question'},
  {role:'assistant',text:'Partial ans\n\nStopped — here’s what I had'},
  {role:'user',text:'Second question'},
  {role:'assistant',text:'Second answer'},
 ]);
});

it('DEF-014: submit alone never clears an uncommitted stopped overlay',async()=>{
 const send=vi.fn(async(text:string,_id:string,signal:AbortSignal,_images:unknown,stream:{onDelta:(t:string)=>void})=>{
  if(text==='Hold on'){
   stream.onDelta('Half an answer');
   await new Promise<never>((_resolve,reject)=>{signal.addEventListener('abort',()=>{const err=new Error('aborted');err.name='AbortError';reject(err);},{once:true});});
  }
  return {reply:'Later answer'};
 });
 const chat=createTextChat(send,()=>{});
 const first=chat.submit('Hold on');
 await vi.waitFor(()=>expect(chat.snapshot().active?.partial).toBe('Half an answer'));
 chat.cancel();
 await expect(first!).resolves.toMatchObject({status:'stopped',partial:'Half an answer'});
 const second=chat.submit('Another message');
 expect(chat.snapshot().stopped).toMatchObject({partial:'Half an answer'});
 await expect(second!).resolves.toMatchObject({status:'done'});
});

it('applyTextOutcome keeps the done-row shape (photo suffix) it was moved with',()=>{
 const saved:{role:string;text:string}[]=[];
 expect(applyTextOutcome(saved,{status:'done',text:'Look',imageIds:['p1'],result:{reply:'Seen'}})).toBe(true);
 expect(saved).toEqual([{role:'user',text:'Look [photo attached]'},{role:'assistant',text:'Seen'}]);
 expect(applyTextOutcome(saved,{status:'failed',text:'x',failure:{message:'no'}})).toBe(false);
 expect(saved).toHaveLength(2);
});
afterEach(()=>vi.restoreAllMocks());
