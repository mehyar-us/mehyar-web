import {afterEach,it,expect,vi} from 'vitest';
import {TelnyxVoiceBridge} from '../src/telnyx-voice-bridge';
const binding={callControlId:'owned',callSessionId:'bf08a03e-5256-4fb3-94fa-465b0349b29e',from:'+12025550101',to:'+12025550102'};
function fixture(){
 vi.useFakeTimers();
 const socket=()=>({readyState:1,send:vi.fn(),close:vi.fn()});
 const provider=socket(),agent=socket(),bridge=new TelnyxVoiceBridge(binding,provider,agent);
 const start=()=>bridge.fromProvider(JSON.stringify({event:'start',stream_id:'stream',start:{call_control_id:binding.callControlId,call_session_id:binding.callSessionId,from:binding.from,to:binding.to,media_format:{encoding:'L16',sample_rate:16000,channels:1}}}));
 const config=()=>bridge.fromAgent(JSON.stringify({type:'audio_config',format:'pcm16',sampleRate:16000}));
 const status=(status:string)=>bridge.fromAgent(JSON.stringify({type:'status',status}));
 const audio=()=>bridge.fromProvider(JSON.stringify({event:'media',stream_id:'stream',media:{track:'inbound',payload:'AQD//w=='}}));
 const ready=()=>{start();config();status('listening');};
 return {provider,agent,bridge,start,config,status,audio,ready};
}
afterEach(()=>vi.useRealTimers());
it('buffers startup audio until the agent confirms PCM readiness, preserving order',()=>{
 const f=fixture();f.start();f.audio();expect(f.agent.send).toHaveBeenCalledTimes(1);
 f.config();f.status('listening');expect(f.agent.send).toHaveBeenCalledTimes(2);
 expect(Array.from(new Uint8Array(f.agent.send.mock.calls[1][0]))).toEqual([1,0,255,255]);f.bridge.close();
});
it('splits generated PCM into ordered 20ms provider frames',()=>{
 const f=fixture();f.ready();const audio=Uint8Array.from({length:1400},(_,i)=>i%256);f.bridge.fromAgent(audio.buffer);
 expect(f.provider.send).toHaveBeenCalledTimes(3);
 const parts=f.provider.send.mock.calls.map(([raw])=>Uint8Array.from(atob(JSON.parse(raw).media.payload),c=>c.charCodeAt(0)));
 expect(parts.map(p=>p.length)).toEqual([640,640,120]);expect([...parts.flatMap(p=>Array.from(p))]).toEqual(Array.from(audio));f.bridge.close();
});
it('clears interrupted playback and drops late audio until a new agent status',()=>{
 const f=fixture();f.ready();f.bridge.fromAgent('{"type":"playback_interrupt"}');
 expect(f.provider.send).toHaveBeenLastCalledWith('{"event":"clear"}');
 f.bridge.fromAgent(new ArrayBuffer(640));expect(f.provider.send).toHaveBeenCalledTimes(1);
 f.status('speaking');f.bridge.fromAgent(new ArrayBuffer(640));expect(f.provider.send).toHaveBeenCalledTimes(2);f.bridge.close();
});
it('does not send transcripts, tool data or DTMF to the provider or model',()=>{
 const f=fixture();f.ready();f.bridge.fromAgent('{"type":"transcript","text":"private"}');
 f.bridge.fromProvider('{"event":"dtmf","stream_id":"stream","dtmf":{"digit":"1"}}');
 expect(f.provider.send).not.toHaveBeenCalled();expect(f.agent.send).toHaveBeenCalledTimes(1);f.bridge.close();
});
it.each(['timeout','stop','error','idle','invalid_format','duplicate_start','binary_before_ready','oversized_audio'])('terminates both peers on %s',reason=>{
 const f=fixture();f.start();
 if(reason==='timeout')vi.advanceTimersByTime(10000);
 if(reason==='stop')f.bridge.fromProvider('{"event":"stop","stream_id":"stream"}');
 if(reason==='error')f.bridge.fromAgent('{"type":"error","message":"private"}');
 if(reason==='idle'){f.config();f.status('listening');f.status('idle');}
 if(reason==='invalid_format')f.bridge.fromAgent('{"type":"audio_config","format":"mp3","sampleRate":16000}');
 if(reason==='duplicate_start')f.start();
 if(reason==='binary_before_ready')f.bridge.fromAgent(new ArrayBuffer(2));
 if(reason==='oversized_audio'){f.config();f.status('listening');f.bridge.fromAgent(new ArrayBuffer(320002));}
 expect(f.provider.close).toHaveBeenCalledTimes(1);expect(f.agent.close).toHaveBeenCalledTimes(1);
 const count=f.agent.send.mock.calls.length;f.audio();f.bridge.close();expect(f.agent.send).toHaveBeenCalledTimes(count);
});
it('bounds startup buffering and cleans up if a socket write fails',()=>{
 const f=fixture();f.start();const frame=JSON.stringify({event:'media',stream_id:'stream',media:{track:'inbound',payload:btoa('\0'.repeat(16000))}});
 for(let i=0;i<3;i++)f.bridge.fromProvider(frame);expect(f.agent.close).toHaveBeenCalledTimes(1);
 const g=fixture();g.ready();g.provider.send.mockImplementation(()=>{throw new Error('closed');});g.bridge.fromAgent(new ArrayBuffer(640));
 expect(g.agent.close).toHaveBeenCalledTimes(1);
});
