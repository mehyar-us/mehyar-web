import {afterEach,it,expect,vi} from 'vitest';
import {TelnyxKeypadGate} from '../src/telnyx-keypad-gate';
import {TelnyxVoiceBridge} from '../src/telnyx-voice-bridge';
afterEach(()=>vi.useRealTimers());
const settle=async()=>{for(let i=0;i<10;i++)await Promise.resolve();};
function fixture(){
 vi.useFakeTimers();
 const hooks={say:vi.fn(async(_text:string)=>{}),send:vi.fn(async()=>({nonce:'first'})),check:vi.fn(async(_nonce:string,_code:string)=>({state:'approved',nonce:'next'})),end:vi.fn()};
 const gate=new TelnyxKeypadGate(hooks),resume=vi.fn();return {hooks,gate,resume};
}
it('uses the validated business name through keypad consent and exit while keeping legacy default and invalid data safe',async()=>{
 for(const name of ['Mayor Cedar',"Mayor O'Connor",'<script>']){
  const f=fixture(),gate=new TelnyxKeypadGate(f.hooks,name);gate.start(f.resume);await settle();
  expect(f.hooks.say.mock.calls[0][0]).toContain(`I am ${name==='<script>'?'The Mayor':name}, an AI`);
  gate.digit('2');await settle();expect(f.hooks.say.mock.lastCall![0]).toContain(`ask ${name==='<script>'?'The Mayor':name} for a callback`);gate.close();
 }
 const f=fixture();f.gate.start(f.resume);await settle();expect(f.hooks.say.mock.calls[0][0]).toContain('I am The Mayor');f.gate.close();
});
it('does not send without an explicit keypad opt-in and permits an unverified exit',async()=>{
 const f=fixture();f.gate.start(f.resume);await settle();f.gate.digit('9');expect(f.hooks.send).not.toHaveBeenCalled();
 f.gate.digit('2');await settle();expect(f.hooks.send).not.toHaveBeenCalled();expect(f.resume).toHaveBeenCalledOnce();expect(f.hooks.say).toHaveBeenLastCalledWith(expect.stringContaining('without verification'));
});
it('collects only bounded keypad digits, clears corrections and checks once per submission',async()=>{
 const f=fixture();f.gate.start(f.resume);await settle();f.gate.digit('1');f.gate.digit('1');await settle();expect(f.hooks.send).toHaveBeenCalledOnce();
 for(const digit of '99*123456##')f.gate.digit(digit);await settle();
 expect(f.hooks.check).toHaveBeenCalledExactlyOnceWith('first','123456');expect(f.resume).toHaveBeenCalledOnce();
 expect(JSON.stringify(f.hooks.say.mock.calls)).not.toContain('123456');
});
it('does not resume while a prompt is playing or after the call closes',async()=>{
 const f=fixture();let resolve!:()=>void;f.hooks.say.mockImplementation(()=>new Promise<void>(r=>{resolve=r;}));
 f.gate.start(f.resume);f.gate.digit('1');expect(f.hooks.send).not.toHaveBeenCalled();f.gate.close();resolve();await settle();f.gate.digit('1');expect(f.hooks.send).not.toHaveBeenCalled();expect(f.resume).not.toHaveBeenCalled();
});
it.each(['consent_timeout','code_timeout','overflow','prompt_failure'])('ends safely on %s',async issue=>{
 const f=fixture();if(issue==='prompt_failure')f.hooks.say.mockRejectedValue(new Error('private'));
 f.gate.start(f.resume);await settle();
 if(issue==='consent_timeout')await vi.advanceTimersByTimeAsync(20000);
 if(issue==='code_timeout'||issue==='overflow'){f.gate.digit('1');await settle();if(issue==='code_timeout')await vi.advanceTimersByTimeAsync(60000);else for(const digit of '12345678901')f.gate.digit(digit);}
 expect(f.hooks.end).toHaveBeenCalledOnce();expect(f.resume).not.toHaveBeenCalled();expect(f.hooks.check).not.toHaveBeenCalled();
});
it('discards all pre-verification audio instead of buffering it for the AI',async()=>{
 const f=fixture(),socket=()=>({readyState:1,send:vi.fn(),close:vi.fn()}),provider=socket(),agent=socket();
 const binding={callControlId:'call',callSessionId:'bf08a03e-5256-4fb3-94fa-465b0349b29e',from:'+12025550101',to:'+12025550102'};
 const bridge=new TelnyxVoiceBridge(binding,provider,agent,()=>{},f.gate);
 bridge.fromProvider(JSON.stringify({event:'start',stream_id:'s',start:{call_control_id:binding.callControlId,call_session_id:binding.callSessionId,from:binding.from,to:binding.to,media_format:{encoding:'L16',sample_rate:16000,channels:1}}}));
 const audio=()=>bridge.fromProvider(JSON.stringify({event:'media',stream_id:'s',media:{track:'inbound',payload:'AQD//w=='}}));
 for(let i=0;i<100;i++)audio();expect(agent.send).not.toHaveBeenCalled();
 await settle();bridge.fromProvider(JSON.stringify({event:'dtmf',stream_id:'s',dtmf:{digit:'2'}}));await settle();
 expect(agent.send).toHaveBeenCalledExactlyOnceWith('{"type":"start_call"}');
 bridge.fromAgent('{"type":"audio_config","format":"pcm16","sampleRate":16000}');bridge.fromAgent('{"type":"status","status":"listening"}');
 expect(agent.send).toHaveBeenCalledOnce();audio();expect(agent.send).toHaveBeenCalledTimes(2);bridge.close();
});
it('waits for the exact playback mark and rejects a cleared prompt',async()=>{
 vi.useFakeTimers();
 const socket=()=>({readyState:1,send:vi.fn(),close:vi.fn()}),provider=socket(),agent=socket();
 const binding={callControlId:'call',callSessionId:'bf08a03e-5256-4fb3-94fa-465b0349b29e',from:'+12025550101',to:'+12025550102'};
 const bridge=new TelnyxVoiceBridge(binding,provider,agent,()=>{},{start:()=>{},digit:()=>{},close:()=>{}});
 bridge.fromProvider(JSON.stringify({event:'start',stream_id:'s',start:{call_control_id:binding.callControlId,call_session_id:binding.callSessionId,from:binding.from,to:binding.to,media_format:{encoding:'L16',sample_rate:16000,channels:1}}}));
 const resolved=vi.fn(),first=bridge.playPrompt(new ArrayBuffer(1280)).then(resolved);
 const name=JSON.parse(provider.send.mock.calls.at(-1)![0]).mark.name;
 bridge.fromProvider(JSON.stringify({event:'mark',stream_id:'s',mark:{name:'wrong'}}));await settle();expect(resolved).not.toHaveBeenCalled();
 bridge.fromProvider(JSON.stringify({event:'mark',stream_id:'s',mark:{name}}));await first;expect(resolved).toHaveBeenCalledOnce();
 const second=bridge.playPrompt(new ArrayBuffer(640)),rejected=expect(second).rejects.toThrow('prompt_interrupted');
 bridge.close();await rejected;
 bridge.fromProvider(JSON.stringify({event:'mark',stream_id:'s',mark:{name}}));expect(agent.send).not.toHaveBeenCalled();
});
it('ends a call when the provider never acknowledges prompt playback',async()=>{
 vi.useFakeTimers();
 const socket=()=>({readyState:1,send:vi.fn(),close:vi.fn()}),provider=socket(),agent=socket();
 const binding={callControlId:'call',callSessionId:'bf08a03e-5256-4fb3-94fa-465b0349b29e',from:'+12025550101',to:'+12025550102'};
 const bridge=new TelnyxVoiceBridge(binding,provider,agent,()=>{},{start:()=>{},digit:()=>{},close:()=>{}});
 bridge.fromProvider(JSON.stringify({event:'start',stream_id:'s',start:{call_control_id:binding.callControlId,call_session_id:binding.callSessionId,from:binding.from,to:binding.to,media_format:{encoding:'L16',sample_rate:16000,channels:1}}}));
 const rejected=expect(bridge.playPrompt(new ArrayBuffer(640))).rejects.toThrow();await vi.advanceTimersByTimeAsync(45000);await rejected;
 expect(provider.close).toHaveBeenCalledOnce();expect(agent.close).toHaveBeenCalledOnce();
});
