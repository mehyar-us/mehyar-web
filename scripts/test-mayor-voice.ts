import assert from 'node:assert/strict';
import { encodeMayorWave } from '../client/src/lib/mayor-recorder';
// @ts-ignore Cloudflare function is JavaScript.
import { onRequestPost,validateMayorWave } from '../functions/api/explore-voice.js';
// @ts-ignore Cloudflare function is JavaScript.
import { onRequestPost as ask } from '../functions/api/explore.js';
const wave=new Uint8Array(encodeMayorWave(new Float32Array(48000).fill(.2),48000));
assert.equal(validateMayorWave(wave),1);assert.equal(wave.length,32044);
const tooLong=new Uint8Array(960046);tooLong.set(wave.subarray(0,44));new DataView(tooLong.buffer).setUint32(4,tooLong.length-8,true);new DataView(tooLong.buffer).setUint32(40,960002,true);assert.throws(()=>validateMayorWave(tooLong));
const wrongFormat=wave.slice();new DataView(wrongFormat.buffer).setUint16(22,2,true);assert.throws(()=>validateMayorWave(wrongFormat));
const store=new Map<string,string>(),env={PUBLIC_AI_ENABLED:'true',CLOUDFLARE_ACCOUNT_ID:'fixture',CLOUDFLARE_EMAIL:'fixture',CLOUDFLARE_API_KEY:'fixture',INTAKE_KV:{get:async(k:string)=>store.get(k),put:async(k:string,v:string)=>{store.set(k,v);}}};
const request=(body:Uint8Array=wave,origin='https://mehyar.us',type='audio/wav')=>new Request('https://mehyar.us/api/explore-voice',{method:'POST',headers:{'content-type':type,origin},body});
let calls=0;const originalFetch=globalThis.fetch;
globalThis.fetch=(async(url:any,init:any)=>{calls++;assert(String(url).endsWith('/ai/run/@cf/openai/whisper-large-v3-turbo'));const body=JSON.parse(init.body);assert.equal(body.task,'transcribe');assert.equal(body.vad_filter,true);assert(!body.messages&&!body.tools);return new Response(JSON.stringify({result:{text:'Show me a salon booking workflow.'}}));}) as typeof fetch;
try {
  assert.equal((await onRequestPost({request:request(),env:{...env,PUBLIC_AI_ENABLED:'false'}})).status,503);
  assert.equal((await onRequestPost({request:request(wave,'https://elsewhere.invalid'),env})).status,403);
  assert.equal((await onRequestPost({request:request(wave,undefined,'application/json'),env})).status,415);
  assert.equal((await onRequestPost({request:request(new Uint8Array(2)),env})).status,400);assert.equal(calls,0);
  for(let i=0;i<6;i++){const response=await onRequestPost({request:request(),env});assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal((await response.json()).reviewRequired,true);}
  assert.equal((await onRequestPost({request:request(),env})).status,429);assert.equal(calls,6);
  const textResponse=await ask({request:new Request('https://mehyar.us/api/explore',{method:'POST',body:JSON.stringify({messages:[{role:'user',content:'Show a workflow'}]})}),env});assert.equal(textResponse.status,429,'Voice and text must share IP budget');
  assert([...store.keys()].every(k=>k.startsWith('explore:')));assert([...store.values()].every(v=>/^\d+$/.test(v)),'No audio or transcripts in KV');
  store.clear();globalThis.fetch=(async()=>new Response('',{status:503})) as typeof fetch;assert.equal((await onRequestPost({request:request(),env})).status,502);
  globalThis.fetch=(async()=>new Response(JSON.stringify({result:{text:''}}))) as typeof fetch;assert.equal((await onRequestPost({request:request(),env})).status,422);
  globalThis.fetch=(async(_url:any,options:any)=>{assert(options.signal.aborted);throw new DOMException('Aborted','AbortError');}) as typeof fetch;
  const aborted=new AbortController();aborted.abort();const cancelled=new Request('https://mehyar.us/api/explore-voice',{method:'POST',headers:{'content-type':'audio/wav'},body:wave,signal:aborted.signal});assert.equal((await onRequestPost({request:cancelled,env})).status,502);
}finally{globalThis.fetch=originalFetch;}
console.log('Passed real WAV duration/format boundaries, explicit feature/origin gating, no provider call for malformed audio, review-only transcripts, no-store responses, shared voice/text IP allowance and no audio/transcript persistence. Live provider tested separately with synthesized non-sensitive speech.');
