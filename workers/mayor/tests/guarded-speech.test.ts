import {afterEach,expect,it,vi} from 'vitest';
import {guardedSpeech} from '../src/confirmation';
afterEach(()=>vi.useRealTimers());
const audio=(bytes=8)=>new Uint8Array(bytes).buffer as ArrayBuffer;

it('passes synthesized audio through untouched',async()=>{
 const invalidate=vi.fn(),guarded=guardedSpeech({synthesize:async()=>audio()},invalidate);
 await expect(guarded.synthesize('Hello.')).resolves.toBeInstanceOf(ArrayBuffer);
 expect(invalidate).not.toHaveBeenCalled();
});

it('invalidates proposals when synthesis returns no audio',async()=>{
 const invalidate=vi.fn(),guarded=guardedSpeech({synthesize:async()=>null},invalidate);
 await expect(guarded.synthesize('Hello.')).resolves.toBeNull();
 expect(invalidate).toHaveBeenCalledOnce();
});

it('invalidates proposals and propagates provider failures',async()=>{
 const invalidate=vi.fn(),guarded=guardedSpeech({synthesize:async()=>{throw new Error('provider down');}},invalidate);
 await expect(guarded.synthesize('Hello.')).rejects.toThrow('provider down');
 expect(invalidate).toHaveBeenCalledOnce();
});

/** The reported voice wedge: a Workers AI speech call that never settles must
 *  not hang the call forever. guardedSpeech bounds every synthesis; on timeout
 *  it aborts the provider and returns no audio, so the speech pipeline skips
 *  the sentence and the call returns to listening. */
it('bounds a synthesis that never settles and aborts the provider',async()=>{
 vi.useFakeTimers();
 let providerSignal:AbortSignal|undefined;
 const provider={synthesize:(_text:string,signal?:AbortSignal)=>{providerSignal=signal;return new Promise<ArrayBuffer|null>(()=>{});}};
 const invalidate=vi.fn(),guarded=guardedSpeech(provider,invalidate,1000);
 let settled:unknown='pending';
 const pending=guarded.synthesize('Hello.').then(value=>{settled=value;});
 await vi.advanceTimersByTimeAsync(999);
 expect(settled).toBe('pending');expect(providerSignal?.aborted).toBe(false);
 await vi.advanceTimersByTimeAsync(1);
 await pending;
 expect(settled).toBeNull();
 expect(providerSignal?.aborted).toBe(true);
 expect(invalidate).toHaveBeenCalledOnce();
});

it('returns audio that arrives before the bound and leaves the provider signal live',async()=>{
 vi.useFakeTimers();
 let providerSignal:AbortSignal|undefined;
 const provider={synthesize:async(_text:string,signal?:AbortSignal)=>{providerSignal=signal;await new Promise(resolve=>setTimeout(resolve,500));return audio();}};
 const invalidate=vi.fn(),guarded=guardedSpeech(provider,invalidate,1000);
 const pending=guarded.synthesize('Hello.');
 await vi.advanceTimersByTimeAsync(500);
 await expect(pending).resolves.toBeInstanceOf(ArrayBuffer);
 expect(providerSignal?.aborted).toBe(false);
 expect(invalidate).not.toHaveBeenCalled();
});

it('forwards a caller abort to the provider',async()=>{
 const caller=new AbortController();
 let providerSignal:AbortSignal|undefined;
 const provider={synthesize:(_text:string,signal?:AbortSignal)=>{providerSignal=signal;return new Promise<ArrayBuffer|null>(()=>{});}};
 const guarded=guardedSpeech(provider,vi.fn(),60000);
 void guarded.synthesize('Hello.',caller.signal).catch(()=>{});
 caller.abort();
 expect(providerSignal?.aborted).toBe(true);
});
