import {telnyxInboundSchema} from './telnyx-inbound-config';
import {z} from 'zod';
import {phoneWriteAccess} from './phone-write-access';
import type {Actor,Env} from './env';
import {OPERATORS,requireMembership,requireTenant} from './permissions';
import {HttpError,digest,readJson} from './http';
import {sealPhoneCredential,unsealPhoneCredential} from './phone-connections';
import {telnyxOAuthAccess,telnyxOAuthConfig,storeTelnyxOAuth,telnyxOAuthEnvelopeSchema} from './auth/telnyx-vault';
import type {TelnyxOAuthConfig,TelnyxOAuthTokens} from './auth/telnyx-protocol';

export const telnyxConnectionSchema=z.object({apiKey:z.string().min(16).max(512).regex(/^[\x21-\x7e]+$/),inbound:telnyxInboundSchema.optional()}).strict();
const applicationSchema=z.object({id:z.string(),active:z.literal(true),record_type:z.literal('call_control_application'),webhook_api_version:z.literal('2'),webhook_event_url:z.string()});
const callbackFor=(env:Env,tenantId:string)=>`${env.APP_ORIGIN}/api/phone/telnyx/incoming/${tenantId}`;
const idSchema=z.string().regex(/^[A-Za-z0-9-]{1,64}$/);
const numberSchema=z.object({id:idSchema,phone_number:z.string().regex(/^\+[1-9]\d{6,14}$/),status:z.string(),connection_id:z.string().nullable().optional()});
type Credential=z.infer<typeof telnyxConnectionSchema>;
type Row={id:string;tenant_id:string;account_id:string;owner_user_id:string;ciphertext:string;status:string;revision:number;selected_number_id:string|null;selected_number:string|null};
/** Server-only adapter; never serialize provider credentials to the browser. */
export async function telnyxManagementAccess(env:Env,actor:Actor,transport:typeof fetch=fetch){
 const row=await saved(env,actor),value=await credential(env,row,actor,transport);
 const envelope=await unsealPhoneCredential(env,await saved(env,actor),'telnyx') as any;
 const canCreate=envelope.kind!=='oauth'||envelope.tokens?.scopes?.includes('voice.write')===true;
 return {id:row.id,account:row.account_id,revision:row.revision,authorization:`Bearer ${value.apiKey}`,canCreate,
  async current(){const now=await saved(env,actor);if(now.account_id!==row.account_id||now.revision!==row.revision)throw fail(409,'connection_changed','Your phone connection changed. Try again.');}};
}
const fail=(status:number,code:string,message:string)=>new HttpError(status,code,message);
async function authorize(env:Env,actor:Actor){
 await requireMembership(env,actor,OPERATORS);
 if((await requireTenant(env,actor)).status!=='active')throw fail(409,'workspace_inactive','This workspace is not active.');
}
async function saved(env:Env,actor:Actor){
 await authorize(env,actor);
 const row=await env.AGENT_DB.prepare("SELECT * FROM mayor_phone_connections WHERE tenant_id=? AND provider='telnyx' AND status='authorized'").bind(actor.tenantId).first<Row>();
 if(!row)throw fail(409,'phone_not_connected','Connect Telnyx first.');
 await requireMembership(env,{tenantId:actor.tenantId,userId:row.owner_user_id},OPERATORS);
 return row;
}
async function credential(env:Env,row:Row,actor:Actor={tenantId:row.tenant_id,userId:row.owner_user_id},transport:typeof fetch=fetch):Promise<Credential>{
 let value:unknown;
 try{value=await unsealPhoneCredential(env,row,'telnyx');}
 catch{throw fail(409,'reconnect_required','Reconnect Telnyx.');}
 if(value&&typeof value==='object'&&'kind' in value&&value.kind==='oauth'){const envelope=telnyxOAuthEnvelopeSchema.parse(value);return {apiKey:await telnyxOAuthAccess(env,actor,row,telnyxOAuthConfig(env),transport),inbound:envelope.inbound};}
 try{return telnyxConnectionSchema.parse(value);}
 catch{throw fail(409,'reconnect_required','Reconnect Telnyx.');}
}
async function providerGet(value:Credential,path:string,transport:typeof fetch){
 // Only internally constructed read paths; never follow provider-supplied URLs.
 if(!/^\/phone_numbers(?:\?page\[number\]=\d+&page\[size\]=100|\/[A-Za-z0-9-]{1,64}(?:\/voice)?)$/.test(path)&&!/^\/call_control_applications\/\d{1,64}$/.test(path))throw fail(502,'provider_response_invalid','Invalid phone resource.');
 const response=await transport('https://api.telnyx.com/v2'+path,{method:'GET',redirect:'manual',signal:AbortSignal.timeout(12000),headers:{authorization:`Bearer ${value.apiKey}`,accept:'application/json'}});
 if(!response.ok){await response.body?.cancel();throw fail(response.status===429?429:409,'provider_access_failed','Telnyx access could not be verified. Check your API key permissions.');}
 return readJson(new Request('https://internal.invalid',{method:'POST',headers:{'content-type':'application/json'},body:response.body}),256000);
}
async function directory(value:Credential,transport:typeof fetch){
 const numbers:{id:string;number:string;eligible:boolean;status:string}[]=[],seen=new Set<string>();
 for(let page=1;page<=20;page++){
  const result=z.object({data:z.array(numberSchema).max(100),meta:z.object({page_number:z.number().int(),total_pages:z.number().int().nonnegative()})}).parse(await providerGet(value,`/phone_numbers?page[number]=${page}&page[size]=100`,transport));
  if(result.meta.page_number!==page||(result.meta.total_pages===0&&result.data.length))throw fail(502,'provider_pagination_invalid','The number list could not be completed.');
  for(const number of result.data){
   if(seen.has(number.id))throw fail(502,'provider_pagination_invalid','The number list changed. Try again.');seen.add(number.id);
   numbers.push({id:number.id,number:number.phone_number,eligible:number.status==='active',status:number.status});
  }
  if(page>=result.meta.total_pages)return numbers;
 }
 throw fail(409,'phone_directory_too_large','This account has too many numbers to list here.');
}
export async function connectTelnyx(env:Env,actor:Actor,input:Credential,transport:typeof fetch=fetch){
 await authorize(env,actor);const value=telnyxConnectionSchema.parse(input),numbers=await directory(value,transport);
 // The number API does not attest an account ID. Bind to this key fingerprint,
 // without presenting it as verified business identity or returning it to clients.
 const account=await digest(value.apiKey),ciphertext=await sealPhoneCredential(env,actor,'telnyx',account,value);
 await authorize(env,actor);
 const id=await digest(`telnyx:${actor.tenantId}`),now=new Date().toISOString();
 const written=await env.AGENT_DB.batch([
  env.AGENT_DB.prepare(`INSERT INTO mayor_phone_connections(id,tenant_id,provider,account_id,owner_user_id,ciphertext,status,verified_at,updated_at)
   SELECT ?,?,'telnyx',?,?,?,'authorized',?,? WHERE ${phoneWriteAccess} ON CONFLICT(tenant_id,provider) DO UPDATE SET account_id=excluded.account_id,owner_user_id=excluded.owner_user_id,ciphertext=excluded.ciphertext,status='authorized',selected_number_id=NULL,selected_number=NULL,revision=revision+1,verified_at=excluded.verified_at,updated_at=excluded.updated_at`).bind(id,actor.tenantId,account,actor.userId,ciphertext,now,now,actor.tenantId,actor.userId),
  env.AGENT_DB.prepare("INSERT INTO mayor_audit(id,tenant_id,actor_id,event,resource_id,created_at) SELECT ?,?,?,'phone.connected',?,? WHERE changes()=1").bind(crypto.randomUUID(),actor.tenantId,actor.userId,id,now),
 ]);
 if(written[0].meta.changes!==1)throw fail(403,'phone_access_changed','Your access changed. Reload before connecting a phone account.');
 return {provider:'telnyx',status:'authorized',numbers,callsReady:false};
}
export async function telnyxNumbers(env:Env,actor:Actor,transport:typeof fetch=fetch){
 const row=await saved(env,actor),numbers=await directory(await credential(env,row,actor,transport),transport);
 if((await saved(env,actor)).revision!==row.revision)throw fail(409,'connection_changed','Your phone connection changed. Try again.');
 return {numbers,callsReady:false};
}
export async function selectTelnyxNumber(env:Env,actor:Actor,id:string,transport:typeof fetch=fetch){
 if(!idSchema.safeParse(id).success)throw fail(400,'invalid_number','Choose an owned phone number.');
 const row=await saved(env,actor),value=await credential(env,row,actor,transport);
 const result=z.object({data:numberSchema}).parse(await providerGet(value,`/phone_numbers/${id}`,transport));
 if(result.data.id!==id||result.data.status!=='active')throw fail(409,'number_not_eligible','Choose an active number owned by this account.');
 if(value.inbound){
  if(result.data.connection_id!==value.inbound.applicationId)throw fail(409,'number_application_mismatch','This number is not assigned to the configured Telnyx voice application.');
  const application=z.object({data:applicationSchema}).safeParse(await providerGet(value,`/call_control_applications/${value.inbound.applicationId}`,transport));
  if(!application.success||application.data.data.id!==value.inbound.applicationId||!application.data.data.active||application.data.data.webhook_event_url!==callbackFor(env,actor.tenantId))throw fail(409,'voice_application_not_ready','The Telnyx voice application must be active, use version 2 webhooks and point to this business’s Mayor endpoint.');
 }
 const voice=z.object({data:z.object({id:z.string(),phone_number:z.string()})}).parse(await providerGet(value,`/phone_numbers/${id}/voice`,transport));
 if(voice.data.id!==id||voice.data.phone_number!==result.data.phone_number)throw fail(409,'number_not_eligible','Voice settings could not be verified for this number.');
 await saved(env,actor);
 const update=await env.AGENT_DB.prepare(`UPDATE mayor_phone_connections SET selected_number_id=?,selected_number=?,revision=revision+1,updated_at=? WHERE id=? AND revision=? AND status='authorized' AND ${phoneWriteAccess} AND ${phoneWriteAccess}`).bind(id,result.data.phone_number,new Date().toISOString(),row.id,row.revision,actor.tenantId,actor.userId,actor.tenantId,row.owner_user_id).run();
 if(update.meta.changes!==1)throw fail(409,'connection_changed','Your phone connection changed. Try again.');
 return {number:result.data.phone_number,selected:true,routingChanged:false,callsReady:false};
}

export async function connectTelnyxOAuth(env:Env,actor:Actor,revision:number,tokens:TelnyxOAuthTokens,config:TelnyxOAuthConfig,transport:typeof fetch=fetch){
 await authorize(env,actor);
 const numbers=await directory({apiKey:tokens.accessToken},transport);
 const connected=await storeTelnyxOAuth(env,actor,revision,tokens,config);
 return {...connected,numbers};
}
export async function disconnectTelnyx(env:Env,actor:Actor){
 await authorize(env,actor);
 await env.AGENT_DB.prepare(`UPDATE mayor_phone_connections SET ciphertext='',status='revoked',selected_number_id=NULL,selected_number=NULL,revision=revision+1,updated_at=? WHERE tenant_id=? AND provider='telnyx' AND ${phoneWriteAccess}`).bind(new Date().toISOString(),actor.tenantId,actor.tenantId,actor.userId).run();
 await authorize(env,actor);
 return {status:'revoked',providerKeyRevoked:false,routingChanged:false};
}

/** Internal admission only; never return credentials through a model tool or API. */
export async function telnyxWebhookConnection(env:Env,tenantId:string){
 const row=await env.AGENT_DB.prepare("SELECT * FROM mayor_phone_connections WHERE tenant_id=? AND provider='telnyx' AND status='authorized'").bind(tenantId).first<Row>();
 if(!row?.selected_number)throw fail(404,'phone_unavailable','Phone unavailable.');
 await authorize(env,{tenantId,userId:row.owner_user_id});
 // Authenticate webhook bytes before any token refresh or provider request.
 const raw=await unsealPhoneCredential(env,row,'telnyx');
 const value=raw&&typeof raw==='object'&&'kind' in raw&&raw.kind==='oauth'?telnyxOAuthEnvelopeSchema.parse(raw):telnyxConnectionSchema.parse(raw);
 if('clientId' in value&&value.clientId!==telnyxOAuthConfig(env).clientId)throw fail(409,'reconnect_required','Reconnect Telnyx.');
 if(!value.inbound)throw fail(503,'phone_test_not_configured','Telnyx inbound testing is not configured.');
 return {row,inbound:value.inbound};
}

/** Read-only pre-admission check; authenticate the webhook before calling this. */
export async function verifyTelnyxInboundBinding(env:Env,tenantId:string,revision:number,transport:typeof fetch=fetch){
 const {row,inbound}=await telnyxWebhookConnection(env,tenantId);
 if(row.revision!==revision||!row.selected_number_id)throw fail(409,'connection_changed','Phone connection changed.');
 const value=await credential(env,row,{tenantId,userId:row.owner_user_id},transport);
 const [numberResult,appResult]=await Promise.all([
  providerGet(value,`/phone_numbers/${row.selected_number_id}`,transport),
  providerGet(value,`/call_control_applications/${inbound.applicationId}`,transport),
 ]);
 const number=z.object({data:numberSchema}).safeParse(numberResult);
 const application=z.object({data:applicationSchema}).safeParse(appResult);
 if(!number.success||number.data.data.id!==row.selected_number_id||number.data.data.phone_number!==row.selected_number||number.data.data.status!=='active'||number.data.data.connection_id!==inbound.applicationId||!application.success||application.data.data.id!==inbound.applicationId||application.data.data.webhook_event_url!==callbackFor(env,tenantId))throw fail(409,'inbound_binding_changed','Telnyx number or voice application settings changed. Review the connection before testing calls.');
 const current=await telnyxWebhookConnection(env,tenantId);
 if(current.row.revision!==revision)throw fail(409,'connection_changed','Phone connection changed.');
}

/** Resolve a fresh call credential only after signature/call authorization. Never expose to clients. */
export async function telnyxCallCredential(env:Env,tenantId:string,revision:number,scope:'voice.read'|'voice.write'|'verify.write',transport:typeof fetch=fetch){
 const {row}=await telnyxWebhookConnection(env,tenantId);
 if(row.revision!==revision)throw fail(409,'connection_changed','Phone connection changed.');
 const raw=await unsealPhoneCredential(env,row,'telnyx');
 if(raw&&typeof raw==='object'&&'kind' in raw&&raw.kind==='oauth'){
  const value=telnyxOAuthEnvelopeSchema.parse(raw);
  if(!value.tokens.scopes.includes(scope))throw fail(403,'phone_scope_required','Reconnect Telnyx with the required calling permission.');
 }
 const value=await credential(env,row,{tenantId,userId:row.owner_user_id},transport);
 const current=await saved(env,{tenantId,userId:row.owner_user_id});
 if(current.account_id!==row.account_id||current.revision!==revision)throw fail(409,'connection_changed','Phone connection changed.');
 const renewed=await unsealPhoneCredential(env,current,'telnyx');
 if(renewed&&typeof renewed==='object'&&'kind' in renewed&&renewed.kind==='oauth'&&!telnyxOAuthEnvelopeSchema.parse(renewed).tokens.scopes.includes(scope))throw fail(403,'phone_scope_required','Reconnect Telnyx with the required calling permission.');
 return value;
}

export const telnyxCallSetupSchema=telnyxInboundSchema.omit({verifyProfileId:true}).extend({confirm:z.literal('save_test_setup')}).strict();
/** Store reviewed designated-call settings; never purchases, routes, calls or activates. */
export async function saveTelnyxCallSetup(env:Env,actor:Actor,input:z.infer<typeof telnyxCallSetupSchema>,transport:typeof fetch=fetch){
 const parsed=telnyxCallSetupSchema.parse(input),{confirm,...inbound}=parsed;
 let row=await saved(env,actor);
 const original=row;
 const value=await credential(env,row,actor,transport);
 row=await saved(env,actor);
 if(row.account_id!==original.account_id||row.revision!==original.revision)throw fail(409,'connection_changed','Your phone connection changed. Refresh before saving.');
 const raw=await unsealPhoneCredential(env,row,'telnyx');
 const envelope=raw&&typeof raw==='object'&&'kind' in raw&&raw.kind==='oauth'?telnyxOAuthEnvelopeSchema.parse(raw):telnyxConnectionSchema.parse(raw);
 if('tokens' in envelope&&!envelope.tokens.scopes.includes('voice.write'))throw fail(403,'phone_scope_required','Reconnect Telnyx with voice-management permission.');
 const app=z.object({data:applicationSchema}).safeParse(await providerGet(value,'/call_control_applications/'+inbound.applicationId,transport));
 if(!app.success||app.data.data.id!==inbound.applicationId||app.data.data.webhook_event_url!==callbackFor(env,actor.tenantId))throw fail(409,'voice_application_not_ready','Choose the active Mayor voice app for this business.');
 // Validate an existing selected number without changing its provider routing.
 if(row.selected_number_id){
  const number=z.object({data:numberSchema}).parse(await providerGet(value,'/phone_numbers/'+row.selected_number_id,transport)).data;
  if(number.id!==row.selected_number_id||number.phone_number!==row.selected_number||number.status!=='active'||number.connection_id!==inbound.applicationId)throw fail(409,'number_application_mismatch','Your selected number is not assigned to this voice app. Review routing before saving.');
 }
 const ciphertext=await sealPhoneCredential(env,{tenantId:row.tenant_id,userId:row.owner_user_id},'telnyx',row.account_id,{...envelope,inbound});
 const now=new Date().toISOString();
 const result=await env.AGENT_DB.batch([
  env.AGENT_DB.prepare(`UPDATE mayor_phone_connections SET ciphertext=?,revision=revision+1,updated_at=? WHERE id=? AND revision=? AND ciphertext=? AND status='authorized' AND ${phoneWriteAccess} AND ${phoneWriteAccess}
   AND NOT EXISTS(SELECT 1 FROM mayor_phone_oauth_refresh WHERE connection_id=? AND account_id=? AND state='pending')`)
  .bind(ciphertext,now,row.id,row.revision,row.ciphertext,actor.tenantId,actor.userId,row.tenant_id,row.owner_user_id,row.id,row.account_id),
  env.AGENT_DB.prepare("INSERT INTO mayor_audit(id,tenant_id,actor_id,event,resource_id,created_at) SELECT ?,?,?,'phone.test_setup_saved',?,? WHERE changes()=1").bind(crypto.randomUUID(),actor.tenantId,actor.userId,row.id,now),
 ]);
 if(result[0].meta.changes!==1)throw fail(409,'connection_changed','Your phone connection changed. Refresh before saving.');
 return {saved:true,callsReady:false,routingChanged:false,next:'Test settings saved. Calling is not active. Verify number routing and complete a supervised test before activation.'};
}
