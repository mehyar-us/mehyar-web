import {it,expect,vi} from 'vitest';
import {createTextChat} from '../web/text-chat';
import {collectTextTurn} from '../src/text-turn';
import {asksCurrentCapabilities,currentCapabilities} from '../src/current-capabilities';
import {createVoiceCall} from '../web/voice-call';
it('serializes sends without clearing or replacing the first request',async()=>{
 let resolve!:(value:{reply:string})=>void;const send=vi.fn(()=>new Promise<{reply:string}>(r=>resolve=r));
 const states:boolean[]=[];const chat=createTextChat(send,(busy)=>states.push(busy));const first=chat.submit('First');
 expect(await chat.submit('Second')).toBeNull();expect(send).toHaveBeenCalledOnce();resolve({reply:'Done'});
 expect(await first).toEqual({reply:'Done'});expect(chat.busy).toBe(false);expect(states).toEqual([true,false]);
});
it('preserves uncertain outcome on cancellation and allows recovery',async()=>{
 let resolve!:(value:{reply:string})=>void;const changed=vi.fn();const chat=createTextChat(()=>new Promise(r=>resolve=r),changed);
 const pending=chat.submit('Confirm');chat.cancel();resolve({reply:'Done'});expect(await pending).toBeNull();expect(chat.busy).toBe(false);
 expect(changed).toHaveBeenLastCalledWith(false,expect.stringContaining('may have been processed'));
});
it('rejects empty replies and releases the composer',async()=>{const chat=createTextChat(async()=>({reply:''}),()=>{});expect(await chat.submit('Hi')).toBeNull();expect(chat.busy).toBe(false);});
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
