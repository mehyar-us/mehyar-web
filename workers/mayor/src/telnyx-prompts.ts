import type {Env} from './env';
import {requirePhoneCall} from './phone-call-access';
import {attachTelnyxStream} from './telnyx-stream';
import {telnyxVerificationGate} from './telnyx-verification-gate';
import type {TelnyxVoiceBridge} from './telnyx-voice-bridge';
import {readPhoneAssistantName} from './phone-assistant-persona';

/** Bounded controller text and the validated public display name only. */
export async function telnyxPromptAudio(env:Env,text:string){
 if(!text||text.length>600)throw new Error('prompt_unavailable');
 let timer:ReturnType<typeof setTimeout>;let expired=false;let activeReader:ReadableStreamDefaultReader<Uint8Array>|undefined;
 const synthesize=async()=>{
  const response=await (env.AI.run as any)('@cf/deepgram/aura-1',{text,speaker:'asteria',encoding:'linear16',sample_rate:16000,container:'none'},{returnRawResponse:true}) as Response;
  if(expired||!response.ok||!response.body){await response.body?.cancel();throw new Error('prompt_unavailable');}
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];activeReader=reader;let size=0;
  try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>960000){await reader.cancel();throw new Error('prompt_unavailable');}chunks.push(part.value);}}
  finally{activeReader=undefined;reader.releaseLock();}
  if(expired||!size||size%2)throw new Error('prompt_unavailable');
  const audio=new Uint8Array(size);let offset=0;for(const chunk of chunks){audio.set(chunk,offset);offset+=chunk.length;}return audio.buffer;
 };
 try{return await Promise.race([synthesize(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{expired=true;void activeReader?.cancel().catch(()=>{});reject(new Error('prompt_unavailable'));},15000);})]);}
 finally{clearTimeout(timer!);}
}
/** Caller first consumes its stream grant, activates its phone principal and
 * opens/accepts both sockets. No public route or new provider permission here. */
export async function attachVerifiedTelnyxStream(env:Env,id:string,provider:WebSocket,agent:WebSocket,transport:typeof fetch=fetch,onClosed:()=>void=()=>{}){
 const call=await requirePhoneCall(env,id);if(call.provider!=='telnyx')throw new Error('call_unavailable');
 const name=await readPhoneAssistantName(env,id);
 let bridge:TelnyxVoiceBridge|undefined,resolveBridge!:(value:TelnyxVoiceBridge)=>void;
 const ready=new Promise<TelnyxVoiceBridge>(resolve=>{resolveBridge=resolve;});
 const gate=telnyxVerificationGate(env,id,async text=>{
  const active=await ready;await requirePhoneCall(env,id);
  const audio=await telnyxPromptAudio(env,text);await requirePhoneCall(env,id);
  await active.playPrompt(audio);
 },()=>bridge?.close(),transport,name);
 try{bridge=await attachTelnyxStream(env,id,provider,agent,gate,onClosed);resolveBridge(bridge);return bridge;}
 catch(error){gate.close();for(const socket of [provider,agent])try{socket.close(1008,'Call unavailable');}catch{}throw error;}
}
