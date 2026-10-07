import {z} from 'zod';
import type {Actor,Env} from './env';
import {HttpError,readJson} from './http';
import {telnyxManagementAccess} from './telnyx-connections';
import {twilioManagementAccess} from './phone-connections';

export const phoneProvider=z.enum(['telnyx','twilio']);
type Provider=z.infer<typeof phoneProvider>;
type App={id:string;name:string;url:string;ready:boolean};
const telApp=z.object({id:z.string().regex(/^\d{1,64}$/),application_name:z.string().max(256),webhook_event_url:z.string().max(2048),active:z.boolean(),webhook_api_version:z.string()});
const twApp=z.object({sid:z.string().regex(/^AP[0-9a-fA-F]{32}$/),account_sid:z.string(),friendly_name:z.string().max(256),voice_url:z.string().max(2048).nullable(),voice_method:z.string().nullable()});
const error=(code:string,message:string)=>new HttpError(409,code,message);

/** Tenant-scoped application preparation only. Never attaches numbers or activates calls. */
export async function manageVoiceApplication(env:Env,actor:Actor,provider:Provider,create=false,transport:typeof fetch=fetch){
 phoneProvider.parse(provider);
 const access=await (provider==='telnyx'?telnyxManagementAccess(env,actor,transport):twilioManagementAccess(env,actor));
 const callback=`${env.APP_ORIGIN}/api/phone/${provider}/incoming/${actor.tenantId}`;
 const base=provider==='telnyx'?'https://api.telnyx.com/v2/call_control_applications':`https://api.twilio.com/2010-04-01/Accounts/${access.account}/Applications.json`;
 const request=async(method:'GET'|'POST',url:string,body?:string)=>{
  await access.current();
  const response=await transport(url,{method,redirect:'manual',signal:AbortSignal.timeout(12000),headers:{authorization:access.authorization,accept:'application/json',...(body?{'content-type':provider==='telnyx'?'application/json':'application/x-www-form-urlencoded'}:{})},body});
  if(!response.ok){await response.body?.cancel();throw error('phone_management_unavailable','The provider could not verify this action. Check account permissions and billing.');}
  if(!response.headers.get('content-type')?.toLowerCase().startsWith('application/json')){await response.body?.cancel();throw error('provider_response_invalid','The provider returned an invalid response.');}
  return readJson(new Request('https://internal.invalid',{method:'POST',headers:{'content-type':'application/json'},body:response.body}),256000);
 };
 const normalize=(raw:unknown):App=>{
  if(provider==='telnyx'){const a=telApp.parse(raw);return {id:a.id,name:a.application_name,url:a.webhook_event_url,ready:a.active&&a.webhook_api_version==='2'};}
  const a=twApp.parse(raw);if(a.account_sid!==access.account)throw error('provider_account_mismatch','The application belongs to another account.');
  return {id:a.sid,name:a.friendly_name,url:a.voice_url??'',ready:a.voice_method==='POST'};
 };
 let apps:App[];
 if(provider==='telnyx'){
  const list=z.object({data:z.array(telApp).max(100),meta:z.object({page_number:z.literal(1),total_pages:z.number().int().min(0).max(1)})}).parse(await request('GET',base+'?page[number]=1&page[size]=100'));
  apps=list.data.map(normalize);
 }else{
  const list=z.object({applications:z.array(twApp).max(1000),next_page_uri:z.null()}).parse(await request('GET',base+'?PageSize=1000'));
  apps=list.applications.map(normalize);
 }
 await access.current();
 const matches=apps.filter(a=>a.url===callback);
 if(matches.length>1)throw error('multiple_voice_apps','More than one voice app targets this business. Review them before continuing.');
 const result=(application:App|null)=>({provider,application:application?{id:application.id,name:application.name}:null,stage:application?(application.ready?'application_prepared':'application_needs_review'):'application_missing',canCreate:access.canCreate,callback,routingChanged:false,callsReady:false,
  next:application?'Voice app found. Number routing, call verification and activation are still required.':access.canCreate?'Prepare a voice app for this business. This will not change any number routing.':'Your connection is read-only. Voice-management permission is required to create an app.'});
 if(matches.length)return result(matches[0]);
 if(!create)return result(null);
 if(!access.canCreate)throw error('voice_permission_required','Reconnect with voice-management permission before preparing a voice app.');
 const operation=crypto.randomUUID(),now=new Date().toISOString();
 const claimed=await env.AGENT_DB.prepare(`INSERT OR IGNORE INTO mayor_voice_application_operations(tenant_id,provider,account_id,operation_id,state,updated_at) VALUES(?,?,?,?,'dispatching',?)`).bind(actor.tenantId,provider,access.account,operation,now).run();
 if(claimed.meta.changes!==1)throw error('voice_application_review_required','An earlier setup attempt needs review. Refresh its status; it will not be repeated automatically.');
 try{
  // Fresh access check immediately before dispatch; an uncertain result is never retried.
  await access.current();
  const name=`The Mayor — ${actor.tenantId}`;
  const body=provider==='telnyx'?JSON.stringify({application_name:name,webhook_event_url:callback,webhook_api_version:'2',active:true,anchorsite_override:'Latency',first_command_timeout:true,first_command_timeout_secs:10,redact_dtmf_debug_logging:true}):new URLSearchParams({FriendlyName:name,VoiceUrl:callback,VoiceMethod:'POST',PublicApplicationConnectEnabled:'false'}).toString();
  const raw=await request('POST',base,body);
  const app=normalize(provider==='telnyx'?z.object({data:z.unknown()}).parse(raw).data:raw);
  if(app.url!==callback||!app.ready)throw error('voice_application_unverified','The new voice app could not be verified. Review it before trying again.');
  await access.current();
  await env.AGENT_DB.batch([
   env.AGENT_DB.prepare("UPDATE mayor_voice_application_operations SET state='ready',application_id=?,updated_at=? WHERE operation_id=?").bind(app.id,new Date().toISOString(),operation),
   env.AGENT_DB.prepare("INSERT INTO mayor_audit(id,tenant_id,actor_id,event,resource_id,created_at) VALUES(?,?,?,'phone.application_prepared',?,?)").bind(crypto.randomUUID(),actor.tenantId,actor.userId,app.id,new Date().toISOString()),
  ]);
  return result(app);
 }catch{
  await env.AGENT_DB.prepare("UPDATE mayor_voice_application_operations SET state='uncertain',updated_at=? WHERE operation_id=?").bind(new Date().toISOString(),operation).run();
  throw error('voice_application_uncertain','Application setup could not be confirmed. Refresh status before doing anything else; no automatic retry will be made.');
 }
}
