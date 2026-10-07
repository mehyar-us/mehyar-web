import {afterEach,expect,it,vi} from 'vitest';
import type {TranscriberSessionOptions} from '@cloudflare/voice';
import {audioStartTranscriber} from '../src/audio-start-transcriber';
afterEach(()=>vi.useRealTimers());
function fixture(){
 vi.useFakeTimers();let resolve!:()=>void,reject!:(e:Error)=>void,callbacks!:TranscriberSessionOptions;
 const pending=new Promise<void>((yes,no)=>{resolve=yes;reject=no;});
 const inner={feed:vi.fn(),close:vi.fn(),waitUntilReady:()=>pending,updateAgentContext:vi.fn()};
 const provider={createSession:vi.fn((options:TranscriberSessionOptions={})=>{callbacks=options;return inner;})};
 const onFatalError=vi.fn(),onUtterance=vi.fn();
 const session=audioStartTranscriber(provider).createSession({onFatalError,onUtterance});
 return {session,inner,provider,onFatalError,onUtterance,resolve,reject,callbacks:()=>callbacks};
}
it('waits through microphone delay, connects on first frame and preserves buffered audio order',async()=>{
 const f=fixture();let ready=false;void f.session.waitUntilReady!().then(()=>{ready=true;});
 await vi.advanceTimersByTimeAsync(12000);expect(f.provider.createSession).not.toHaveBeenCalled();expect(ready).toBe(false);
 const first=new Uint8Array([1,2]);f.session.feed(first.buffer);first[0]=99;f.session.feed(new Uint8Array([3,4]).buffer);
 expect(f.provider.createSession).toHaveBeenCalledOnce();expect(f.inner.feed).not.toHaveBeenCalled();
 f.resolve();await f.session.waitUntilReady!();expect(ready).toBe(true);
 expect(f.inner.feed.mock.calls.map(([chunk])=>Array.from(new Uint8Array(chunk)))).toEqual([[1,2],[3,4]]);
 f.session.feed(new ArrayBuffer(2));expect(f.inner.feed).toHaveBeenCalledTimes(3);f.session.close();
});
it('closes without ever opening a provider when cancelled before audio',async()=>{
 const f=fixture();f.session.close();f.session.feed(new ArrayBuffer(2));
 await expect(f.session.waitUntilReady!()).rejects.toThrow('cancelled');
 await vi.advanceTimersByTimeAsync(30000);expect(f.provider.createSession).not.toHaveBeenCalled();expect(f.onFatalError).not.toHaveBeenCalled();
});
it('does not replay buffered audio or callbacks after cancellation during connection',async()=>{
 const f=fixture();f.session.feed(new ArrayBuffer(2));f.session.close();f.resolve();
 await expect(f.session.waitUntilReady!()).rejects.toThrow('cancelled');await Promise.resolve();
 f.callbacks().onUtterance?.('late private text');expect(f.onUtterance).not.toHaveBeenCalled();expect(f.inner.feed).not.toHaveBeenCalled();expect(f.inner.close).toHaveBeenCalledOnce();
});
it.each(['timeout','rejection','fatal'] as const)('settles provider %s once and clears queued audio',async mode=>{
 const f=fixture();f.session.feed(new ArrayBuffer(2));
 if(mode==='timeout')await vi.advanceTimersByTimeAsync(5000);
 if(mode==='rejection')f.reject(new Error('private provider details'));
 if(mode==='fatal')f.callbacks().onFatalError?.(new Error('private provider details'));
 await expect(f.session.waitUntilReady!()).rejects.toThrow('audio startup failed');
 f.callbacks().onFatalError?.(new Error('again'));f.resolve();await Promise.resolve();
 expect(f.onFatalError).toHaveBeenCalledOnce();expect(f.inner.feed).not.toHaveBeenCalled();expect(f.inner.close).toHaveBeenCalledOnce();
});
it('bounds no-audio startup without spending on a provider',async()=>{
 const f=fixture();await vi.advanceTimersByTimeAsync(25000);
 await expect(f.session.waitUntilReady!()).rejects.toThrow('audio startup failed');expect(f.provider.createSession).not.toHaveBeenCalled();
});
it.each(['bytes','frames','odd'] as const)('rejects excessive or invalid %s',async mode=>{
 const f=fixture();
 if(mode==='bytes'){f.session.feed(new ArrayBuffer(160000));f.session.feed(new ArrayBuffer(2));}
 if(mode==='frames')for(let i=0;i<513;i++)f.session.feed(new ArrayBuffer(2));
 if(mode==='odd')f.session.feed(new ArrayBuffer(3));
 await expect(f.session.waitUntilReady!()).rejects.toThrow('audio startup failed');expect(f.onFatalError).toHaveBeenCalledOnce();f.resolve();
});
it('forwards live callbacks and stops them on runtime failure',async()=>{
 const f=fixture();f.session.feed(new ArrayBuffer(2));f.resolve();await f.session.waitUntilReady!();
 f.callbacks().onUtterance?.('business hours');expect(f.onUtterance).toHaveBeenCalledWith('business hours');
 f.session.updateAgentContext?.('What hours?');expect(f.inner.updateAgentContext).toHaveBeenCalledWith('What hours?');
 f.inner.feed.mockImplementation(()=>{throw new Error('socket gone');});f.session.feed(new ArrayBuffer(2));
 f.callbacks().onUtterance?.('late');expect(f.onUtterance).toHaveBeenCalledOnce();expect(f.onFatalError).toHaveBeenCalledOnce();
});
