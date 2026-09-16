import type { Actor, Env } from '../env';
import type { OAuthProvider } from '../auth/capabilities';
import { decryptCredential, encryptCredential, type ProviderCredential } from '../auth/vault';
import { HttpError, digest } from '../http';
import { CHAT_ROLES, OPERATORS, requireMembership, requireTenant } from '../permissions';
import type { ConnectorAuth, Operation } from './types';

type Grant = {id:string;user_id:string;provider:OAuthProvider;account_id:string;tenant_scope:string;
  ciphertext:string;granted_scopes:string;status:string;key_version:number;authorization_revision:number};
const failure=(code:string,message:string,status=409)=>new HttpError(status,code,message);
const normalize=(scope:string)=>scope.replace(/^https:\/\/graph\.microsoft\.com\//,'');
function scopes(value:unknown):string[] {
  if(!Array.isArray(value)||value.length>100||value.some(v=>typeof v!=='string'||v.length>2048))
    throw failure('invalid_credential','Reconnect this account to restore secure access.');
  return [...new Set((value as string[]).map(normalize))];
}
function permitted(granted:string[],operation:Operation) {
  const set=new Set(granted);
  if(!operation.scopes.every(group=>group.some(scope=>set.has(normalize(scope)))))
    throw failure('insufficient_scope','The account has not granted this operation.',403);
}
function token(value:unknown):value is string {return typeof value==='string'&&value.length>0&&value.length<=16384&&!/[\s\x00-\x1f]/.test(value);}
async function readGrant(env:Env,actor:Actor,id:string,provider:OAuthProvider):Promise<Grant> {
  await requireMembership(env,actor,CHAT_ROLES);
  const tenant=await requireTenant(env,actor);
  if(['paused','offboarding'].includes(tenant.status)) throw failure('workspace_suspended','New connector operations are paused.');
  const row=await env.AGENT_DB.prepare('SELECT * FROM auth_provider_grants WHERE id=? AND tenant_scope=? AND provider=?')
    .bind(id,actor.tenantId,provider).first<Grant>();
  if(!row||row.status!=='authorized'||!row.ciphertext) throw failure('connection_unavailable','Reconnect this account before using it.');
  await requireMembership(env,{...actor,userId:row.user_id},OPERATORS);
  if(row.key_version!==1||!env.TOKEN_ENCRYPTION_KEY) throw failure('token_custody_unavailable','Secure account access is not configured.',503);
  return row;
}
async function boundedJSON(response:Response):Promise<Record<string,unknown>> {
  const reader=response.body?.getReader();if(!reader)throw new Error('empty_token_response');
  const decoder=new TextDecoder();let size=0,text='';
  for(;;){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.byteLength;
    if(size>65536){await reader.cancel();throw new Error('token_response_too_large');}text+=decoder.decode(chunk.value,{stream:true});}
  const value=JSON.parse(text+decoder.decode());
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('invalid_token_response');
  return value;
}

export async function assertConnectionAvailable(env:Env,actor:Actor,grantId:string,provider:OAuthProvider,operation:Operation):Promise<void> {
  const row=await readGrant(env,actor,grantId,provider);
  permitted(scopes(JSON.parse(row.granted_scopes)),operation);
}

/** Internal authorization identity, stable across token refresh but not renewed consent. */
export async function credentialAuthorizationStamp(row:Pick<Grant,'user_id'|'account_id'|'authorization_revision'|'granted_scopes'>):Promise<string>{
  if(!Number.isSafeInteger(row.authorization_revision)||row.authorization_revision<1)throw failure('invalid_credential','Reconnect this account to restore secure access.');
  return digest(JSON.stringify([row.user_id,row.account_id,row.authorization_revision,scopes(JSON.parse(row.granted_scopes)).sort()]));
}
export async function connectionAuthorizationStamp(env:Env,actor:Actor,grantId:string,provider:OAuthProvider,operation:Operation):Promise<string>{
  const row=await readGrant(env,actor,grantId,provider),granted=scopes(JSON.parse(row.granted_scopes));permitted(granted,operation);
  if(!Number.isSafeInteger(row.authorization_revision)||row.authorization_revision<1)throw failure('invalid_credential','Reconnect this account to restore secure access.');
  return credentialAuthorizationStamp(row);
}

/** SERVER MODULE ONLY: never expose this return value through Agent RPC or HTTP.
 * This checks account authority/scopes, not business action policy, entitlement or resource ownership.
 * An executor must check those separately and recheck revocation immediately before its effect.
 */
export async function connectorCredential(env:Env,actor:Actor,grantId:string,provider:OAuthProvider,operation:Operation,transport:typeof fetch=fetch):Promise<ConnectorAuth> {
  const row=await readGrant(env,actor,grantId,provider);
  const binding={userId:row.user_id,provider,accountId:row.account_id,tenantId:actor.tenantId};
  let credential:ProviderCredential;
  try{credential=await decryptCredential(row.ciphertext,binding,env.TOKEN_ENCRYPTION_KEY!);}catch{throw failure('invalid_credential','Reconnect this account to restore secure access.');}
  const grantScopes=scopes(JSON.parse(row.granted_scopes)),encryptedScopes=scopes(credential.grantedScopes);
  const currentScopes=grantScopes.filter(scope=>encryptedScopes.includes(scope));
  permitted(currentScopes,operation);
  if(typeof credential.accountEmail!=='string'||!credential.accountEmail.includes('@'))throw failure('invalid_credential','Reconnect this account to verify its identity.');
  const expiry=Date.parse(credential.accessTokenExpiresAt??'');
  if(token(credential.accessToken)&&Number.isFinite(expiry)&&expiry>Date.now()+60000) {
    const latest=await readGrant(env,actor,grantId,provider);
    if(latest.ciphertext!==row.ciphertext)throw failure('credential_changed','Account authorization changed. Retry after refreshing the connection.');
    return {accessToken:credential.accessToken,accountEmail:credential.accountEmail,grantedScopes:currentScopes};
  }
  const refreshExpiry=credential.refreshTokenExpiresAt?Date.parse(credential.refreshTokenExpiresAt):null;
  if(!token(credential.refreshToken)||(refreshExpiry!==null&&(!Number.isFinite(refreshExpiry)||refreshExpiry<=Date.now())))
    throw failure('reconnect_required','Reconnect this account because its offline authorization has expired.');
  const clientId=provider==='google'?env.GOOGLE_CLIENT_ID:env.MICROSOFT_CLIENT_ID;
  const clientSecret=provider==='google'?env.GOOGLE_CLIENT_SECRET:env.MICROSOFT_CLIENT_SECRET;
  if(!clientId||!clientSecret)throw failure('provider_not_configured','The account provider is not configured.',503);
  const hash=await digest(row.ciphertext),lease=crypto.randomUUID(),now=new Date().toISOString();
  const acquired=await env.AGENT_DB.prepare(`INSERT INTO agent_credential_refreshes(grant_id,credential_hash,lease_token,status,started_at,expires_at)
    VALUES (?,?,?,'running',?,?) ON CONFLICT(grant_id) DO UPDATE SET credential_hash=excluded.credential_hash,
    lease_token=excluded.lease_token,status='running',started_at=excluded.started_at,expires_at=excluded.expires_at
    WHERE agent_credential_refreshes.credential_hash != excluded.credential_hash`)
    .bind(grantId,hash,lease,now,new Date(Date.now()+30000).toISOString()).run();
  if(acquired.meta.changes!==1) {
    const held=await env.AGENT_DB.prepare('SELECT status,expires_at FROM agent_credential_refreshes WHERE grant_id=?').bind(grantId).first<{status:string;expires_at:string}>();
    if(held?.status==='running'&&held.expires_at>new Date().toISOString())throw failure('refresh_in_progress','This connection is being renewed. Please retry shortly.');
    await env.AGENT_DB.prepare("UPDATE auth_provider_grants SET status='reconnect_required',updated_at=? WHERE id=? AND status='authorized' AND ciphertext=?")
      .bind(new Date().toISOString(),grantId,row.ciphertext).run();
    await env.AGENT_DB.prepare("UPDATE agent_credential_refreshes SET status='uncertain' WHERE grant_id=? AND credential_hash=?").bind(grantId,hash).run();
    throw failure('refresh_uncertain','Account renewal was interrupted. Reconnect before retrying.');
  }
  let dispatched=false;
  try {
    const latest=await readGrant(env,actor,grantId,provider);
    if(latest.ciphertext!==row.ciphertext)throw failure('credential_changed','Account authorization changed. Retry with the current connection.');
    const body=new URLSearchParams({grant_type:'refresh_token',client_id:clientId,client_secret:clientSecret,refresh_token:credential.refreshToken});
    // Fixed provider endpoints; never follow a redirect with application secrets.
    const endpoint=provider==='google'?'https://oauth2.googleapis.com/token':'https://login.microsoftonline.com/common/oauth2/v2.0/token';
    dispatched=true;
    const response=await transport(endpoint,{method:'POST',body,headers:{'content-type':'application/x-www-form-urlencoded'},redirect:'error',signal:AbortSignal.timeout(15000)});
    const result=await boundedJSON(response);
    if(!response.ok) {
      if(result.error==='invalid_grant') {
        await env.AGENT_DB.prepare("UPDATE auth_provider_grants SET status='reconnect_required',updated_at=? WHERE id=? AND tenant_scope=? AND status='authorized' AND ciphertext=?")
          .bind(new Date().toISOString(),grantId,actor.tenantId,row.ciphertext).run();
        throw failure('reconnect_required','The provider requires this account to reconnect.');
      }
      throw failure('refresh_unavailable','Account renewal could not be verified. Reconnect before another attempt.',503);
    }
    if(!token(result.access_token)||String(result.token_type).toLowerCase()!=='bearer'||typeof result.expires_in!=='number'||!Number.isFinite(result.expires_in)||result.expires_in<=60||result.expires_in>86400
      ||(result.refresh_token!==undefined&&!token(result.refresh_token)))throw new Error('invalid_token_response');
    // Refresh without a scope field retains only the previously verified grant; it never
    // falls back to requested permissions. An explicit response can narrow, never widen it.
    if(result.scope!==undefined&&typeof result.scope!=='string')throw new Error('invalid_scope_response');
    const responseScopes=result.scope===undefined?currentScopes:scopes((result.scope as string).split(/\s+/).filter(Boolean));
    const nextScopes=currentScopes.filter(scope=>responseScopes.includes(scope));
    if(result.refresh_token_expires_in!==undefined&&(typeof result.refresh_token_expires_in!=='number'||!Number.isFinite(result.refresh_token_expires_in)||result.refresh_token_expires_in<=0||result.refresh_token_expires_in>366*86400))throw new Error('invalid_refresh_expiry');
    const next:ProviderCredential={...credential,accessToken:result.access_token,refreshToken:result.refresh_token as string|undefined ?? credential.refreshToken,
      accessTokenExpiresAt:new Date(Date.now()+result.expires_in*1000).toISOString(),grantedScopes:nextScopes,
      ...(typeof result.refresh_token_expires_in==='number'?{refreshTokenExpiresAt:new Date(Date.now()+result.refresh_token_expires_in*1000).toISOString()}: {})};
    const ciphertext=await encryptCredential(next,binding,env.TOKEN_ENCRYPTION_KEY!);
    await readGrant(env,actor,grantId,provider);
    const saved=await env.AGENT_DB.prepare(`UPDATE auth_provider_grants SET ciphertext=?,granted_scopes=?,updated_at=?
      WHERE id=? AND tenant_scope=? AND status='authorized' AND ciphertext=?
      AND EXISTS(SELECT 1 FROM agent_credential_refreshes WHERE grant_id=? AND lease_token=?)`)
      .bind(ciphertext,JSON.stringify(nextScopes),new Date().toISOString(),grantId,actor.tenantId,row.ciphertext,grantId,lease).run();
    if(saved.meta.changes!==1)throw failure('credential_changed','Account authorization changed during renewal. Refresh the connection.');
    await env.AGENT_DB.prepare('DELETE FROM agent_credential_refreshes WHERE grant_id=? AND lease_token=?').bind(grantId,lease).run();
    const final=await readGrant(env,actor,grantId,provider);
    if(final.ciphertext!==ciphertext)throw failure('credential_changed','Account authorization changed after renewal.');
    permitted(nextScopes,operation);
    return {accessToken:next.accessToken,accountEmail:next.accountEmail,grantedScopes:nextScopes};
  } catch(error) {
    if(dispatched) {
      await env.AGENT_DB.prepare("UPDATE agent_credential_refreshes SET status='uncertain' WHERE grant_id=? AND lease_token=?").bind(grantId,lease).run();
      await env.AGENT_DB.prepare("UPDATE auth_provider_grants SET status='reconnect_required',updated_at=? WHERE id=? AND tenant_scope=? AND status='authorized' AND ciphertext=?")
        .bind(new Date().toISOString(),grantId,actor.tenantId,row.ciphertext).run();
    }
    else await env.AGENT_DB.prepare('DELETE FROM agent_credential_refreshes WHERE grant_id=? AND lease_token=?').bind(grantId,lease).run();
    if(error instanceof HttpError)throw error;
    throw failure('refresh_uncertain','Account renewal was interrupted. Reconnect before retrying.',503);
  }
}
