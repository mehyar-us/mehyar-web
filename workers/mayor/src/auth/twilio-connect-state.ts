import {z} from 'zod';
import type {Env} from '../env';
import {digest,HttpError,requireOrigin} from '../http';
import {phoneWriteAccess} from '../phone-write-access';

type Session={user:{id:string};session:{id:string}}|null;
const appSchema=z.string().regex(/^CN[0-9a-f]{32}$/);
const accountSchema=z.string().regex(/^AC[0-9a-f]{32}$/);
const fail=()=>new HttpError(409,'phone_authorization_expired','This connection attempt expired or changed. Start again from The Mayor.');
type Attempt={tenant_id:string;user_id:string;app_sid:string;connection_revision:number;expires_at:number};

/** Internal prerequisite. No public route until provider account ownership can
 * be established independently of the browser's AccountSid parameter. */
export async function startTwilioConnect(request:Request,env:Env,session:Session,tenantId:string,appSid:string){
 requireOrigin(request,env.APP_ORIGIN);
 if(request.method!=='POST')throw new HttpError(405,'method_not_allowed','Use POST.');
 if(!session)throw new HttpError(401,'authentication_required','Sign in to connect Twilio.');
 appSchema.parse(appSid);z.string().min(1).max(128).parse(tenantId);
 const state=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
 const revision=await env.AGENT_DB.prepare("SELECT revision FROM mayor_phone_connections WHERE tenant_id=? AND provider='twilio'").bind(tenantId).first<{revision:number}>();
 await env.AGENT_DB.prepare('DELETE FROM mayor_twilio_connect_attempts WHERE expires_at<=unixepoch()*1000').run();
 const result=await env.AGENT_DB.prepare(`INSERT INTO mayor_twilio_connect_attempts(state_hash,tenant_id,user_id,session_hash,app_sid,connection_revision,expires_at)
 SELECT ?,?,?,?,?,?,unixepoch()*1000+600000 WHERE ${phoneWriteAccess}
 AND (SELECT count(*) FROM mayor_twilio_connect_attempts WHERE user_id=?)<5
 AND COALESCE((SELECT revision FROM mayor_phone_connections WHERE tenant_id=? AND provider='twilio'),0)=?`)
 .bind(await digest(state),tenantId,session.user.id,await digest(session.session.id),appSid,revision?.revision??0,tenantId,session.user.id,session.user.id,tenantId,revision?.revision??0).run();
 if(result.meta.changes!==1)throw fail();
 return {state};
}

/** Consume once, including denial. The returned account is an UNVERIFIED claim.
 * A valid state proves only which signed-in user started this flow, not that
 * they own the supplied Twilio account. Never store a connection from this alone. */
export async function consumeTwilioConnect(request:Request,env:Env,session:Session,appSid:string){
 if(!session||request.method!=='GET')throw fail();
 appSchema.parse(appSid);
 const params=new URL(request.url).searchParams,state=params.get('state');
 if(params.getAll('state').length!==1||!state||! /^[a-f0-9]{64}$/.test(state))throw fail();
 const row=await env.AGENT_DB.prepare('DELETE FROM mayor_twilio_connect_attempts WHERE state_hash=? AND user_id=? AND session_hash=? RETURNING *')
 .bind(await digest(state),session.user.id,await digest(session.session.id)).first<Attempt>();
 if(!row||row.app_sid!==appSid||params.has('error')||params.getAll('AccountSid').length!==1)throw fail();
 const account=accountSchema.safeParse(params.get('AccountSid'));if(!account.success)throw fail();
 const access=await env.AGENT_DB.prepare(`SELECT 1 WHERE ${phoneWriteAccess} AND ?>unixepoch()*1000
 AND COALESCE((SELECT revision FROM mayor_phone_connections WHERE tenant_id=? AND provider='twilio'),0)=?`)
 .bind(row.tenant_id,row.user_id,row.expires_at,row.tenant_id,row.connection_revision).first();
 if(!access)throw fail();
 return {status:'unverified' as const,actor:{tenantId:row.tenant_id,userId:row.user_id},claimedAccountSid:account.data,connectionRevision:row.connection_revision};
}
