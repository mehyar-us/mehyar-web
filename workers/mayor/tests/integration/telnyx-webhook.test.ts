import {beforeAll,it,expect} from 'vitest';
import {validTelnyxSignature,readTelnyxInitiated} from '../../src/telnyx-webhook';
let keys:CryptoKeyPair,publicKey:string;
const now=Date.parse('2026-09-29T15:00:00Z');
const encoded=(bytes:ArrayBuffer)=>btoa(String.fromCharCode(...new Uint8Array(bytes)));
beforeAll(async()=>{keys=await crypto.subtle.generateKey('Ed25519',true,['sign','verify']) as CryptoKeyPair;publicKey=encoded(await crypto.subtle.exportKey('raw',keys.publicKey));});
const event=()=>({data:{id:crypto.randomUUID(),event_type:'call.initiated',occurred_at:new Date(now).toISOString(),payload:{call_control_id:'v3:opaque-call-id',call_leg_id:crypto.randomUUID(),call_session_id:crypto.randomUUID(),connection_id:'12345',direction:'incoming',from:'+12025550123',to:'+12025550124'}}});
async function headers(raw:string,timestamp=String(now/1000)){
 const signature=encoded(await crypto.subtle.sign('Ed25519',keys.privateKey,new TextEncoder().encode(`${timestamp}|${raw}`)));
 return new Headers({'content-type':'application/json','telnyx-timestamp':timestamp,'telnyx-signature-ed25519':signature});
}
const request=(raw:string,h:Headers)=>new Request('https://mayor.example.test/webhook',{method:'POST',headers:h,body:raw});
it('verifies the exact signed bytes and returns only validated incoming event fields',async()=>{
 const value=event(),raw=JSON.stringify({...value,untrusted_extra:'not returned'}),h=await headers(raw);
 expect(await validTelnyxSignature(raw,h,publicKey,now)).toBe(true);
 expect(await readTelnyxInitiated(request(raw,h),publicKey,now)).toEqual(value.data);
 expect(await validTelnyxSignature(raw+' ',h,publicKey,now)).toBe(false);
});
it.each([-301000,31000])('rejects a correctly signed timestamp outside the acceptance window (%s ms)',async delta=>{
 const raw=JSON.stringify(event());expect(await validTelnyxSignature(raw,await headers(raw,String((now+delta)/1000)),publicKey,now)).toBe(false);
});
it.each(['missing-key','wrong-key','missing-signature','bad-signature','duplicate-timestamp'])('fails closed for %s',async failure=>{
 const raw=JSON.stringify(event()),h=await headers(raw);let key=publicKey;
 if(failure==='missing-key')key='';if(failure==='wrong-key')key=encoded(new Uint8Array(32).fill(1).buffer);
 if(failure==='missing-signature')h.delete('telnyx-signature-ed25519');if(failure==='bad-signature')h.set('telnyx-signature-ed25519','invalid');
 if(failure==='duplicate-timestamp')h.append('telnyx-timestamp',String(now/1000));
 await expect(readTelnyxInitiated(request(raw,h),key,now)).rejects.toMatchObject({code:'invalid_signature'});
});
it.each(['outgoing','wrong-event','invalid-number'])('rejects signed unsupported input: %s',async kind=>{
 const value=event();if(kind==='outgoing')value.data.payload.direction='outgoing';if(kind==='wrong-event')value.data.event_type='call.answered';if(kind==='invalid-number')value.data.payload.from='anonymous';
 const raw=JSON.stringify(value);await expect(readTelnyxInitiated(request(raw,await headers(raw)),publicKey,now)).rejects.toMatchObject({code:'invalid_webhook'});
});
it('bounds streamed bodies even without Content-Length',async()=>{
 const raw='x'.repeat(65537);await expect(readTelnyxInitiated(request(raw,await headers(raw)),publicKey,now)).rejects.toMatchObject({code:'webhook_too_large'});
});
it('authenticates before parsing malformed JSON',async()=>{
 const raw='{';await expect(readTelnyxInitiated(request(raw,await headers(raw)),'',now)).rejects.toMatchObject({code:'invalid_signature'});
 await expect(readTelnyxInitiated(request(raw,await headers(raw)),publicKey,now)).rejects.toMatchObject({code:'invalid_webhook'});
});
