import {z} from 'zod';
import type {Env} from './env';
import {digest,HttpError} from './http';
import {phoneWriteAccess} from './phone-write-access';
import {telnyxWebhookConnection} from './telnyx-connections';
import {freshTelnyxAdmission} from './telnyx-call-window';

const unavailable=()=>new HttpError(403,'stream_unavailable','Phone stream unavailable.');
type Admission={id:string;tenant_id:string;connection_id:string;connection_revision:number;call_control_id:string};
async function admission(env:Env,id:string){
 if(env.PHONE_TEST_ENABLED!=='true'||!z.uuid().safeParse(id).success)throw unavailable();
 const row=await env.AGENT_DB.prepare('SELECT id,tenant_id,connection_id,connection_revision,call_control_id FROM mayor_telnyx_admissions WHERE id=?').bind(id).first<Admission>();
 if(!row)throw unavailable();
 const connection=await telnyxWebhookConnection(env,row.tenant_id);
 if(connection.row.id!==row.connection_id||connection.row.revision!==row.connection_revision)throw unavailable();
 return {row,owner:connection.row.owner_user_id};
}
/** Internal-only: issue once after signed call admission, before answering.
 * The raw token must appear only in the provider's stream URL, never logs/UI.
 * If issuance is interrupted, do not mint another token for the same call. */
export async function issueTelnyxStreamGrant(env:Env,admissionId:string){
 const {row,owner}=await admission(env,admissionId);
 const token=Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
 const written=await env.AGENT_DB.prepare(`INSERT OR IGNORE INTO mayor_telnyx_stream_grants(admission_id,token_hash,expires_at)
 SELECT ?,?,unixepoch()*1000+90000 WHERE ${phoneWriteAccess}
 AND EXISTS(SELECT 1 FROM mayor_phone_connections WHERE id=? AND revision=? AND status='authorized')
 AND EXISTS(SELECT 1 FROM mayor_telnyx_commands c JOIN mayor_telnyx_admissions a ON a.id=c.id WHERE c.id=? AND c.state='queued' AND ${freshTelnyxAdmission})`)
 .bind(row.id,await digest(token),row.tenant_id,owner,row.connection_id,row.connection_revision,row.id).run();
 if(written.meta.changes!==1)throw unavailable();
 return {token,admissionId:row.id};
}
/** Consumes before upgrading a socket. Dispatching allows the provider socket
 * to arrive before its answer HTTP response. Uncertain commands cannot connect.
 * Caller must still bind the start frame and maintain call/customer authority. */
export async function consumeTelnyxStreamGrant(env:Env,admissionId:string,token:string){
 if(!/^[a-f0-9]{64}$/.test(token))throw unavailable();
 const {row,owner}=await admission(env,admissionId);
 const consumed=await env.AGENT_DB.prepare(`UPDATE mayor_telnyx_stream_grants SET consumed_at=unixepoch()*1000
 WHERE admission_id=? AND token_hash=? AND consumed_at IS NULL AND expires_at>unixepoch()*1000
 AND ${phoneWriteAccess}
 AND EXISTS(SELECT 1 FROM mayor_phone_connections WHERE id=? AND revision=? AND status='authorized')
 AND EXISTS(SELECT 1 FROM mayor_telnyx_commands WHERE id=? AND state IN ('dispatching','accepted')) RETURNING admission_id`)
 .bind(row.id,await digest(token),row.tenant_id,owner,row.connection_id,row.connection_revision,row.id).first();
 if(!consumed)throw unavailable();
 return {admissionId:row.id,tenantId:row.tenant_id,connectionRevision:row.connection_revision,callControlId:row.call_control_id};
}
