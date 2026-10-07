import {z} from 'zod';
import {HttpError} from './http';

// Telnyx API v2 signs the exact timestamp + "|" + raw JSON body using Ed25519.
// https://support.telnyx.com/en/articles/4334722-how-to-leverage-webhooks
const MAX_BYTES=65536;
function base64(value:string,size:number){
 if(!/^[A-Za-z0-9+/]+={0,2}$/.test(value)||value.length!==4*Math.ceil(size/3))return null;
 try{const decoded=Uint8Array.from(atob(value),c=>c.charCodeAt(0));return decoded.length===size?decoded:null;}catch{return null;}
}
export async function validTelnyxSignature(raw:string,headers:Headers,publicKey:string,now=Date.now()){
 const timestamp=headers.get('telnyx-timestamp')??'',signature=base64(headers.get('telnyx-signature-ed25519')??'',64),key=base64(publicKey,32);
 if(!signature||!key||!/^\d{10}$/.test(timestamp)||!Number.isFinite(now))return false;
 const age=now-Number(timestamp)*1000;
 if(age>300000||age < -30000||new TextEncoder().encode(raw).length>MAX_BYTES)return false;
 try{
  const imported=await crypto.subtle.importKey('raw',key,{name:'Ed25519'},false,['verify']);
  return await crypto.subtle.verify('Ed25519',imported,signature,new TextEncoder().encode(`${timestamp}|${raw}`));
 }catch{return false;}
}
const number=z.string().regex(/^\+[1-9]\d{6,14}$/);
const initiated=z.object({data:z.object({
 id:z.uuid(),event_type:z.literal('call.initiated'),occurred_at:z.iso.datetime({offset:true}),
 payload:z.object({call_control_id:z.string().min(1).max(512),call_leg_id:z.uuid(),call_session_id:z.uuid(),connection_id:z.string().regex(/^\d{1,64}$/),direction:z.literal('incoming'),from:number,to:number}),
})});
/** Authentication and shape validation only. The caller must atomically deduplicate
 * event IDs and verify the configured tenant/application/number before any command.
 * A valid caller ID is not proof of the caller's identity. */
async function readSignedEvent(request:Request,publicKey:string,now:number){
 if(request.method!=='POST'||!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type')??''))throw new HttpError(400,'invalid_webhook','Expected a JSON webhook.');
 const reader=request.body?.getReader();if(!reader)throw new HttpError(400,'invalid_webhook','Missing webhook body.');
 const chunks:Uint8Array[]=[];let size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_BYTES){await reader.cancel();throw new HttpError(413,'webhook_too_large','Webhook body is too large.');}chunks.push(value);}}finally{reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
 let raw:string;try{raw=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);}catch{throw new HttpError(400,'invalid_webhook','Invalid webhook encoding.');}
 if(!await validTelnyxSignature(raw,request.headers,publicKey,now))throw new HttpError(403,'invalid_signature','Invalid webhook signature.');
 let data:unknown;try{data=JSON.parse(raw);}catch{throw new HttpError(400,'invalid_webhook','Invalid webhook JSON.');}
 return data;
}
export async function readTelnyxInitiated(request:Request,publicKey:string,now=Date.now()){
 const parsed=initiated.safeParse(await readSignedEvent(request,publicKey,now));if(!parsed.success)throw new HttpError(400,'invalid_webhook','Expected an incoming call event.');
 return parsed.data.data;
}


const hangup=z.object({data:z.object({
 id:z.uuid(),event_type:z.literal('call.hangup'),occurred_at:z.iso.datetime({offset:true}),
 payload:z.object({call_control_id:z.string().min(1).max(512),call_leg_id:z.uuid(),call_session_id:z.uuid(),connection_id:z.string().regex(/^\d{1,64}$/),from:number,to:number}),
})});
export async function readTelnyxHangup(request:Request,publicKey:string,now=Date.now()){
 const parsed=hangup.safeParse(await readSignedEvent(request,publicKey,now));
 if(!parsed.success)throw new HttpError(400,'invalid_webhook','Expected a call-ended event.');
 return parsed.data.data;
}
export async function readTelnyxCallEvent(request:Request,publicKey:string,now=Date.now()){
 const data=await readSignedEvent(request,publicKey,now);
 const envelope=z.object({data:z.object({id:z.uuid(),event_type:z.string().min(1).max(100),occurred_at:z.iso.datetime({offset:true}),payload:z.unknown()})}).safeParse(data);
 if(!envelope.success)throw new HttpError(400,'invalid_webhook','Invalid call event.');
 if(!['call.initiated','call.hangup'].includes(envelope.data.data.event_type))return null;
 const parsed=z.object({data:z.discriminatedUnion('event_type',[initiated.shape.data,hangup.shape.data])}).safeParse(data);
 if(!parsed.success)throw new HttpError(400,'invalid_webhook','Unsupported call event.');
 return parsed.data.data;
}
