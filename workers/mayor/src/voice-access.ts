import {sessionExpiryMillisSql} from './session-expiry';
import type {Actor,Env} from './env';
import {CHAT_ROLES} from './permissions';
import {HttpError} from './http';
export type VoiceIdentity=Actor & {sessionId:string};
/** One fresh DB read per check; never trust a cached WebSocket login. */
export async function requireVoiceAccess(env:Pick<Env,'AGENT_DB'>,identity:VoiceIdentity){
 const now=Date.now();
 const allowed=await env.AGENT_DB.prepare(`SELECT s.id FROM auth_session s
 JOIN agent_memberships m ON m.user_id=s.userId AND m.tenant_id=? AND m.status='active'
 JOIN agent_tenants t ON t.id=m.tenant_id AND t.status='active'
 WHERE s.id=? AND s.userId=? AND ${sessionExpiryMillisSql}>?
 AND (m.expires_at IS NULL OR m.expires_at>?) AND m.role IN (${CHAT_ROLES.map(()=>'?').join(',')})`)
 .bind(identity.tenantId,identity.sessionId,identity.userId,now,new Date(now).toISOString(),...CHAT_ROLES).first();
 if(!allowed)throw new HttpError(401,'voice_access_expired','Your conversation access has ended. Sign in again or contact the workspace owner.');
 return identity;
}

/** Bounded background check for idle calls. No overlapping checks or retry loops. */
export function watchVoiceAccess(check:()=>Promise<unknown>,revoke:(error:unknown)=>void,intervalMs=15000){
 let stopped=false,running=false;
 const stop=()=>{stopped=true;clearInterval(timer);};
 const timer=setInterval(()=>{
  if(stopped||running)return;
  running=true;
  let deadline:ReturnType<typeof setTimeout>;
  const timeout=new Promise<never>((_,reject)=>{deadline=setTimeout(()=>reject(new Error('Access check timed out.')),5000);});
  void Promise.race([Promise.resolve().then(check),timeout]).catch(error=>{if(!stopped){stop();revoke(error);}}).finally(()=>{clearTimeout(deadline);running=false;});
 },intervalMs);
 return stop;
}

/** A transport/storage outage must not be reported as revoked account access. */
export function voiceCloseReason(error:unknown){
 const denied=error instanceof HttpError&&[401,403,404].includes(error.status)||error instanceof Error&&error.message==='conversation_identity_mismatch';
 return denied?{code:1008,reason:'Conversation access ended'}:{code:1011,reason:'Voice is temporarily unavailable. Try again.'};
}
