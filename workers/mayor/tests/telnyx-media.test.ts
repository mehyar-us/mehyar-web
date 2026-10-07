import {describe,it,expect} from 'vitest';
import {TelnyxMediaSession} from '../src/telnyx-media';
const binding={callControlId:'v3:owned-call',callSessionId:'bf08a03e-5256-4fb3-94fa-465b0349b29e',from:'+12025550101',to:'+12025550102'};
const start=()=>({event:'start',stream_id:'stream-1',start:{call_control_id:binding.callControlId,call_session_id:binding.callSessionId,from:binding.from,to:binding.to,media_format:{encoding:'L16',sample_rate:16000,channels:1}}});
const media=(payload='AID/fwEA//8=')=>JSON.stringify({event:'media',stream_id:'stream-1',media:{track:'inbound',payload}});
function session(){const s=new TelnyxMediaSession(binding);s.receive(JSON.stringify(start()));return s;}
describe('Telnyx L16 protocol boundary',()=>{
 it('preserves signed little-endian samples in both directions without resampling',()=>{
  const s=session(),event=s.receive(media());expect(event.kind).toBe('audio');
  if(event.kind!=='audio')throw new Error('Expected audio');
  const view=new DataView(event.pcm);expect([0,2,4,6].map(i=>view.getInt16(i,true))).toEqual([-32768,32767,1,-1]);
  expect(JSON.parse(s.audio(event.pcm))).toEqual({event:'media',media:{payload:'AID/fwEA//8='}});
  expect(JSON.parse(s.clear())).toEqual({event:'clear'});
 });
 it.each(['call_control_id','call_session_id','from','to'] as const)('rejects a different %s',field=>{
  const frame=start();frame.start[field]=field==='call_session_id'?'63d31a1e-b701-41d7-9cd4-adefc26c4fc1':'different';
  expect(()=>new TelnyxMediaSession(binding).receive(JSON.stringify(frame))).toThrow();
 });
 it.each([{encoding:'PCMU'},{sample_rate:8000},{channels:2}])('rejects unsupported audio format %j',format=>{
  const frame=start();Object.assign(frame.start.media_format,format);
  expect(()=>new TelnyxMediaSession(binding).receive(JSON.stringify(frame))).toThrow();
 });
 it.each(['','AQ==','!!!!','AAA','AAB=','A'.repeat(22000)])('rejects malformed, odd or oversized audio (%s)',payload=>{
  expect(()=>session().receive(media(payload))).toThrow();
 });
 it('rejects media before start and makes a protocol failure terminal',()=>{
  const s=new TelnyxMediaSession(binding);expect(()=>s.receive(media())).toThrow();expect(()=>s.receive(JSON.stringify(start()))).toThrow();
 });
 it('rejects duplicate starts and cross-stream frames',()=>{
  expect(()=>session().receive(JSON.stringify(start()))).toThrow();
  expect(()=>session().receive(media().replace('stream-1','other'))).toThrow();
 });
 it('rejects outbound track, binary frames, oversized JSON and invalid JSON',()=>{
  for(const frame of [media().replace('inbound','outbound'),new ArrayBuffer(2),' '.repeat(65537),'{',null])expect(()=>session().receive(frame)).toThrow();
 });
 it('allows one connected event and does not forward provider metadata',()=>{
  const s=new TelnyxMediaSession(binding);expect(s.receive(JSON.stringify({event:'connected',secret:'ignored'}))).toEqual({kind:'connected'});
  expect(s.receive(JSON.stringify(start()))).toEqual({kind:'start'});
  expect(()=>s.receive(JSON.stringify({event:'connected'}))).toThrow();
 });
 it('validates marks and DTMF; stops all audio when stream ends',()=>{
  const s=session();expect(s.receive(JSON.stringify({event:'mark',stream_id:'stream-1',mark:{name:'played'}}))).toEqual({kind:'mark',name:'played'});
  expect(s.receive(JSON.stringify({event:'dtmf',stream_id:'stream-1',dtmf:{digit:'#'}}))).toEqual({kind:'dtmf',digit:'#'});
  expect(s.receive(JSON.stringify({event:'stop',stream_id:'stream-1'}))).toEqual({kind:'stop'});
  expect(()=>s.audio(new ArrayBuffer(2))).toThrow();expect(()=>s.clear()).toThrow();expect(()=>s.receive(media())).toThrow();
 });
 it('rejects sending audio before start or at invalid lengths',()=>{
  expect(()=>new TelnyxMediaSession(binding).audio(new ArrayBuffer(2))).toThrow();
  for(const length of [0,1,16002])expect(()=>session().audio(new ArrayBuffer(length))).toThrow();
 });
});
