import {z} from 'zod';

// Telnyx's WebSocket L16 is little-endian, mono, 16 kHz. It can pass directly
// to MayorPhone's PCM16 pipeline. Do not apply RTP network-byte-order swapping.
// https://github.com/team-telnyx/realtime-ai-demo/blob/main/src/telnyx/media-stream.ts
const id=z.string().min(1).max(512);
const stream=id;
const start=z.object({event:z.literal('start'),stream_id:stream,start:z.object({
 call_control_id:id,call_session_id:z.uuid(),from:z.string(),to:z.string(),
 media_format:z.object({encoding:z.literal('L16'),sample_rate:z.literal(16000),channels:z.literal(1)}),
})});
const media=z.object({event:z.literal('media'),stream_id:stream,media:z.object({track:z.literal('inbound'),payload:z.string()})});
const stop=z.object({event:z.literal('stop'),stream_id:stream});
const mark=z.object({event:z.literal('mark'),stream_id:stream,mark:z.object({name:z.string().min(1).max(128)})});
const dtmf=z.object({event:z.literal('dtmf'),stream_id:stream,dtmf:z.object({digit:z.string().regex(/^[0-9*#A-D]$/)})});
const MAX_FRAME=65536,MAX_AUDIO=16000; // At most 500 ms per frame; bounded before decoding.
export type TelnyxMediaBinding={callControlId:string;callSessionId:string;from:string;to:string};
export type TelnyxMediaEvent={kind:'connected'|'start'|'stop'}|{kind:'audio';pcm:ArrayBuffer}|{kind:'mark';name:string}|{kind:'dtmf';digit:string};
function invalid():never{throw new Error('invalid_telnyx_media');}
function decode(payload:string){
 if(!payload||payload.length>4*Math.ceil(MAX_AUDIO/3)||payload.length%4!==0||! /^[A-Za-z0-9+/]+={0,2}$/.test(payload))return invalid();
 let binary:string;try{binary=atob(payload);}catch{return invalid();}
 if(binary.length>MAX_AUDIO||binary.length%2!==0||btoa(binary)!==payload)return invalid();
 return Uint8Array.from(binary,c=>c.charCodeAt(0)).buffer;
}
/** Protocol validation, not authentication. Construct only after a server-side,
 * single-use stream grant is consumed. On any error the socket must be closed.
 * This module does not open a socket or authorize a call/customer. */
export class TelnyxMediaSession{
 private streamId:string|undefined;
 private connected=false;
 private ended=false;
 constructor(private readonly binding:TelnyxMediaBinding){}
 receive(raw:unknown):TelnyxMediaEvent{
  if(this.ended)return invalid();
  try{return this.parse(raw);}catch{this.ended=true;return invalid();}
 }
 private parse(raw:unknown):TelnyxMediaEvent{
  if(typeof raw!=='string'||raw.length>MAX_FRAME)return invalid();
  const value=JSON.parse(raw);
  if(!value||typeof value!=='object')return invalid();
  if(value.event==='connected'){
   if(this.connected||this.streamId)return invalid();
   this.connected=true;return {kind:'connected'};
  }
  if(value.event==='start'){
   if(this.streamId)return invalid();
   const frame=start.parse(value),s=frame.start,b=this.binding;
   if(s.call_control_id!==b.callControlId||s.call_session_id!==b.callSessionId||s.from!==b.from||s.to!==b.to)return invalid();
   this.streamId=frame.stream_id;return {kind:'start'};
  }
  if(!this.streamId||value.stream_id!==this.streamId)return invalid();
  switch(value.event){
   case 'media':return {kind:'audio',pcm:decode(media.parse(value).media.payload)};
   case 'mark':return {kind:'mark',name:mark.parse(value).mark.name};
   case 'dtmf':return {kind:'dtmf',digit:dtmf.parse(value).dtmf.digit};
   case 'stop':stop.parse(value);this.ended=true;return {kind:'stop'};
   default:return invalid();
  }
 }
 audio(pcm:ArrayBuffer){
  if(!this.streamId||this.ended||pcm.byteLength===0||pcm.byteLength%2!==0||pcm.byteLength>MAX_AUDIO)return invalid();
  let binary='';for(const byte of new Uint8Array(pcm))binary+=String.fromCharCode(byte);
  return JSON.stringify({event:'media',media:{payload:btoa(binary)}});
 }
 clear(){
  if(!this.streamId||this.ended)return invalid();
  return JSON.stringify({event:'clear'});
 }
}
