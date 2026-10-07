import {z} from 'zod';
import {phoneWriteAccess} from './phone-write-access';
import type {Actor,Env} from './env';
import {OPERATORS,requireMembership,requireTenant} from './permissions';
import {HttpError,digest,readJson} from './http';
import {validateTelnyxOAuthConfig} from './auth/telnyx-protocol';

export const twilioConnectionSchema=z.object({accountSid:z.string().regex(/^AC[0-9a-fA-F]{32}$/),apiKeySid:z.string().regex(/^SK[0-9a-fA-F]{32}$/),apiKeySecret:z.string().min(16).max(256).regex(/^[A-Za-z0-9_-]+$/),authToken:z.string().regex(/^[0-9a-fA-F]{32}$/).optional(),testCaller:z.string().regex(/^\+[1-9]\d{6,14}$/).optional(),verifyServiceSid:z.string().regex(/^VA[0-9a-fA-F]{32}$/).optional()}).strict();
type Credential=z.infer<typeof twilioConnectionSchema>;
type Row={id:string;tenant_id:string;account_id:string;owner_user_id:string;ciphertext:string;status:string;revision:number;selected_number_id:string|null;selected_number:string|null};
/** Server-only adapter; never serialize provider credentials to the browser. */
export async function twilioManagementAccess(env:Env,actor:Actor){
 const row=await saved(env,actor),value=await unseal(env,row);
 return {id:row.id,account:row.account_id,revision:row.revision,authorization:'Basic '+btoa(`${value.apiKeySid}:${value.apiKeySecret}`),canCreate:true,
  async current(){const now=await saved(env,actor);if(now.account_id!==row.account_id||now.revision!==row.revision)throw fail(409,'connection_changed','Your phone connection changed. Try again.');}};
}
const fail=(status:number,code:string,message:string)=>new HttpError(status,code,message);
const b64=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes));
const bytes=(value:string)=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
async function key(env:Env){
 const material=bytes(env.TOKEN_ENCRYPTION_KEY??'');
 if(material.length!==32)throw fail(503,'credential_store_unavailable','Secure connection storage is unavailable.');
 return crypto.subtle.importKey('raw',material,'AES-GCM',false,['encrypt','decrypt']);
}
function aad(actor:Actor,account:string,provider='twilio'){return new TextEncoder().encode(JSON.stringify(['mayor-phone-v1',provider,actor.tenantId,actor.userId,account]));}
export async function sealPhoneCredential(env:Env,actor:Actor,provider:string,account:string,value:unknown){
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad(actor,account,provider)},await key(env),new TextEncoder().encode(JSON.stringify(value)));
 return `v1.${b64(iv)}.${b64(new Uint8Array(encrypted))}`;
}
export async function unsealPhoneCredential(env:Env,row:Pick<Row,'tenant_id'|'owner_user_id'|'account_id'|'ciphertext'>,provider:string):Promise<unknown>{
 try{
  const [version,iv,cipher,extra]=row.ciphertext.split('.');if(version!=='v1'||extra)throw new Error();
  const raw=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(iv),additionalData:aad({tenantId:row.tenant_id,userId:row.owner_user_id},row.account_id,provider)},await key(env),bytes(cipher));
  return JSON.parse(new TextDecoder().decode(raw));
 }catch{throw fail(409,'reconnect_required','Reconnect your phone provider.');}
}
async function seal(env:Env,actor:Actor,value:Credential){
 return sealPhoneCredential(env,actor,'twilio',value.accountSid,value);
}
async function unseal(env:Env,row:Row){
 try{
  return twilioConnectionSchema.parse(await unsealPhoneCredential(env,row,'twilio'));
 }catch{throw fail(409,'reconnect_required','Reconnect your phone provider.');}
}
async function authorize(env:Env,actor:Actor){
 await requireMembership(env,actor,OPERATORS);
 if((await requireTenant(env,actor)).status!=='active')throw fail(409,'workspace_inactive','This workspace is not active.');
}
async function saved(env:Env,actor:Actor){
 await authorize(env,actor);
 const row=await env.AGENT_DB.prepare("SELECT * FROM mayor_phone_connections WHERE tenant_id=? AND provider='twilio' AND status='authorized'").bind(actor.tenantId).first<Row>();
 if(!row)throw fail(409,'phone_not_connected','Connect Twilio first.');
 await requireMembership(env,{tenantId:actor.tenantId,userId:row.owner_user_id},OPERATORS);
 return row;
}
async function providerGet(credential:Credential,path:string,transport:typeof fetch){
 const base=`https://api.twilio.com/2010-04-01/Accounts/${credential.accountSid}/IncomingPhoneNumbers`;
 const url=new URL(path,base+'.json');
 const resourcePath=new URL(base).pathname;
 const suffix=url.pathname.slice(resourcePath.length);
 if(url.origin!=='https://api.twilio.com'||!url.pathname.startsWith(resourcePath)||!(suffix==='.json'||/^\/PN[0-9a-fA-F]{32}\.json$/.test(suffix))||url.username||url.password||url.hash)throw fail(502,'provider_response_invalid','The provider returned an invalid number list.');
 const response=await transport(url,{method:'GET',redirect:'manual',signal:AbortSignal.timeout(12000),headers:{authorization:'Basic '+btoa(`${credential.apiKeySid}:${credential.apiKeySecret}`),accept:'application/json'}});
 if(!response.ok){await response.body?.cancel();throw fail(response.status===429?429:409,'provider_access_failed','Twilio access could not be verified. Check your API key permissions.');}
 // Reuse the streaming bounded reader; never trust response Content-Length.
 return readJson(new Request('https://internal.invalid',{method:'POST',headers:{'content-type':'application/json'},body:response.body}),256000);
}
const numberSchema=z.object({sid:z.string().regex(/^PN[0-9a-fA-F]{32}$/),account_sid:z.string(),phone_number:z.string().regex(/^\+[1-9]\d{6,14}$/),capabilities:z.object({voice:z.boolean()})});
async function directory(credential:Credential,transport:typeof fetch){
 let next=`https://api.twilio.com/2010-04-01/Accounts/${credential.accountSid}/IncomingPhoneNumbers.json?PageSize=100`;
 const numbers:{id:string;number:string;voice:boolean}[]=[],seen=new Set<string>();
 for(let page=0;page<20;page++){
  if(seen.has(next))throw fail(502,'provider_pagination_invalid','The provider number list could not be completed.');seen.add(next);
  const data=z.object({incoming_phone_numbers:z.array(numberSchema).max(100),next_page_uri:z.string().nullable()}).parse(await providerGet(credential,next,transport));
  for(const number of data.incoming_phone_numbers){if(number.account_sid!==credential.accountSid)throw fail(502,'provider_account_mismatch','Twilio returned a different account.');numbers.push({id:number.sid,number:number.phone_number,voice:number.capabilities.voice});}
  if(!data.next_page_uri)return numbers;
  next=data.next_page_uri;
 }
 throw fail(409,'phone_directory_too_large','The number list is too large. Use a dedicated Twilio subaccount.');
}
export async function connectTwilio(env:Env,actor:Actor,input:Credential,transport:typeof fetch=fetch){
 await authorize(env,actor);const credential=twilioConnectionSchema.parse(input);
 if(credential.verifyServiceSid){
  if(!credential.authToken||!credential.testCaller)throw fail(400,'phone_test_required','Configure a designated test caller and webhook token before phone verification.');
  const response=await transport(`https://verify.twilio.com/v2/Services/${credential.verifyServiceSid}`,{method:'GET',redirect:'manual',signal:AbortSignal.timeout(10000),headers:{authorization:'Basic '+btoa(`${credential.apiKeySid}:${credential.apiKeySecret}`)}});
  if(!response.ok){await response.body?.cancel();throw fail(409,'verify_service_unavailable','Check your Verify Service SID and API key permissions.');}
  const service=z.object({sid:z.string(),account_sid:z.string()}).parse(await readJson(new Request('https://internal.invalid',{method:'POST',headers:{'content-type':'application/json'},body:response.body}),16384));
  if(service.sid!==credential.verifyServiceSid||service.account_sid!==credential.accountSid)throw fail(409,'verify_service_mismatch','Choose a Verify service in this Twilio account.');
 }
 const numbers=await directory(credential,transport),ciphertext=await seal(env,actor,credential);
 await authorize(env,actor);
 const now=new Date().toISOString(),id=await digest(`twilio:${actor.tenantId}`);
 const written=await env.AGENT_DB.batch([
  env.AGENT_DB.prepare(`INSERT INTO mayor_phone_connections(id,tenant_id,provider,account_id,owner_user_id,ciphertext,status,verified_at,updated_at)
   SELECT ?,?,'twilio',?,?,?,'authorized',?,? WHERE ${phoneWriteAccess} ON CONFLICT(tenant_id,provider) DO UPDATE SET account_id=excluded.account_id,owner_user_id=excluded.owner_user_id,ciphertext=excluded.ciphertext,status='authorized',selected_number_id=NULL,selected_number=NULL,revision=revision+1,verified_at=excluded.verified_at,updated_at=excluded.updated_at`).bind(id,actor.tenantId,credential.accountSid,actor.userId,ciphertext,now,now,actor.tenantId,actor.userId),
  env.AGENT_DB.prepare("INSERT INTO mayor_audit(id,tenant_id,actor_id,event,resource_id,created_at) SELECT ?,?,?,'phone.connected',?,? WHERE changes()=1").bind(crypto.randomUUID(),actor.tenantId,actor.userId,id,now),
 ]);
 if(written[0].meta.changes!==1)throw fail(403,'phone_access_changed','Your access changed. Reload before connecting a phone account.');
 return {provider:'twilio',status:'authorized',numbers,callsReady:false};
}
export async function phoneConnections(env:Env,actor:Actor){
 await authorize(env,actor);
 const rows=await env.AGENT_DB.prepare('SELECT provider,status,selected_number AS number,verified_at AS verifiedAt FROM mayor_phone_connections WHERE tenant_id=?').bind(actor.tenantId).all();
 let telnyxAvailable=false;
 if(env.TELNYX_OAUTH_ENABLED==='true'&&env.TOKEN_ENCRYPTION_KEY){try{
  validateTelnyxOAuthConfig({clientId:env.TELNYX_CLIENT_ID,clientSecret:env.TELNYX_CLIENT_SECRET,redirectUri:'https://mayor.mehyar.us/api/auth/callback/telnyx',scopes:env.TELNYX_OAUTH_SCOPES?.trim().split(/\s+/)});telnyxAvailable=true;
 }catch{/* Invalid configuration must not advertise a working consent button. */}}
 return {connections:rows.results.map(row=>({...row,callsReady:false})),authorization:{
  telnyx:{available:telnyxAvailable},
  twilio:{available:false},
 }};
}
export async function twilioNumbers(env:Env,actor:Actor,transport:typeof fetch=fetch){
 const row=await saved(env,actor),numbers=await directory(await unseal(env,row),transport);
 if((await saved(env,actor)).revision!==row.revision)throw fail(409,'connection_changed','Your phone connection changed. Try again.');
 return {numbers,callsReady:false};
}
export async function selectTwilioNumber(env:Env,actor:Actor,id:string,transport:typeof fetch=fetch){
 if(!/^PN[0-9a-fA-F]{32}$/.test(id))throw fail(400,'invalid_number','Choose an owned phone number.');
 const row=await saved(env,actor),credential=await unseal(env,row);
 const number=numberSchema.parse(await providerGet(credential,`https://api.twilio.com/2010-04-01/Accounts/${credential.accountSid}/IncomingPhoneNumbers/${id}.json`,transport));
 if(number.sid!==id||number.account_sid!==credential.accountSid||!number.capabilities.voice)throw fail(409,'number_not_eligible','Choose a voice-capable number owned by this account.');
 await saved(env,actor);
 const result=await env.AGENT_DB.prepare(`UPDATE mayor_phone_connections SET selected_number_id=?,selected_number=?,revision=revision+1,updated_at=? WHERE id=? AND revision=? AND status='authorized' AND ${phoneWriteAccess} AND ${phoneWriteAccess}`).bind(id,number.phone_number,new Date().toISOString(),row.id,row.revision,actor.tenantId,actor.userId,actor.tenantId,row.owner_user_id).run();
 if(result.meta.changes!==1)throw fail(409,'connection_changed','Your phone connection changed. Try again.');
 return {number:number.phone_number,selected:true,routingChanged:false,callsReady:false};
}
export async function disconnectTwilio(env:Env,actor:Actor){
 await authorize(env,actor);
 await env.AGENT_DB.prepare(`UPDATE mayor_phone_connections SET ciphertext='',status='revoked',selected_number_id=NULL,selected_number=NULL,revision=revision+1,updated_at=? WHERE tenant_id=? AND provider='twilio' AND ${phoneWriteAccess}`).bind(new Date().toISOString(),actor.tenantId,actor.tenantId,actor.userId).run();
 await authorize(env,actor);
 return {status:'revoked',providerKeyRevoked:false,routingChanged:false};
}

/** Internal-only webhook access. Never return this object through an API or model tool. */
export async function twilioWebhookConnection(env:Env,tenantId:string){
 const row=await env.AGENT_DB.prepare("SELECT * FROM mayor_phone_connections WHERE tenant_id=? AND provider='twilio' AND status='authorized'").bind(tenantId).first<Row>();
 if(!row||!row.selected_number)throw fail(404,'phone_unavailable','Phone unavailable.');
 await authorize(env,{tenantId,userId:row.owner_user_id});
 const credential=await unseal(env,row);
 if(!credential.authToken||!credential.testCaller)throw fail(503,'phone_test_not_configured','Phone testing is not configured.');
 return {row,credential};
}
