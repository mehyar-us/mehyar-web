import {z} from 'zod';
import type {Actor,Env} from '../env';
import {HttpError} from '../http';
import {OPERATORS,requireMembership} from '../permissions';
import {connectionAuthorizationStamp} from './credentials';
import {GOOGLE_MAIL_OPERATIONS} from './google-mail';
import {MICROSOFT_MAIL_OPERATIONS} from './microsoft-mail';
import {MailboxSync} from './mailbox-sync';

const position=z.tuple([z.string().min(1).max(2048),z.string().min(1).max(2048)]);
function decode(value?:string):[string,string]{
  if(value===undefined)return ['',''];
  try{
    if(value.length>8192||!/^[A-Za-z0-9_-]+$/.test(value))throw new Error();
    return position.parse(JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:false}).decode(Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0)))));
  }catch{throw new HttpError(400,'invalid_mailbox_review_cursor','Refresh messages awaiting review.');}
}
const encode=(streamId:string,messageId:string)=>btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify([streamId,messageId])))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');

/** Authorized cached excerpts only. Cursor positions are not access credentials. */
export async function mailboxReviewDirectory(env:Env,actor:Actor,grantId:string,agentGuard:()=>Promise<void>,after?:string){
  if(!z.string().uuid().safeParse(grantId).success)throw new HttpError(400,'invalid_mailbox_review_grant','Select a connected mailbox.');
  const [streamId,messageId]=decode(after);
  const guard=async()=>{
    await agentGuard();await requireMembership(env,actor,OPERATORS);
    const grant=await env.AGENT_DB.prepare("SELECT provider FROM auth_provider_grants WHERE id=? AND tenant_scope=? AND user_id=? AND status='authorized' AND mailbox_paused=0")
      .bind(grantId,actor.tenantId,actor.userId).first<{provider:'google'|'microsoft'}>();
    if(!grant)throw new HttpError(403,'triage_access_unavailable','This mailbox is unavailable.');
    return connectionAuthorizationStamp(env,actor,grantId,grant.provider,grant.provider==='google'?GOOGLE_MAIL_OPERATIONS.read:MICROSOFT_MAIL_OPERATIONS.read);
  };
  const authorization=await guard();
  const rows=(await env.AGENT_DB.prepare(`SELECT q.stream_id,q.message_id,q.receipt_token FROM agent_mailbox_triage_queue q
    JOIN agent_mailbox_sync s ON s.id=q.stream_id
    JOIN agent_mailbox_messages m ON m.stream_id=q.stream_id AND m.message_id=q.message_id AND m.receipt_token=q.receipt_token
    WHERE s.tenant_id=? AND s.grant_id=? AND s.authorization=? AND s.state='ready'
      AND q.state='review_required' AND q.last_reason='long_message' AND m.state='present' AND m.needs_reconciliation=0
      AND m.text_json IS NOT NULL AND (q.stream_id>? OR (q.stream_id=? AND q.message_id>?))
    ORDER BY q.stream_id,q.message_id LIMIT 11`).bind(actor.tenantId,grantId,authorization,streamId,streamId,messageId)
    .all<{stream_id:string;message_id:string;receipt_token:string}>()).results;
  const ledger=new MailboxSync(env,actor),items=[];let withheld=0;
  for(const row of rows.slice(0,10)){
    try{
      const observed=await ledger.readText(row.stream_id,row.message_id,row.receipt_token);
      items.push({source:{streamId:row.stream_id,messageId:row.message_id,receipt:row.receipt_token},
        excerpt:Array.from(observed.projection.text).slice(0,160).join(''),observedAt:observed.observedAt,
        historicalContext:observed.sourceMode!=='incremental',extractionOmissions:observed.projection.omissions});
    }catch(error){if(!(error instanceof HttpError)||![403,409].includes(error.status))throw error;withheld++;}
  }
  // Revalidate earlier page entries after the remaining asynchronous reads.
  for(let i=items.length-1;i>=0;i--){
    const source=items[i].source;
    try{await ledger.readText(source.streamId,source.messageId,source.receipt);}
    catch(error){if(!(error instanceof HttpError)||![403,409].includes(error.status))throw error;items.splice(i,1);withheld++;}
  }
  if(await guard()!==authorization)throw new HttpError(409,'triage_access_changed','Mailbox access changed. Refresh messages.');
  return {items,withheld,nextCursor:rows.length>10?encode(rows[9].stream_id,rows[9].message_id):undefined,
    extendedAnalysisEnabled:env.MAILBOX_EXTENDED_TRIAGE_ENABLED==='true'&&env.MAILBOX_TRIAGE_ENABLED==='true'&&env.MAILBOX_PROCESSING_ENABLED==='true'&&env.MAILBOX_SYNC_ENABLED==='true'&&env.AI_ENABLED==='true'};
}
