import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {VoiceClient,type VoiceTransport} from '@cloudflare/voice/client';
import {MayorMicrophone} from '../web/microphone-input';
import {createVoiceCall} from '../web/voice-call';

// Real installed VoiceClient and Mayor capture adapter, with synthetic browser
// audio and transport. These assertions do not certify hardware or audibility.
const clients:VoiceClient[]=[];
let captureRate=16000;
beforeEach(()=>{
 captureRate=16000;
 vi.stubGlobal('window',{isSecureContext:true});
 vi.stubGlobal('Audio',class{autoplay=false;srcObject:unknown;async play(){}pause(){}});
 vi.stubGlobal('AudioContext',class{
  state='running';destination={};currentTime=0;sampleRate:number;
  audioWorklet={addModule:vi.fn(async()=>{})};
  constructor(options?:{sampleRate?:number}){this.sampleRate=options?.sampleRate===16000?captureRate:48000;}
  async resume(){}async close(){}
  createMediaStreamDestination(){return {stream:{}};}
  createMediaStreamSource(){return {connect:vi.fn(),disconnect:vi.fn()};}
 });
});
afterEach(()=>{for(const client of clients.splice(0))client.disconnect();vi.unstubAllGlobals();vi.restoreAllMocks();});
function fixture(){
 const track={stop:vi.fn()},stream={getTracks:()=>[track]},getUserMedia=vi.fn(async()=>stream);
 vi.stubGlobal('navigator',{mediaDevices:{getUserMedia}});
 const processor={connect:vi.fn(),disconnect:vi.fn(),port:{onmessage:null as null|((event:any)=>void),close:vi.fn()}};
 vi.stubGlobal('AudioWorkletNode',class{constructor(){return processor;}});
 const transport:VoiceTransport={connected:true,onopen:null,onclose:null,onerror:null,onmessage:null,
  sendJSON:vi.fn(),sendBinary:vi.fn(),connect(){this.onopen?.();},disconnect(){}};
 const input=new MayorMicrophone(),client=new VoiceClient({agent:'fixture',transport,audioInput:input});clients.push(client);
 const failed=vi.fn(),call=createVoiceCall(client,()=>{},failed,()=>input.prepare());
 client.addEventListener('statuschange',status=>call.status(status));
 client.addEventListener('error',message=>call.error(message));
 client.addEventListener('connectionchange',connected=>{if(!connected)call.stop();});
 client.connect();
 return {track,stream,getUserMedia,processor,transport,input,client,call,failed,
  receive:(message:object)=>transport.onmessage?.(JSON.stringify(message))};
}
it('uses the prepared capture stream and suppresses PCM while muted, then resumes after unmute',async()=>{
 const f=fixture();await f.call.start();f.receive({type:'status',status:'listening'});
 expect(f.call.active).toBe(true);expect(f.getUserMedia).toHaveBeenCalledOnce();
 const packet=new ArrayBuffer(640),capture=f.processor.port.onmessage!;
 capture({data:{pcm:packet,rms:.1}});expect(f.transport.sendBinary).toHaveBeenCalledWith(packet);
 f.client.toggleMute();capture({data:{pcm:new ArrayBuffer(640),rms:.1}});
 expect(f.transport.sendBinary).toHaveBeenCalledOnce();expect(f.client.audioLevel).toBe(0);
 f.client.toggleMute();capture({data:{pcm:packet,rms:.1}});expect(f.transport.sendBinary).toHaveBeenCalledTimes(2);
 f.call.stop();capture({data:{pcm:packet,rms:.1}});
 expect(f.transport.sendBinary).toHaveBeenCalledTimes(2);expect(f.track.stop).toHaveBeenCalledOnce();
 expect(f.input.onAudioData).toBeNull();expect(f.call.active).toBe(false);
});
it('cancels a pending permission request before any server call, releases the late stream and allows a fresh call',async()=>{
 const f=fixture();let grant!:(value:any)=>void;
 f.getUserMedia.mockImplementationOnce(()=>new Promise(resolve=>{grant=resolve;}));
 const started=f.call.start();expect(f.getUserMedia).toHaveBeenCalledOnce();f.call.stop();grant(f.stream);await started;
 expect(f.track.stop).toHaveBeenCalledOnce();expect(f.call.active).toBe(false);
 expect(f.transport.sendJSON).not.toHaveBeenCalledWith({type:'start_call'});
 await f.call.start();f.receive({type:'status',status:'listening'});
 expect(f.call.active).toBe(true);expect(f.getUserMedia).toHaveBeenCalledTimes(2);f.call.stop();
});
it('rejects an unsupported capture sample rate before requesting server speech resources',async()=>{
 captureRate=48000;const f=fixture();await f.call.start();
 expect(f.transport.sendJSON).not.toHaveBeenCalledWith({type:'start_call'});
 expect(f.failed).toHaveBeenCalledWith('This browser cannot initialize voice capture at the required sample rate.');
 expect(f.track.stop).toHaveBeenCalledOnce();expect(f.call.active).toBe(false);
});
it('ends local capture and blocks further PCM after the server ends an acknowledged call',async()=>{
 const f=fixture();await f.call.start();f.receive({type:'status',status:'listening'});
 const capture=f.processor.port.onmessage!;f.receive({type:'status',status:'idle'});
 capture({data:{pcm:new ArrayBuffer(640),rms:.1}});
 expect(f.call.active).toBe(false);expect(f.track.stop).toHaveBeenCalledOnce();
 expect(f.transport.sendBinary).not.toHaveBeenCalled();expect(f.input.onAudioData).toBeNull();
});
