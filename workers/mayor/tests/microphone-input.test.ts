import {afterEach,expect,it,vi} from 'vitest';
import {MayorMicrophone} from '../web/microphone-input';
afterEach(()=>vi.unstubAllGlobals());
function fixture(){
 const track={stop:vi.fn()},stream={getTracks:()=>[track]},getUserMedia=vi.fn(async()=>stream);
 const node={connect:vi.fn(),disconnect:vi.fn(),port:{onmessage:null as null|((event:any)=>void),close:vi.fn()}};
 const source={connect:vi.fn(),disconnect:vi.fn()},close=vi.fn(async()=>{});
 vi.stubGlobal('window',{isSecureContext:true});vi.stubGlobal('navigator',{mediaDevices:{getUserMedia}});
 vi.stubGlobal('AudioContext',class{sampleRate=16000;destination={};audioWorklet={addModule:vi.fn(async()=>{})};resume=vi.fn(async()=>{});close=close;createMediaStreamSource(){return source;}});
 vi.stubGlobal('AudioWorkletNode',class{constructor(){return node;}});
 return {track,stream,getUserMedia,node,source,close};
}
it('reuses one stream, transmits only after start and releases every resource on stop',async()=>{
 const f=fixture(),mic=new MayorMicrophone(),audio=vi.fn(),level=vi.fn();
 mic.onAudioData=audio;mic.onAudioLevel=level;await mic.prepare();
 f.node.port.onmessage?.({data:{pcm:new ArrayBuffer(640),rms:.2}});expect(audio).not.toHaveBeenCalled();
 await mic.start();expect(f.getUserMedia).toHaveBeenCalledOnce();expect(f.track.stop).not.toHaveBeenCalled();
 const packet=new ArrayBuffer(640);f.node.port.onmessage?.({data:{pcm:packet,rms:.2}});
 expect(audio).toHaveBeenCalledWith(packet);expect(level).toHaveBeenCalledWith(.2);
 mic.stop();expect(f.track.stop).toHaveBeenCalledOnce();expect(f.close).toHaveBeenCalledOnce();expect(f.node.port.onmessage).toBeNull();
});
it('stops a stream granted after the user cancelled without initializing audio',async()=>{
 const f=fixture();let grant!:(value:any)=>void;f.getUserMedia.mockImplementation(()=>new Promise(resolve=>{grant=resolve;}));
 const mic=new MayorMicrophone(),pending=mic.prepare();mic.stop();grant(f.stream);await pending;
 expect(f.track.stop).toHaveBeenCalledOnce();await expect(mic.start()).rejects.toThrow('preparation');
});
it('does not swallow browser denial or initialize server audio after denial',async()=>{
 const f=fixture();f.getUserMedia.mockRejectedValue(new DOMException('denied','NotAllowedError'));
 const mic=new MayorMicrophone();await expect(mic.prepare()).rejects.toThrow('blocked microphone');
 expect(f.source.connect).not.toHaveBeenCalled();
});
