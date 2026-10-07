import {z} from 'zod';
import type {Env,Actor} from '../env';
import {digest,HttpError,requireOrigin} from '../http';
import {phoneWriteAccess} from '../phone-write-access';
import {sealPhoneCredential,unsealPhoneCredential} from '../phone-connections';
import {telnyxAuthorizeUrl,type TelnyxOAuthConfig} from './telnyx-protocol';

// The route must obtain this from the server's authenticated session, never JSON.
type Session={user:{id:string};session:{id:string}}|null;
type Saved={state_hash:string;tenant_id:string;user_id:string;session_hash:string;config_hash:string;connection_revision:number;ciphertext:string;expires_at:number};
const unavailable=()=>new HttpError(409,'phone_authorization_expired','This connection attempt expired or changed. Start again from The Mayor.');
const random=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),n=>n.toString(16).padStart(2,'0')).join('');
const fingerprint=(config:TelnyxOAuthConfig)=>digest(JSON.stringify([config.clientId,config.redirectUri,[...new Set(config.scopes)].sort()]));
const binding=(row:Pick<Saved,'state_hash'|'session_hash'|'config_hash'|'connection_revision'>)=>digest(JSON.stringify([row.state_hash,row.session_hash,row.config_hash,row.connection_revision]));

/** Creates an encrypted, ten-minute, session/tenant-bound PKCE attempt. */
export async function startTelnyxConsent(request:Request,env:Env,session:Session,tenantId:string,config:TelnyxOAuthConfig){
 requireOrigin(request,env.APP_ORIGIN);
 if(!session)throw new HttpError(401,'authentication_required','Sign in to connect your phone provider.');
 z.string().min(1).max(128).parse(tenantId);
 const actor:Actor={tenantId,userId:session.user.id};
 const state=random(),verifier=random();
 // Validate configuration before inserting state. The secret never enters the URL.
 const url=await telnyxAuthorizeUrl(config,state,verifier);
 const state_hash=await digest(state),session_hash=await digest(session.session.id),config_hash=await fingerprint(config);
 const previous=await env.AGENT_DB.prepare("SELECT revision FROM mayor_phone_connections WHERE tenant_id=? AND provider='telnyx'").bind(tenantId).first<{revision:number}>();
 const connection_revision=previous?.revision??0;
 const ciphertext=await sealPhoneCredential(env,actor,'telnyx-oauth-state',await binding({state_hash,session_hash,config_hash,connection_revision}),{verifier});
 await env.AGENT_DB.prepare("DELETE FROM mayor_phone_oauth_states WHERE expires_at<=unixepoch()*1000").run();
 const inserted=await env.AGENT_DB.prepare(`INSERT INTO mayor_phone_oauth_states(state_hash,provider,tenant_id,user_id,session_hash,config_hash,connection_revision,ciphertext,expires_at)
  SELECT ?,'telnyx',?,?,?,?,?,?,unixepoch()*1000+600000 WHERE ${phoneWriteAccess}
  AND (SELECT count(*) FROM mayor_phone_oauth_states WHERE user_id=?)<5
  AND COALESCE((SELECT revision FROM mayor_phone_connections WHERE tenant_id=? AND provider='telnyx'),0)=?`)
  .bind(state_hash,tenantId,actor.userId,session_hash,config_hash,connection_revision,ciphertext,tenantId,actor.userId,actor.userId,tenantId,connection_revision).run();
 if(inserted.meta.changes!==1)throw unavailable();
 return {url};
}

/** Atomic consumption precedes provider exchange. A failed exchange needs new consent. */
export async function consumeTelnyxConsent(request:Request,env:Env,session:Session,config:TelnyxOAuthConfig){
 if(!session)throw unavailable();
 const params=new URL(request.url).searchParams;
 if(params.getAll('state').length!==1||! /^[a-f0-9]{64}$/.test(params.get('state')??''))throw unavailable();
 const row=await env.AGENT_DB.prepare("DELETE FROM mayor_phone_oauth_states WHERE state_hash=? AND provider='telnyx' AND user_id=? AND session_hash=? RETURNING *")
  .bind(await digest(params.get('state')!),session.user.id,await digest(session.session.id)).first<Saved>();
 if(!row||params.has('error')||params.getAll('code').length!==1||row.config_hash!==await fingerprint(config))throw unavailable();
 const code=params.get('code');if(!code||code.length>16384||! /^[\x21-\x7e]+$/.test(code))throw unavailable();
 const allowed=await env.AGENT_DB.prepare(`SELECT 1 AS allowed WHERE ${phoneWriteAccess} AND ?>unixepoch()*1000
  AND COALESCE((SELECT revision FROM mayor_phone_connections WHERE tenant_id=? AND provider='telnyx'),0)=?`)
  .bind(row.tenant_id,row.user_id,row.expires_at,row.tenant_id,row.connection_revision).first();
 if(!allowed)throw unavailable();
 try{
  const value=z.object({verifier:z.string().regex(/^[a-f0-9]{64}$/)}).strict().parse(await unsealPhoneCredential(env,{tenant_id:row.tenant_id,owner_user_id:row.user_id,account_id:await binding(row),ciphertext:row.ciphertext},'telnyx-oauth-state'));
  return {actor:{tenantId:row.tenant_id,userId:row.user_id},code,verifier:value.verifier,connectionRevision:row.connection_revision};
 }catch{throw unavailable();}
}
