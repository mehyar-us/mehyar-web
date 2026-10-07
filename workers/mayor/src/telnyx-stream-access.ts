import {z} from 'zod';
import type {Env} from './env';
import {HttpError} from './http';
import type {TelnyxMediaBinding} from './telnyx-media';

/** Rechecked throughout a stream, not merely at WebSocket upgrade. No caller
 * identity is inferred from these provider-authenticated routing numbers. */
export async function requireTelnyxStreamAccess(env:Env,admissionId:string):Promise<TelnyxMediaBinding>{
 const denied=()=>new HttpError(403,'stream_unavailable','Phone stream unavailable.');
 if(env.PHONE_TEST_ENABLED!=='true'||!z.uuid().safeParse(admissionId).success)throw denied();
 const row=await env.AGENT_DB.prepare(`SELECT a.call_control_id,a.call_session_id,a.calling_number,a.called_number
 FROM mayor_telnyx_admissions a
 JOIN mayor_telnyx_commands c ON c.id=a.id AND c.state IN ('dispatching','accepted')
 JOIN mayor_telnyx_stream_grants g ON g.admission_id=a.id AND g.consumed_at IS NOT NULL
 JOIN mayor_phone_connections p ON p.id=a.connection_id AND p.tenant_id=a.tenant_id
 AND p.provider='telnyx' AND p.status='authorized' AND p.revision=a.connection_revision
 AND p.selected_number=a.called_number
 WHERE a.id=? AND julianday(a.created_at)>julianday('now','-15 minutes')
 AND NOT EXISTS(SELECT 1 FROM mayor_telnyx_ended_calls e WHERE e.connection_id=a.connection_id AND e.call_control_id=a.call_control_id)
 AND EXISTS(SELECT 1 FROM agent_memberships m JOIN agent_tenants t ON t.id=m.tenant_id
 WHERE m.tenant_id=a.tenant_id AND m.user_id=p.owner_user_id AND m.status='active'
 AND m.role IN ('owner','manager') AND t.status='active' AND (m.expires_at IS NULL OR m.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')))`)
 .bind(admissionId).first<{call_control_id:string;call_session_id:string;calling_number:string;called_number:string}>();
 if(!row||!z.uuid().safeParse(row.call_session_id).success||![row.calling_number,row.called_number].every(value=>typeof value==='string'&&/^\+[1-9]\d{6,14}$/.test(value)))throw denied();
 return {callControlId:row.call_control_id,callSessionId:row.call_session_id,from:row.calling_number,to:row.called_number};
}

