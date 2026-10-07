import {it,expect} from 'vitest';
import {TelnyxVoiceBridge} from '../../src/telnyx-voice-bridge';

it('bridges PCM and interruption controls over actual workerd WebSocket pairs',async()=>{
 const provider=new WebSocketPair(),agent=new WebSocketPair();
 for(const socket of [provider[0],provider[1],agent[0],agent[1]]){socket.accept();socket.binaryType='arraybuffer';}
 const binding={callControlId:'owned',callSessionId:'bf08a03e-5256-4fb3-94fa-465b0349b29e',from:'+12025550101',to:'+12025550102'};
 const bridge=new TelnyxVoiceBridge(binding,provider[1],agent[1]);
 provider[1].addEventListener('message',e=>bridge.fromProvider(e.data));
 agent[1].addEventListener('message',e=>bridge.fromAgent(e.data));
 for(const socket of [provider[1],agent[1]]){
  socket.addEventListener('close',()=>bridge.close());socket.addEventListener('error',()=>bridge.close());
 }
 const next=(socket:WebSocket)=>new Promise<string|ArrayBuffer>((resolve,reject)=>{
  const timeout=setTimeout(()=>reject(new Error('Expected socket message')),2000);
  socket.addEventListener('message',event=>{clearTimeout(timeout);resolve(event.data as string|ArrayBuffer);},{once:true});
 });
 try{
  const started=next(agent[0]);
  provider[0].send(JSON.stringify({event:'start',stream_id:'stream',start:{call_control_id:binding.callControlId,call_session_id:binding.callSessionId,from:binding.from,to:binding.to,media_format:{encoding:'L16',sample_rate:16000,channels:1}}}));
  expect(JSON.parse(await started as string)).toEqual({type:'start_call'});
  agent[0].send(JSON.stringify({type:'audio_config',format:'pcm16',sampleRate:16000}));
  agent[0].send(JSON.stringify({type:'status',status:'listening'}));
  const incoming=next(agent[0]);
  provider[0].send(JSON.stringify({event:'media',stream_id:'stream',media:{track:'inbound',payload:'AQD//w=='}}));
  expect(Array.from(new Uint8Array(await incoming as ArrayBuffer))).toEqual([1,0,255,255]);
  const outgoing=next(provider[0]);agent[0].send(new Uint8Array([1,0,255,255]).buffer);
  expect(JSON.parse(await outgoing as string)).toEqual({event:'media',media:{payload:'AQD//w=='}});
  const cleared=next(provider[0]);agent[0].send(JSON.stringify({type:'playback_interrupt'}));
  expect(JSON.parse(await cleared as string)).toEqual({event:'clear'});
  const ended=next(agent[0]);provider[0].send(JSON.stringify({event:'stop',stream_id:'stream'}));
  expect(JSON.parse(await ended as string)).toEqual({type:'end_call'});
 }finally{bridge.close();provider[0].close();agent[0].close();}
});
