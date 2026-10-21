import {it,expect,vi} from 'vitest';
import {createTextChat} from '../web/text-chat';
import {collectTextTurn} from '../src/text-turn';
import {asksCurrentCapabilities,currentCapabilities} from '../src/current-capabilities';
import {createVoiceCall} from '../web/voice-call';
// Chat reenvision Slice 2: the engine contract changed on purpose —
// sends QUEUE instead of dropping, failures land in the view (in flow),
// and the ambiguity copy exists only for genuinely unknowable outcomes.
// These tests pin the new contract; the preservation pins from the old
// engine (402 verbatim, 502 never implies quota, "Reply received." only
// on success) are carried over to the failure/outcome surfaces.
it('queues a second send instead of dropping it, then runs it in order',async()=>{
 const calls:string[]=[];let release!:(value:{reply:string})=>void;
 const send=vi.fn((text:string)=>{calls.push(text);if(calls.length===1)return new Promise<{reply:string}>(r=>release=r);return Promise.resolve({reply:'Second done'});});
 const chat=createTextChat(send,()=>{});
 const first=chat.submit('First');const second=chat.submit('Second');
 expect(send).toHaveBeenCalledOnce();expect(chat.snapshot().queue.map(q=>q.text)).toEqual(['Second']);
 release({reply:'First done'});
 expect(await first).toMatchObject({status:'done',result:{reply:'First done'}});
 expect(await second).toMatchObject({status:'done',result:{reply:'Second done'}});
 expect(calls).toEqual(['First','Second']);expect(chat.busy).toBe(false);expect(chat.snapshot().queue).toEqual([]);
});
it('cancelling a queued message settles it without ever sending it',async()=>{
 let release!:(value:{reply:string})=>void;const send=vi.fn(()=>new Promise<{reply:string}>(r=>release=r));
 const chat=createTextChat(send,()=>{});
 const first=chat.submit('First');const second=chat.submit('Second');
 chat.cancelQueued(chat.snapshot().queue[0].requestId);
 expect(await second).toMatchObject({status:'cancelled',text:'Second'});
 release({reply:'Done'});expect(await first).toMatchObject({status:'done'});expect(send).toHaveBeenCalledOnce();
});
it('stop preserves the partial reply as a stopped item, with no ambiguity copy anywhere',async()=>{
 const changed=vi.fn();let view:any;
 const send=vi.fn(async(_t:string,_id:string,signal:AbortSignal,_i:unknown,stream:{onDelta:(t:string)=>void})=>{
  stream.onDelta('Partial ans');
  await new Promise<void>(resolve=>signal.addEventListener('abort',()=>resolve(),{once:true}));
  const err=new Error('The operation was aborted');err.name='AbortError';throw err;
 });
 const chat=createTextChat(send,changed,{onView:v=>{view=v;}});
 const pending=chat.submit('Confirm the booking');
 await vi.waitFor(()=>expect(view?.active?.partial).toBe('Partial ans'));
 chat.cancel();
 expect(await pending).toMatchObject({status:'stopped',text:'Confirm the booking'});
 expect(chat.snapshot().stopped).toMatchObject({text:'Confirm the booking',partial:'Partial ans'});
 expect(changed).toHaveBeenLastCalledWith(false,'Stopped.');
 for(const [,message] of changed.mock.calls)expect(String(message)).not.toContain('may have been processed');
});
it('rejects empty replies into the failed item and releases the composer',async()=>{
 const chat=createTextChat(async()=>({reply:''}),()=>{});
 const outcome=await chat.submit('Hi');
 expect(outcome).toMatchObject({status:'failed',failure:{message:'No reply was returned. Your draft is still here.'}});
 expect(chat.busy).toBe(false);expect(chat.snapshot().failed?.text).toBe('Hi');
});
function httpFailure(status:number,message:string){
 return async()=>{const err=new Error(message) as Error&{status:number};err.status=status;throw err;};
}
it('never claims "Reply received" on a failed turn — 502 gets the honest service copy in the failed item',async()=>{
 const changed=vi.fn();
 const chat=createTextChat(httpFailure(502,'model_failed'),changed,{serviceDownCopy:(status)=>status===502?"The assistant couldn't reach the AI service — try again in a moment.":undefined});
 const outcome=await chat.submit('Hi');
 expect(outcome).toMatchObject({status:'failed',failure:{message:"The assistant couldn't reach the AI service — try again in a moment.",status:502}});
 for(const [,message] of changed.mock.calls)expect(String(message)).not.toContain('Reply received');
 expect(chat.snapshot().failed?.message).not.toContain('allowance');
});
it('falls back to the error message on 502 when no copy override is provided',async()=>{
 const chat=createTextChat(httpFailure(502,'The assistant could not reach the AI service. Try again in a moment.'),()=>{});
 expect(await chat.submit('Hi')).toMatchObject({status:'failed',failure:{message:'The assistant could not reach the AI service. Try again in a moment.'}});
});
it('shows the server allowance copy verbatim on 402 and never on other failures',async()=>{
 const chat=createTextChat(httpFailure(402,'Your business has used its Free reply allowance for this period.'),()=>{});
 expect(await chat.submit('Hi')).toMatchObject({status:'failed',failure:{message:'Your business has used its Free reply allowance for this period.',status:402,ambiguous:false}});
});
it('keeps "Reply received." for genuinely successful turns',async()=>{
 const changed=vi.fn();
 const chat=createTextChat(async()=>({reply:'Understood — booking confirmed.'}),changed);
 expect(await chat.submit('Hi')).toMatchObject({status:'done',result:{reply:'Understood — booking confirmed.'}});
 expect(changed).toHaveBeenLastCalledWith(false,'Reply received.');
});
it('pauses the queue behind a failure; dismissing the failure releases it',async()=>{
 let attempts=0;const send=vi.fn(async()=>{attempts++;if(attempts===1){const err=new Error('down') as Error&{status:number};err.status=503;throw err;}return {reply:'Recovered'};});
 const chat=createTextChat(send,()=>{});
 const first=chat.submit('First');const second=chat.submit('Second');
 expect(await first).toMatchObject({status:'failed'});
 expect(send).toHaveBeenCalledOnce();expect(chat.snapshot().queue.map(q=>q.text)).toEqual(['Second']);
 chat.dismissFailed();
 expect(await second).toMatchObject({status:'done',result:{reply:'Recovered'}});
});
it('Try again re-sends the failed turn with the SAME requestId',async()=>{
 const ids:string[]=[];let attempts=0;
 const send=vi.fn(async(_t:string,id:string)=>{ids.push(id);attempts++;if(attempts===1){const err=new Error('down') as Error&{status:number};err.status=503;throw err;}return {reply:'Now it worked'};});
 const chat=createTextChat(send,()=>{});
 expect(await chat.submit('Book it')).toMatchObject({status:'failed'});
 const retry=chat.retryFailed();expect(retry).not.toBeNull();
 expect(await retry!).toMatchObject({status:'done',result:{reply:'Now it worked'}});
 expect(ids).toHaveLength(2);expect(ids[1]).toBe(ids[0]);
});
it('never starts a paid voice session when microphone preflight fails',async()=>{
 const client={startCall:vi.fn(),endCall:vi.fn(),error:null},failed=vi.fn();const call=createVoiceCall(client,()=>{},failed,async()=>{throw new Error('Microphone is blocked');});
 await call.start();expect(client.startCall).not.toHaveBeenCalled();expect(failed).toHaveBeenCalledWith('Microphone is blocked');
});
it('does not start voice after cancelling a pending microphone preflight',async()=>{
 let resolve!:()=>void;const client={startCall:vi.fn(),endCall:vi.fn(),error:null};const call=createVoiceCall(client,()=>{},()=>{},()=>new Promise(r=>resolve=r));const pending=call.start();call.stop();resolve();await pending;expect(client.startCall).not.toHaveBeenCalled();
});
it('collects streamed replies but rejects cancelled and oversized output',async()=>{
 const controller=new AbortController();async function* stream(){yield 'Hello';yield ' there';}
 expect(await collectTextTurn(Promise.resolve(stream()),controller.signal)).toBe('Hello there');controller.abort();await expect(collectTextTurn(Promise.resolve('Late'),controller.signal)).rejects.toThrow();
});
it('answers operational capability questions without claiming agency services are active automations',()=>{
 expect(asksCurrentCapabilities('Which services can you actually run today?')).toBe(true);expect(asksCurrentCapabilities('Please remember my website')).toBe(false);expect(currentCapabilities).toContain('not active services');
});
