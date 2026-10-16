import {afterEach,it,expect,vi} from 'vitest';
import {createVoiceCall} from '../web/voice-call';
afterEach(()=>vi.useRealTimers());
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done;});return {promise,resolve};}
it('waits for local microphone startup rather than treating server listening as ready',async()=>{
 const pending=deferred(),client={startCall:()=>pending.promise,endCall:vi.fn(),error:null};
 const call=createVoiceCall(client,()=>{},()=>{}),started=call.start();
 call.status('listening');
 expect(call.starting).toBe(true);expect(call.active).toBe(false);
 pending.resolve();await started;expect(call.active).toBe(true);expect(call.starting).toBe(false);call.stop();
});
it('cancellation prevents a late permission result from restarting the call',async()=>{
 const pending=deferred(),client={startCall:()=>pending.promise,endCall:vi.fn(),error:null};
 const call=createVoiceCall(client,()=>{},()=>{}),started=call.start();call.stop();pending.resolve();await started;
 expect(call.active).toBe(false);expect(call.starting).toBe(false);expect(client.endCall).toHaveBeenCalledOnce();
});
it('ends the server session when the SDK resolves with a microphone error',async()=>{
 const client={startCall:async()=>{},endCall:vi.fn(),error:'Microphone denied'},failed=vi.fn();
 const call=createVoiceCall(client,()=>{},failed);await call.start();
 expect(call.active).toBe(false);expect(client.endCall).toHaveBeenCalledOnce();expect(failed).toHaveBeenCalledWith('Microphone denied');
});
it('bounds a stalled permission request and ignores its later completion',async()=>{
 vi.useFakeTimers();const pending=deferred(),client={startCall:()=>pending.promise,endCall:vi.fn(),error:null},failed=vi.fn();
 const call=createVoiceCall(client,()=>{},failed),started=call.start();await vi.advanceTimersByTimeAsync(30000);
 expect(client.endCall).toHaveBeenCalledOnce();expect(failed).toHaveBeenCalledOnce();pending.resolve();await started;expect(call.active).toBe(false);
});
it('does not overlap SDK microphone requests when retrying after cancellation',async()=>{
 const first=deferred(),startCall=vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(undefined);
 const client={startCall,endCall:vi.fn(),error:null},failed=vi.fn();
 const call=createVoiceCall(client,()=>{},failed),started=call.start();call.stop();await call.start();
 expect(startCall).toHaveBeenCalledTimes(1);expect(failed).toHaveBeenCalledWith(expect.stringContaining('previous microphone request'));
 first.resolve();await started;await call.start();
 call.status('listening');
 expect(startCall).toHaveBeenCalledTimes(2);expect(call.active).toBe(true);call.stop();
});
it('requires server acknowledgement even after local microphone startup completes',async()=>{
 const client={startCall:async()=>{},endCall:vi.fn(),error:null};
 const call=createVoiceCall(client,()=>{},()=>{});await call.start();call.status('idle');
 expect(call.starting).toBe(true);expect(call.active).toBe(false);expect(client.endCall).not.toHaveBeenCalled();
 call.status('listening');expect(call.active).toBe(true);call.stop();
});
it('does not reactivate when the server ends a call before microphone permission settles',async()=>{
 const pending=deferred(),client={startCall:()=>pending.promise,endCall:vi.fn(),error:null};
 const call=createVoiceCall(client,()=>{},()=>{}),started=call.start();call.status('listening');call.status('idle');
 pending.resolve();await started;expect(call.active).toBe(false);expect(call.starting).toBe(false);expect(client.endCall).toHaveBeenCalledOnce();
});

/** The reported wedge, client side: the server went silent mid-turn (its
 *  speech or model stream stalled) and the status never moved again. The call
 *  must end itself with a plain explanation instead of trapping the owner in a
 *  dead call until they kill the browser. */
it('ends a call stuck on thinking and tells the owner how to recover',async()=>{
 vi.useFakeTimers();
 const client={startCall:async()=>{},endCall:vi.fn(),error:null},failed=vi.fn();
 const call=createVoiceCall(client,()=>{},failed);await call.start();call.status('listening');
 expect(call.active).toBe(true);
 call.status('thinking');await vi.advanceTimersByTimeAsync(44999);
 expect(failed).not.toHaveBeenCalled();expect(call.active).toBe(true);
 await vi.advanceTimersByTimeAsync(1);
 expect(client.endCall).toHaveBeenCalledOnce();expect(call.active).toBe(false);
 expect(failed).toHaveBeenCalledWith(expect.stringContaining('stuck'));
});
it('lets long speech run while signs of life keep arriving, but ends a silent speaking stall',async()=>{
 vi.useFakeTimers();
 const client={startCall:async()=>{},endCall:vi.fn(),error:null},failed=vi.fn();
 const call=createVoiceCall(client,()=>{},failed);await call.start();call.status('listening');call.status('speaking');
 await vi.advanceTimersByTimeAsync(80000);call.activity();await vi.advanceTimersByTimeAsync(80000);
 expect(failed).not.toHaveBeenCalled();expect(call.active).toBe(true);
 await vi.advanceTimersByTimeAsync(10001);
 expect(failed).toHaveBeenCalledWith(expect.stringContaining('stuck'));expect(call.active).toBe(false);
});
it('never fires the stall watchdog while simply listening',async()=>{
 vi.useFakeTimers();
 const client={startCall:async()=>{},endCall:vi.fn(),error:null},failed=vi.fn();
 const call=createVoiceCall(client,()=>{},failed);await call.start();call.status('listening');
 await vi.advanceTimersByTimeAsync(600000);
 expect(failed).not.toHaveBeenCalled();expect(call.active).toBe(true);call.stop();
});
it('stops a rejected startup immediately even if microphone permission is still pending',async()=>{
 const pending=deferred(),client={startCall:()=>pending.promise,endCall:vi.fn(),error:null},failed=vi.fn();
 const call=createVoiceCall(client,()=>{},failed),started=call.start();call.error('Voice service unavailable');
 expect(call.starting).toBe(false);expect(client.endCall).toHaveBeenCalledOnce();expect(failed).toHaveBeenCalledWith('Voice service unavailable');
 call.status('listening');pending.resolve();await started;expect(call.active).toBe(false);
});
