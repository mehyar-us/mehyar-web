import { publicAiLimit } from './_shared/publicAiLimit.js';
import { resolveLlmConfig } from './_shared/llmChat.js';
const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff',...(status===429?{'retry-after':'60'}:{})}});
// Only PCM16 mono 16kHz WAV; duration is checked from actual bytes, not a client claim.
export function validateMayorWave(bytes) {
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength), label=(n)=>String.fromCharCode(...bytes.slice(n,n+4));
  if(bytes.length<44||bytes.length>961024||label(0)!=='RIFF'||label(8)!=='WAVE'||view.getUint32(4,true)+8!==bytes.length)throw Error('wave');
  let format=false, samples=0;
  for(let at=12;at+8<=bytes.length;) {
    const n=view.getUint32(at+4,true), start=at+8, type=label(at);
    if(start+n>bytes.length)throw Error('chunk');
    if(type==='fmt ') {if(n<16||view.getUint16(start,true)!==1||view.getUint16(start+2,true)!==1||view.getUint32(start+4,true)!==16000||view.getUint32(start+8,true)!==32000||view.getUint16(start+12,true)!==2||view.getUint16(start+14,true)!==16)throw Error('format');format=true;}
    if(type==='data') {if(samples||n%2)throw Error('data');samples=n;}
    at=start+n+(n%2);
  }
  if(!format||samples<3200||samples>960000)throw Error('duration');
  return samples/32000;
}
export async function onRequestPost({request,env}) {
  const url=new URL(request.url), origin=request.headers.get('origin');
  if(!['mehyar.us','www.mehyar.us','localhost','127.0.0.1'].includes(url.hostname)||(origin&&origin!==url.origin))return reply(403,{message:'Voice input is available from MehyarSoft only.'});
  if(env.PUBLIC_AI_ENABLED!=='true'||!env.INTAKE_KV)return reply(503,{message:'Voice transcription is not configured here. Your draft stays with you.'});
  if(request.headers.get('content-type')?.split(';')[0]!=='audio/wav')return reply(415,{message:'Please record a short voice message.'});
  let bytes;
  try {
    const reader=request.body?.getReader(), chunks=[];let size=0;
    if(reader)while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>961024){await reader.cancel();return reply(413,{message:'Voice messages are limited to 30 seconds.'});}chunks.push(value);}
    bytes=new Uint8Array(size);let at=0;for(const c of chunks){bytes.set(c,at);at+=c.length;}validateMayorWave(bytes);
  }catch{return reply(400,{message:'Please record between 0.1 and 30 seconds of speech.'});}
  try {if(!await publicAiLimit(request,env))return reply(429,{message:'The Mayor has reached its request limit. Please try later. Voice and questions share the allowance.'});}catch{return reply(503,{message:'Voice request limits are unavailable. Please try later.'});}
  const cfg=resolveLlmConfig(env), account=env.CLOUDFLARE_ACCOUNT_ID;
  if(!account||!((cfg.legacyEmail&&cfg.legacyKey)||cfg.bearerToken))return reply(503,{message:'Voice transcription is unavailable. Continue with text.'});
  const abort=new AbortController(), timer=setTimeout(()=>abort.abort(),25000), cancel=()=>abort.abort();
  request.signal.addEventListener('abort',cancel);if(request.signal.aborted)abort.abort();
  try {
    let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
    const response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/@cf/openai/whisper-large-v3-turbo`,{method:'POST',signal:abort.signal,headers:{'content-type':'application/json',...(cfg.legacyEmail&&cfg.legacyKey?{'X-Auth-Email':cfg.legacyEmail,'X-Auth-Key':cfg.legacyKey}:{Authorization:`Bearer ${cfg.bearerToken}`})},body:JSON.stringify({audio:btoa(binary),task:'transcribe',vad_filter:true,condition_on_previous_text:false})});
    if(!response.ok)return reply(502,{message:'Voice transcription could not finish. Please retry or keep typing.'});
    const result=await response.json(), text=result.result?.text;
    if(typeof text!=='string'||!text.trim()||text.length>1600)return reply(422,{message:'No usable short transcript was returned. Try again or keep typing.'});
    return reply(200,{text:text.trim(),reviewRequired:true});
  }catch{return reply(502,{message:abort.signal.aborted?'Voice transcription was interrupted. Your draft stays here.':'Voice transcription could not finish. Please keep typing.'});}
  finally{clearTimeout(timer);request.signal.removeEventListener('abort',cancel);}
}
