import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {VoiceClient,type VoiceTransport} from '@cloudflare/voice/client';
import {createVoiceCall} from '../web/voice-call';
import {bindVoiceAccessRecovery} from '../web/voice-access-recovery';

// Exercise the installed SDK's event ordering with synthetic audio/transport.
// This does not claim microphone permission, acoustic quality or network latency.
const clients:VoiceClient[]=[];
beforeEach(()=>{
 vi.stubGlobal('AudioContext',class {
  state='running';destination={};currentTime=0;
  createMediaStreamDestination(){return {stream:{}};}
  async close(){}
 });
 vi.stubGlobal('Audio',class {autoplay=false;srcObject:unknown;async play(){}pause(){}});
});
afterEach(()=>{for(const client of clients.splice(0))client.disconnect();vi.unstubAllGlobals();});
function fixture(){
 let resolve!:()=>void;
 const permission=new Promise<void>(done=>resolve=done);
 const input={start:vi.fn(()=>permission),stop:vi.fn(),onAudioLevel:null,onAudioData:null};
 const transport:VoiceTransport={connected:true,onopen:null,onclose:null,onerror:null,onmessage:null,
  sendJSON:vi.fn(),sendBinary:vi.fn(),connect(){this.onopen?.();},disconnect(){}};
 const client=new VoiceClient({agent:'test',transport,audioInput:input});clients.push(client);
 const failed=vi.fn(),call=createVoiceCall(client,()=>{},failed);
 client.addEventListener('statuschange',status=>call.status(status));
 client.addEventListener('error',message=>call.error(message));
 client.addEventListener('connectionchange',connected=>{if(!connected)call.stop();});
 client.connect();
 return {client,call,input,transport,failed,resolve,receive:(message:object)=>transport.onmessage?.(JSON.stringify(message))};
}
it('exposes the provider startup gap while the browser audio context is suspended',async()=>{
 let resume!:()=>void;
 vi.stubGlobal('AudioContext',class {
  state='suspended';destination={};currentTime=0;
  resume(){return new Promise<void>(done=>{resume=()=>{this.state='running';done();};});}
  createMediaStreamDestination(){return {stream:{}};}
  async close(){}
 });
 const f=fixture(),started=f.call.start();
 expect(f.transport.sendJSON).toHaveBeenCalledWith({type:'start_call'});
 expect(f.input.start).not.toHaveBeenCalled();
 expect(f.call.starting).toBe(true);
 f.receive({type:'status',status:'listening'});
 expect(f.call.active).toBe(false);
 f.receive({type:'error',message:'Speech recognition connection was lost',stage:'stt',retryable:true});
 resume();await started;
 expect(f.input.start).not.toHaveBeenCalled();expect(f.call.active).toBe(false);
 expect(f.failed).toHaveBeenCalledWith('Speech recognition connection was lost');
});
it('waits for both SDK microphone startup and a server listening acknowledgement',async()=>{
 const f=fixture(),started=f.call.start();await vi.waitFor(()=>expect(f.input.start).toHaveBeenCalledOnce());
 f.receive({type:'status',status:'idle'});f.resolve();await started;
 expect(f.call.starting).toBe(true);expect(f.call.active).toBe(false);
 f.receive({type:'status',status:'listening'});expect(f.call.active).toBe(true);
 f.call.stop();expect(f.client.status).toBe('idle');expect(f.input.stop).toHaveBeenCalled();
});
it('handles server termination while SDK microphone startup is pending without reactivation',async()=>{
 const f=fixture(),started=f.call.start();await vi.waitFor(()=>expect(f.input.start).toHaveBeenCalledOnce());
 f.receive({type:'status',status:'listening'});f.receive({type:'status',status:'idle'});
 f.resolve();await started;
 expect(f.call.starting).toBe(false);expect(f.call.active).toBe(false);expect(f.input.stop).toHaveBeenCalled();
 expect(f.input.onAudioData).toBeNull();
});
it('ends the SDK call immediately on a startup error and cleans up late audio readiness',async()=>{
 const f=fixture(),started=f.call.start();await vi.waitFor(()=>expect(f.input.start).toHaveBeenCalledOnce());
 f.receive({type:'error',message:'Speech service unavailable',stage:'stt',retryable:true});
 expect(f.call.starting).toBe(false);expect(f.transport.sendJSON).toHaveBeenCalledWith({type:'end_call'});
 expect(f.failed).toHaveBeenCalledWith('Speech service unavailable');f.resolve();await started;
 expect(f.call.active).toBe(false);expect(f.input.onAudioData).toBeNull();
});
it('does not misreport a missing microphone as denied permission',async()=>{
 const f=fixture();
 f.input.start.mockImplementation(async()=>{throw new DOMException('Requested device not found','NotFoundError');});
 const logged=vi.spyOn(console,'error').mockImplementation(()=>{});
 try{
  await f.call.start();
  expect(f.call.starting).toBe(false);expect(f.call.active).toBe(false);
  expect(f.transport.sendJSON).toHaveBeenCalledWith({type:'end_call'});
  expect(f.failed).toHaveBeenCalledWith('The microphone could not start. Check that a microphone is connected and allowed in your browser, then try again. You can also type below.');
 }finally{logged.mockRestore();}
});
it('stops pending microphone startup after access closure without resuming capture on reconnect',async()=>{
 const f=fixture(),started=f.call.start();await vi.waitFor(()=>expect(f.input.start).toHaveBeenCalledOnce());
 f.transport.connected=false;f.transport.onclose?.({code:1008,reason:'Conversation access ended',wasClean:true});
 expect(f.call.starting).toBe(false);expect(f.call.active).toBe(false);
 f.resolve();await started;expect(f.input.onAudioData).toBeNull();
 f.transport.connected=true;f.transport.onopen?.();
 expect(f.call.active).toBe(false);expect(f.input.start).toHaveBeenCalledOnce();
 const starts=(f.transport.sendJSON as ReturnType<typeof vi.fn>).mock.calls.filter(([message])=>message.type==='start_call');
 expect(starts).toHaveLength(1);
});
it('disconnects once and offers recovery on policy closure without using server reason text',()=>{
 const f=fixture(),ended=vi.fn();bindVoiceAccessRecovery(f.client,ended);
 f.transport.disconnect=vi.fn();
 f.transport.onclose?.({code:1008,reason:'untrusted private details',wasClean:true});
 expect(ended).toHaveBeenCalledOnce();expect(ended).toHaveBeenCalledWith();
 expect(f.transport.disconnect).toHaveBeenCalledOnce();expect(f.client.connected).toBe(false);
 f.transport.onclose?.({code:1008,wasClean:true});expect(ended).toHaveBeenCalledOnce();
});
it('preserves ordinary reconnect for transient network closure',()=>{
 const f=fixture(),ended=vi.fn();bindVoiceAccessRecovery(f.client,ended);f.transport.disconnect=vi.fn();
 f.transport.onclose?.({code:1006,wasClean:false});f.transport.onopen?.();
 expect(ended).not.toHaveBeenCalled();expect(f.transport.disconnect).not.toHaveBeenCalled();expect(f.client.connected).toBe(true);
});
