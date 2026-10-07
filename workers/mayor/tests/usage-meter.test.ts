import {afterEach,expect,it,vi} from 'vitest';
import {meterVoice} from '../src/usage';
afterEach(()=>vi.useRealTimers());
it('reserves before the minute ends and stops a stalled renewal',async()=>{
 vi.useFakeTimers();const end=vi.fn(),renew=vi.fn(()=>new Promise<boolean>(()=>{}));meterVoice(renew,end);
 await vi.advanceTimersByTimeAsync(55000);expect(renew).toHaveBeenCalledOnce();expect(end).not.toHaveBeenCalled();
 await vi.advanceTimersByTimeAsync(5000);expect(end).toHaveBeenCalledOnce();
});
it('stops on denied renewal without attempting another charge',async()=>{
 vi.useFakeTimers();const end=vi.fn(),renew=vi.fn(async()=>false);meterVoice(renew,end);
 await vi.advanceTimersByTimeAsync(180000);expect(end).toHaveBeenCalledOnce();expect(renew).toHaveBeenCalledOnce();
});
it('cannot resume a cancelled call when a late renewal resolves',async()=>{
 vi.useFakeTimers();let resolve!:(value:boolean)=>void;const end=vi.fn(),renew=vi.fn(()=>new Promise<boolean>(done=>resolve=done));const stop=meterVoice(renew,end);
 await vi.advanceTimersByTimeAsync(55000);stop();resolve(true);await vi.advanceTimersByTimeAsync(180000);
 expect(end).not.toHaveBeenCalled();expect(renew).toHaveBeenCalledOnce();
});
it('caps a continuously successful call at ten reserved minutes',async()=>{
 vi.useFakeTimers();const end=vi.fn(),renew=vi.fn(async()=>true);meterVoice(renew,end);
 await vi.advanceTimersByTimeAsync(600000);expect(end).toHaveBeenCalledOnce();expect(renew).toHaveBeenCalledTimes(9);
});
