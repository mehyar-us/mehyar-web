import {HttpError} from '../http';
const invalid=()=>new HttpError(400,'invalid_email_webhook_signature','Email webhook signature could not be verified.');
export async function verifyEmailWebhook(raw:string,headers:Headers,secret:string,now=Date.now()){
  const id=headers.get('svix-id')??'',stamp=headers.get('svix-timestamp')??'',signatures=headers.get('svix-signature')??'';
  if(!/^[A-Za-z0-9_-]{1,128}$/.test(id)||!/^\d{1,12}$/.test(stamp)||!Number.isFinite(now)||Math.abs(Number(stamp)-Math.floor(now/1000))>300||!signatures||signatures.length>2048)throw invalid();
  let key:CryptoKey;
  try{
    if(!/^whsec_[A-Za-z0-9+/]+={0,2}$/.test(secret))throw new Error();
    const bytes=Uint8Array.from(atob(secret.slice(6)),c=>c.charCodeAt(0));if(bytes.length<16||bytes.length>128)throw new Error();
    key=await crypto.subtle.importKey('raw',bytes,{name:'HMAC',hash:'SHA-256'},false,['verify']);
  }catch{throw new HttpError(503,'email_webhook_unconfigured','Email webhook verification is unavailable.');}
  const content=new TextEncoder().encode(`${id}.${stamp}.${raw}`);
  for(const value of signatures.trim().split(/\s+/).slice(0,16)){
    if(!/^v1,[A-Za-z0-9+/]{43}=$/.test(value))continue;
    const signature=Uint8Array.from(atob(value.slice(3)),c=>c.charCodeAt(0));
    if(await crypto.subtle.verify('HMAC',key,signature,content))return id;
  }
  throw invalid();
}
export async function readEmailWebhookBody(request:Request){
  const reader=request.body?.getReader();if(!reader)throw new HttpError(400,'invalid_email_webhook','An event body is required.');
  const chunks:Uint8Array[]=[];let size=0;
  for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>65536){await reader.cancel();throw new HttpError(413,'email_webhook_too_large','Email webhook is too large.');}chunks.push(part.value);}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  try{return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);}catch{throw new HttpError(400,'invalid_email_webhook','Email webhook encoding is invalid.');}
}
