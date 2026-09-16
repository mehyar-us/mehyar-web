import type { Actor, Env } from '../env';
import { HttpError } from '../http';
import { requireTenant } from '../permissions';
import { textAccess } from '../billing/text-access';
import { requireVerifiedGates } from '../billing/service';
import { connectorCredential } from './credentials';
import { GoogleMailClient, GOOGLE_MAIL_OPERATIONS, type GmailHistory } from './google-mail';
import { MicrosoftMailClient, MICROSOFT_MAIL_OPERATIONS } from './microsoft-mail';
import { MailboxSync } from './mailbox-sync';
import { ConnectorError } from './types';

type Change = {messageId:string;kind:'upsert'|'delete'};
function gmailChanges(records:GmailHistory[]):Change[] {
  const changes=new Map<string,Change>();
  for(const record of records) {
    for(const message of record.messages??[])changes.set(message.id,{messageId:message.id,kind:'upsert'});
    for(const item of [...record.messagesAdded??[],...record.labelsAdded??[],...record.labelsRemoved??[]])
      changes.set(item.message.id,{messageId:item.message.id,kind:'upsert'});
    for(const item of record.messagesDeleted??[])changes.set(item.message.id,{messageId:item.message.id,kind:'delete'});
  }
  return [...changes.values()];
}

/** One provider page per invocation; no autonomous sender or public endpoint.
 * The owning Agent must supply its live pause guard. Returned values contain no
 * provider cursors, tokens, message bodies or sender/recipient addresses.
 */
export async function runMailboxPage(env:Env,actor:Actor,streamId:string,
  agentGuard:()=>Promise<void>,transport:typeof fetch=fetch) {
  const access=async()=>{
    if(env.MAILBOX_SYNC_ENABLED!=='true')throw new HttpError(503,'mailbox_sync_disabled','Mailbox monitoring is not enabled.');
    await agentGuard();
    const tenant=await requireTenant(env,actor);
    if(tenant.plan_id==='trial')throw new HttpError(403,'paid_execution_required','An activated subscription is required for mailbox monitoring.');
    await textAccess(env,actor,tenant);
  };
  await access();
  const ledger=new MailboxSync(env,actor),claim=await ledger.claim(streamId);
  if(!claim)return {state:'not_claimed' as const};
  const context=await ledger.context(claim);
  const guard=async()=>{
    await access();
    await ledger.context(claim);
    const capabilities=(context.provider==='google'?env.GOOGLE_ENABLED_CAPABILITIES:env.MICROSOFT_ENABLED_CAPABILITIES)?.split(',').map(s=>s.trim())??[];
    if(!capabilities.includes(context.provider==='google'?'gmail_read':'mail_read'))throw new HttpError(503,'mailbox_not_ready','Mailbox monitoring is awaiting provider approval.');
    await requireVerifiedGates(env,`connector:${context.provider}.mail.read`,['provider_approval','live_acceptance']);
  };
  try {
    await guard();
    const operation=context.provider==='google'?GOOGLE_MAIL_OPERATIONS.read:MICROSOFT_MAIL_OPERATIONS.read;
    // Refresh requests also pass the live guard; renewed consent invalidates the stream.
    const controlled:typeof fetch=async(input,init)=>{await guard();return transport(input,init);};
    const auth=await connectorCredential(env,actor,context.grantId,context.provider,operation,controlled);
    await guard();
    let changes:Change[],nextCursor:string|undefined,syncCursor:string|undefined;
    if(context.provider==='google') {
      if(!claim.checkpoint)throw new HttpError(409,'mailbox_bootstrap_required','Complete mailbox initialization first.');
      const page=await new GoogleMailClient(auth,{fetch:controlled}).listHistory(claim.checkpoint,claim.pageCursor??undefined);
      changes=gmailChanges(page.items);nextCursor=page.nextCursor;syncCursor=page.syncCursor;
    } else {
      const page=await new MicrosoftMailClient(auth,{fetch:controlled}).listChanges(context.resource,claim.pageCursor??claim.checkpoint??undefined);
      changes=page.items.map(item=>({messageId:item.id,kind:item['@removed']?'delete':'upsert'}));
      nextCursor=page.nextCursor;syncCursor=page.syncCursor;
    }
    await guard();
    if(changes.length>1000) {
      await ledger.requireResync(claim);
      return {state:'resync_required' as const};
    }
    const saved=await ledger.commit(claim,{changes,nextCursor,syncCursor});
    return {state:saved?'saved' as const:'stale' as const,...(saved?{changes:changes.length,hasMore:Boolean(nextCursor)}:{})};
  } catch(error) {
    if(error instanceof ConnectorError&&['cursor_invalid','invalid_response'].includes(error.kind)
      ||error instanceof HttpError&&error.code==='mailbox_cursor_loop') {
      await guard();
      return {state:await ledger.requireResync(claim)?'resync_required' as const:'stale' as const};
    }
    // No immediate provider retry. Retry-After is persisted; excessive delays
    // require review instead of resuming sooner than the provider allows.
    if(error instanceof ConnectorError&&['rate_limited','retryable_read'].includes(error.kind)) {
      await guard();
      const delay=Math.max(300,error.retryAfterSeconds??0);
      if(delay>86400||context.attempts>=12)return {state:await ledger.requireResync(claim)?'resync_required' as const:'stale' as const};
      return {state:await ledger.defer(claim,delay)?'deferred' as const:'stale' as const};
    }
    throw error;
  }
}
