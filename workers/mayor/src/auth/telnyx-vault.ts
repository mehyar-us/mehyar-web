import {telnyxInboundSchema} from '../telnyx-inbound-config';
import {z} from 'zod';
import type {Actor,Env} from '../env';
import {digest,HttpError} from '../http';
import {phoneWriteAccess} from '../phone-write-access';
import {sealPhoneCredential,unsealPhoneCredential} from '../phone-connections';
import {telnyxTokenExchange,validateTelnyxOAuthConfig,type TelnyxOAuthConfig,type TelnyxOAuthTokens} from './telnyx-protocol';
type Row={id:string;tenant_id:string;owner_user_id:string;account_id:string;ciphertext:string;revision:number};
const secret=z.string().min(1).max(16384).regex(/^[\x21-\x7e]+$/);
const tokenSchema=z.object({accessToken:secret,refreshToken:secret,expiresAt:z.number().int().positive(),scopes:z.array(z.string()).max(128)});
export const telnyxOAuthEnvelopeSchema=z.object({kind:z.literal('oauth'),clientId:z.string(),tokens:tokenSchema,inbound:telnyxInboundSchema.optional()}).strict();
const changed=()=>new HttpError(409,'connection_changed','Your phone connection changed. Connect again.');
const reconnect=()=>new HttpError(409,'reconnect_required','Reconnect Telnyx to renew access.');
const current=`EXISTS(SELECT 1 FROM mayor_phone_connections WHERE id=? AND account_id=? AND ciphertext=? AND status='authorized')`;

export function telnyxOAuthConfig(env:Env):TelnyxOAuthConfig{
 if(env.TELNYX_OAUTH_ENABLED!=='true'||!env.TELNYX_CLIENT_ID||!env.TELNYX_CLIENT_SECRET||!env.TELNYX_OAUTH_SCOPES?.trim())throw new HttpError(503,'provider_not_configured','Telnyx sign-in is awaiting provider setup.');
 try{return validateTelnyxOAuthConfig({clientId:env.TELNYX_CLIENT_ID,clientSecret:env.TELNYX_CLIENT_SECRET,redirectUri:'https://mayor.mehyar.us/api/auth/callback/telnyx',scopes:env.TELNYX_OAUTH_SCOPES.trim().split(/\s+/)});}
 catch{throw new HttpError(503,'provider_not_configured','Telnyx sign-in is awaiting provider setup.');}
}

/** Called only after consent, introspection and live number discovery succeed. */
export async function storeTelnyxOAuth(env:Env,actor:Actor,expectedRevision:number,tokens:TelnyxOAuthTokens,config:TelnyxOAuthConfig){
 const parsed=tokenSchema.parse(tokens);
 if(parsed.expiresAt<=Date.now()+60000||!config.scopes.every(s=>parsed.scopes.includes(s)))throw reconnect();
 const id=await digest(`telnyx:${actor.tenantId}`),account=crypto.randomUUID(),now=new Date().toISOString();
 // This is an authorization-generation binding, not an attested provider account ID.
 const ciphertext=await sealPhoneCredential(env,actor,'telnyx',account,{kind:'oauth',clientId:config.clientId,tokens:parsed});
 const result=await env.AGENT_DB.batch([
  env.AGENT_DB.prepare(`INSERT INTO mayor_phone_connections(id,tenant_id,provider,account_id,owner_user_id,ciphertext,status,verified_at,updated_at)
   SELECT ?,?,'telnyx',?,?,?,'authorized',?,? WHERE ${phoneWriteAccess}
   AND COALESCE((SELECT revision FROM mayor_phone_connections WHERE tenant_id=? AND provider='telnyx'),0)=?
   ON CONFLICT(tenant_id,provider) DO UPDATE SET account_id=excluded.account_id,owner_user_id=excluded.owner_user_id,ciphertext=excluded.ciphertext,status='authorized',selected_number_id=NULL,selected_number=NULL,revision=revision+1,verified_at=excluded.verified_at,updated_at=excluded.updated_at`)
   .bind(id,actor.tenantId,account,actor.userId,ciphertext,now,now,actor.tenantId,actor.userId,actor.tenantId,expectedRevision),
  env.AGENT_DB.prepare("INSERT INTO mayor_audit(id,tenant_id,actor_id,event,resource_id,created_at) SELECT ?,?,?,'phone.connected',?,? WHERE changes()=1").bind(crypto.randomUUID(),actor.tenantId,actor.userId,id,now),
  env.AGENT_DB.prepare('DELETE FROM mayor_phone_oauth_refresh WHERE connection_id=? AND EXISTS(SELECT 1 FROM mayor_phone_connections WHERE id=? AND account_id=?)').bind(id,id,account),
 ]);
 if(result[0].meta.changes!==1)throw changed();
 return {provider:'telnyx',status:'authorized',callsReady:false};
}

/** One durable refresh attempt per authorization; ambiguous failures require consent again. */
export async function telnyxOAuthAccess(env:Env,actor:Actor,row:Row,config:TelnyxOAuthConfig,transport:typeof fetch=fetch){
 const allowed=()=>env.AGENT_DB.prepare(`SELECT 1 WHERE ${current} AND ${phoneWriteAccess} AND ${phoneWriteAccess}`)
  .bind(row.id,row.account_id,row.ciphertext,actor.tenantId,actor.userId,row.tenant_id,row.owner_user_id).first();
 if(actor.tenantId!==row.tenant_id||!await allowed())throw changed();
 let value:z.infer<typeof telnyxOAuthEnvelopeSchema>;
 try{value=telnyxOAuthEnvelopeSchema.parse(await unsealPhoneCredential(env,row,'telnyx'));}catch{throw reconnect();}
 if(value.clientId!==config.clientId||!config.scopes.every(s=>value.tokens.scopes.includes(s)))throw reconnect();
 if(value.tokens.expiresAt>Date.now()+60000){if(!await allowed())throw changed();return value.tokens.accessToken;}
 const claim=crypto.randomUUID();
 const claimed=await env.AGENT_DB.prepare(`INSERT INTO mayor_phone_oauth_refresh(connection_id,account_id,claim_id,state,started_at)
  SELECT ?,?,?,'pending',unixepoch()*1000 WHERE ${current} AND ${phoneWriteAccess} AND ${phoneWriteAccess}
  ON CONFLICT(connection_id) DO UPDATE SET account_id=excluded.account_id,claim_id=excluded.claim_id,state='pending',started_at=excluded.started_at
  WHERE mayor_phone_oauth_refresh.account_id!=excluded.account_id`)
  .bind(row.id,row.account_id,claim,row.id,row.account_id,row.ciphertext,actor.tenantId,actor.userId,row.tenant_id,row.owner_user_id).run();
 if(claimed.meta.changes!==1){
  const lock=await env.AGENT_DB.prepare('SELECT state,started_at FROM mayor_phone_oauth_refresh WHERE connection_id=? AND account_id=?').bind(row.id,row.account_id).first<{state:string;started_at:number}>();
  if(lock?.state==='pending'&&lock.started_at>Date.now()-30000)throw new HttpError(409,'phone_refresh_pending','Telnyx is renewing access. Try again shortly.');
  throw reconnect();
 }
 try{
  // Do not release a failed claim and retry a possibly consumed refresh token.
  const tokens=await telnyxTokenExchange(config,{refreshToken:value.tokens.refreshToken},transport);
  const ciphertext=await sealPhoneCredential(env,{tenantId:row.tenant_id,userId:row.owner_user_id},'telnyx',row.account_id,{kind:'oauth',clientId:config.clientId,tokens,...(value.inbound?{inbound:value.inbound}:{})});
  const written=await env.AGENT_DB.batch([
   env.AGENT_DB.prepare(`UPDATE mayor_phone_connections SET ciphertext=?,updated_at=? WHERE id=? AND account_id=? AND ciphertext=? AND status='authorized'
    AND ${phoneWriteAccess} AND ${phoneWriteAccess} AND EXISTS(SELECT 1 FROM mayor_phone_oauth_refresh WHERE connection_id=? AND claim_id=? AND state='pending')`)
    .bind(ciphertext,new Date().toISOString(),row.id,row.account_id,row.ciphertext,actor.tenantId,actor.userId,row.tenant_id,row.owner_user_id,row.id,claim),
   env.AGENT_DB.prepare('DELETE FROM mayor_phone_oauth_refresh WHERE connection_id=? AND claim_id=? AND changes()=1').bind(row.id,claim),
  ]);
  if(written[0].meta.changes!==1)throw changed();
  const currentRow=await env.AGENT_DB.prepare(`SELECT 1 WHERE EXISTS(SELECT 1 FROM mayor_phone_connections WHERE id=? AND account_id=? AND ciphertext=? AND status='authorized') AND ${phoneWriteAccess} AND ${phoneWriteAccess}`)
   .bind(row.id,row.account_id,ciphertext,actor.tenantId,actor.userId,row.tenant_id,row.owner_user_id).first();
  if(!currentRow)throw changed();
  return tokens.accessToken;
 }catch{
  await env.AGENT_DB.prepare("UPDATE mayor_phone_oauth_refresh SET state='uncertain' WHERE connection_id=? AND claim_id=?").bind(row.id,claim).run();
  throw reconnect();
 }
}
