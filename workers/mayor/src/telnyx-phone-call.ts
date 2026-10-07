import type {Env} from './env';
import {requireTelnyxStreamAccess} from './telnyx-stream-access';
import {requirePhoneCall} from './phone-call-access';

/** Internal: called after consuming stream access, before opening MayorPhone.
 * Does not create a verification receipt. Unverified callers can only converse
 * or request a confirmed callback, never read or change appointments. */
export async function activateTelnyxPhoneCall(env:Env,id:string){
 await requireTelnyxStreamAccess(env,id);
 await env.AGENT_DB.prepare(`INSERT OR IGNORE INTO mayor_phone_calls
 (id,tenant_id,account_id,call_sid,connection_revision,state,stream_expires_at,expires_at,created_at,caller_number,provider)
 SELECT a.id,a.tenant_id,'telnyx:'||a.connection_id,a.call_control_id,a.connection_revision,'streaming',
 strftime('%Y-%m-%dT%H:%M:%fZ',a.created_at,'+90 seconds'),strftime('%Y-%m-%dT%H:%M:%fZ',a.created_at,'+15 minutes'),a.created_at,a.calling_number,'telnyx'
 FROM mayor_telnyx_admissions a JOIN mayor_telnyx_commands c ON c.id=a.id AND c.state IN ('dispatching','accepted')
 JOIN mayor_telnyx_stream_grants g ON g.admission_id=a.id AND g.consumed_at IS NOT NULL
 WHERE a.id=? AND NOT EXISTS(SELECT 1 FROM mayor_telnyx_ended_calls e WHERE e.connection_id=a.connection_id AND e.call_control_id=a.call_control_id)`)
 .bind(id).run();
 return requirePhoneCall(env,id);
}
