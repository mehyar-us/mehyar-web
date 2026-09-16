import {z} from 'zod';
const email=z.email().max(254);
const payload=z.object({from:email,to:z.tuple([email]),subject:z.string().min(1).max(200).regex(/^[^\r\n\p{Cc}\p{Cf}]+$/u),text:z.string().min(1).max(20000)}).strict();
export type PlatformEmail=z.infer<typeof payload>;
export type SendResult={state:'accepted';providerId:string}|{state:'uncertain'|'rejected'|'conflict'|'deferred'|'review_required';code:string};
export type EmailTransport=(url:string,init:RequestInit)=>Promise<Response>;
const providerId=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

async function boundedJson(response:Response):Promise<Record<string,unknown>>{
  const reader=response.body?.getReader();if(!reader)throw new Error('empty_response');
  let size=0;const chunks:Uint8Array[]=[];
  for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>65536){await reader.cancel();throw new Error('response_limit');}chunks.push(part.value);}
  const joined=new Uint8Array(size);let offset=0;for(const chunk of chunks){joined.set(chunk,offset);offset+=chunk.byteLength;}
  const value:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:false}).decode(joined));
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('invalid_response');return value as Record<string,unknown>;
}

/** Low-level transport only. Callers must durably reserve, authorize and freeze the
 * payload/key/firstAttemptAt before invoking. No automatic retries or live route. */
export class PlatformResendClient {
  constructor(private readonly apiKey:string,private readonly transport:EmailTransport=fetch,private readonly clock:()=>number=Date.now){
    if(!/^re_[A-Za-z0-9_-]+$/.test(apiKey))throw new Error('invalid_platform_email_key');
  }
  async send(value:PlatformEmail,idempotencyKey:string,firstAttemptAt:string):Promise<SendResult>{
    const message=payload.parse(value),first=Date.parse(firstAttemptAt),now=this.clock();
    if(!/^mayor-ai:email:[a-f0-9]{64}$/.test(idempotencyKey))throw new Error('invalid_platform_email_request_key');
    // Leave a one-hour safety margin inside Resend's documented 24-hour window.
    if(!Number.isFinite(first)||first>now||now-first>=23*3600000)return {state:'review_required',code:'email_retry_window_closed'};
    let response:Response;
    try{response=await this.transport('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${this.apiKey}`,'Content-Type':'application/json','Idempotency-Key':idempotencyKey},body:JSON.stringify(message),redirect:'error',signal:AbortSignal.timeout(15000)});}
    catch{return {state:'uncertain',code:'email_transport_uncertain'};}
    let body:Record<string,unknown>;
    try{body=await boundedJson(response);}catch{return {state:'uncertain',code:'email_response_unverified'};}
    if(response.ok){
      if(typeof body.id!=='string'||!providerId.test(body.id))return {state:'uncertain',code:'email_receipt_unverified'};
      return {state:'accepted',providerId:body.id};
    }
    if(response.status===409)return body.name==='concurrent_idempotent_requests'?{state:'deferred',code:'email_request_in_progress'}:{state:'conflict',code:'email_idempotency_conflict'};
    if(response.status===429)return {state:'deferred',code:'email_rate_limited'};
    if([400,401,403,404,422].includes(response.status))return {state:'rejected',code:'email_request_rejected'};
    return {state:'uncertain',code:'email_provider_uncertain'};
  }
  /** Retrieval must match the stored single-recipient payload before an event is trusted. */
  async receipt(id:string,expected:PlatformEmail):Promise<{providerId:string;lastEvent:string}>{
    const message=payload.parse(expected);if(!providerId.test(id))throw new Error('invalid_platform_email_id');
    let body:Record<string,unknown>;
    try{
      const response=await this.transport(`https://api.resend.com/emails/${id}`,{method:'GET',headers:{Authorization:`Bearer ${this.apiKey}`},redirect:'error',signal:AbortSignal.timeout(15000)});
      if(!response.ok)throw new Error();body=await boundedJson(response);
    }catch{throw new Error('platform_email_receipt_unavailable');}
    if(body.id!==id||body.from!==message.from||body.subject!==message.subject||body.text!==message.text||!Array.isArray(body.to)||body.to.length!==1||body.to[0]!==message.to[0]||!Array.isArray(body.cc)||body.cc.length||!Array.isArray(body.bcc)||body.bcc.length)throw new Error('platform_email_receipt_mismatch');
    // Keep the provider event opaque until a delivery ledger reconciles it. In
    // particular, opened/clicked are not substituted for a delivery receipt.
    if(typeof body.last_event!=='string'||!/^[a-z_]{1,60}$/.test(body.last_event))throw new Error('platform_email_event_unverified');
    return {providerId:id,lastEvent:body.last_event};
  }
}
