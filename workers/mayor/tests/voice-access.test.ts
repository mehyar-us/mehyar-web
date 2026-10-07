import {afterEach,it,expect,vi} from 'vitest';
import {watchVoiceAccess} from '../src/voice-access';
afterEach(()=>vi.useRealTimers());
it('checks idle access every fifteen seconds and stops permanently after revocation',async()=>{
 vi.useFakeTimers();let permitted=true;
 const check=vi.fn(async()=>{if(!permitted)throw new Error('revoked');}),revoke=vi.fn();
 const stop=watchVoiceAccess(check,revoke);
 await vi.advanceTimersByTimeAsync(14999);expect(check).not.toHaveBeenCalled();
 await vi.advanceTimersByTimeAsync(1);expect(check).toHaveBeenCalledTimes(1);
 permitted=false;await vi.advanceTimersByTimeAsync(15000);expect(revoke).toHaveBeenCalledTimes(1);
 await vi.advanceTimersByTimeAsync(60000);expect(check).toHaveBeenCalledTimes(2);stop();
});
it('does not overlap database checks or revoke after connection cleanup',async()=>{
 vi.useFakeTimers();let reject!:(error:Error)=>void;
 const check=vi.fn(()=>new Promise<void>((_,fail)=>{reject=fail;})),revoke=vi.fn();
 const stop=watchVoiceAccess(check,revoke);
 await vi.advanceTimersByTimeAsync(15000);expect(check).toHaveBeenCalledTimes(1);
 stop();reject(new Error('late failure'));await vi.advanceTimersByTimeAsync(60000);
 expect(revoke).not.toHaveBeenCalled();expect(check).toHaveBeenCalledTimes(1);
});
it('ends access when the database check hangs without starting another query',async()=>{
 vi.useFakeTimers();const check=vi.fn(()=>new Promise<void>(()=>{})),revoke=vi.fn();
 watchVoiceAccess(check,revoke);
 await vi.advanceTimersByTimeAsync(19999);expect(revoke).not.toHaveBeenCalled();
 await vi.advanceTimersByTimeAsync(1);expect(revoke).toHaveBeenCalledTimes(1);
 await vi.advanceTimersByTimeAsync(60000);expect(check).toHaveBeenCalledTimes(1);
});
