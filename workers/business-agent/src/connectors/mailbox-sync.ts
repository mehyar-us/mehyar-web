import { z } from 'zod';
import type { Actor, Env } from '../env';
import { digest, HttpError } from '../http';
import { connectionAuthorizationStamp } from './credentials';
import { GOOGLE_MAIL_OPERATIONS } from './google-mail';
import { MICROSOFT_MAIL_OPERATIONS } from './microsoft-mail';
import { cursorURL, segment } from './http';
import type { Provider } from './types';

const id = z.string().min(1).max(2048).regex(/^[^\u0000-\u001f\u007f]+$/);
const pageSchema = z.object({
  changes: z.array(z.object({ messageId: id, kind: z.enum(['upsert','delete']) }).strict()).max(1000),
  nextCursor: z.string().min(1).max(16384).optional(),
  syncCursor: z.string().min(1).max(16384).optional(),
}).strict().refine(p => Boolean(p.nextCursor) !== Boolean(p.syncCursor));
type SyncPage = z.infer<typeof pageSchema>;
type Stream = { id:string; tenant_id:string; grant_id:string; provider:Provider; resource:string; authorization:string;
  checkpoint:string|null; page_cursor:string|null; round_id:string; page_number:number; state:string; lease_token:string|null; lease_until:string|null };
export type MailboxClaim = { streamId:string; token:string; checkpoint:string|null; pageCursor:string|null };
const unavailable = () => new HttpError(409,'mailbox_sync_unavailable','Mailbox synchronization must be restarted with current authorization.');

/** Internal storage boundary. Not a public RPC and not permission to send mail.
 * Provider runners must also enforce capability readiness, paid access and agent pause.
 * A checkpoint means changes were durably queued, not that automation completed.
 */
export class MailboxSync {
  constructor(private env:Env, private actor:Actor, private clock:()=>number=Date.now) {}
  private now() { return new Date(this.clock()).toISOString(); }
  private async authority(grantId:string,provider:Provider) {
    const authorization=await connectionAuthorizationStamp(this.env,this.actor,grantId,provider,
      provider==='google'?GOOGLE_MAIL_OPERATIONS.read:MICROSOFT_MAIL_OPERATIONS.read);
    const grant=await this.env.AGENT_DB.prepare('SELECT user_id,authorization_revision,granted_scopes FROM auth_provider_grants WHERE id=? AND tenant_scope=? AND provider=?')
      .bind(grantId,this.actor.tenantId,provider).first<{user_id:string;authorization_revision:number;granted_scopes:string}>();
    if(!grant||grant.user_id!==this.actor.userId)throw unavailable();
    // Read the stamp again so consent cannot change between the stamp and SQL fence.
    if(authorization!==await connectionAuthorizationStamp(this.env,this.actor,grantId,provider,
      provider==='google'?GOOGLE_MAIL_OPERATIONS.read:MICROSOFT_MAIL_OPERATIONS.read))throw unavailable();
    return {authorization,grant};
  }
  private fence = `EXISTS (SELECT 1 FROM auth_provider_grants g
    JOIN agent_tenants t ON t.id=g.tenant_scope JOIN agent_memberships m ON m.tenant_id=t.id AND m.user_id=g.user_id
    WHERE g.id=? AND g.tenant_scope=? AND g.user_id=? AND g.status='authorized'
    AND g.authorization_revision=? AND g.granted_scopes=?
    AND t.status NOT IN ('paused','offboarding','deleted') AND m.status='active' AND m.role IN ('owner','manager')
    AND (m.expires_at IS NULL OR m.expires_at>?))`;
  private args(grantId:string,grant:{authorization_revision:number;granted_scopes:string}) {
    return [grantId,this.actor.tenantId,this.actor.userId,grant.authorization_revision,grant.granted_scopes,this.now()];
  }
  private async stream(streamId:string) {
    const row=await this.env.AGENT_DB.prepare('SELECT * FROM agent_mailbox_sync WHERE id=? AND tenant_id=?')
      .bind(streamId,this.actor.tenantId).first<Stream>();
    if(!row)throw unavailable();
    const authority=await this.authority(row.grant_id,row.provider);
    if(authority.authorization!==row.authorization)throw unavailable();
    return {row,...authority};
  }
  private cursor(provider:Provider,resource:string,value:string,checkpoint:boolean) {
    if(!value||value.length>16384||/[\u0000-\u0020\u007f]/.test(value))throw unavailable();
    if(provider==='google') { if(checkpoint&&!/^\d{1,20}$/.test(value))throw unavailable(); }
    else cursorURL(value,'','https://graph.microsoft.com/v1.0/',`/v1.0/me/mailFolders/${segment(resource)}/messages/delta`);
  }
  /** Google initial history comes from a completed bootstrap; Graph starts with no delta link. */
  async open(grantId:string,provider:Provider,resource:string,initialCheckpoint?:string) {
    if(!['google','microsoft'].includes(provider)||!id.safeParse(resource).success||(provider==='google'&&resource!=='mailbox'))throw unavailable();
    if(provider==='google'&&!initialCheckpoint)throw unavailable();
    if(initialCheckpoint)this.cursor(provider,resource,initialCheckpoint,true);
    const {authorization,grant}=await this.authority(grantId,provider);
    const streamId=await digest(JSON.stringify(['mailbox-sync-v1',this.actor.tenantId,grantId,provider,resource,authorization]));
    await this.env.AGENT_DB.prepare(`INSERT INTO agent_mailbox_sync(id,tenant_id,grant_id,provider,resource,authorization,checkpoint,round_id,updated_at)
      SELECT ?,?,?,?,?,?,?,?,? WHERE ${this.fence} ON CONFLICT(id) DO NOTHING`)
      .bind(streamId,this.actor.tenantId,grantId,provider,resource,authorization,initialCheckpoint??null,crypto.randomUUID(),this.now(),...this.args(grantId,grant)).run();
    await this.stream(streamId);
    return streamId;
  }
  async claim(streamId:string):Promise<MailboxClaim|null> {
    const {row,grant}=await this.stream(streamId),token=crypto.randomUUID(),now=this.now();
    const acquired=await this.env.AGENT_DB.prepare(`UPDATE agent_mailbox_sync SET lease_token=?,lease_until=?,updated_at=?
      WHERE id=? AND tenant_id=? AND state='ready' AND page_number<500 AND (lease_until IS NULL OR lease_until<=?) AND ${this.fence}
      RETURNING checkpoint,page_cursor`)
      .bind(token,new Date(this.clock()+90000).toISOString(),now,streamId,this.actor.tenantId,now,...this.args(row.grant_id,grant)).first<{checkpoint:string|null;page_cursor:string|null}>();
    if(!acquired)return null;
    return {streamId,token,checkpoint:acquired.checkpoint,pageCursor:acquired.page_cursor};
  }
  async context(claim:MailboxClaim) {
    const {row}=await this.stream(claim.streamId);
    if(row.state!=='ready'||row.lease_token!==claim.token||!row.lease_until||row.lease_until<=this.now()
      ||row.checkpoint!==claim.checkpoint||row.page_cursor!==claim.pageCursor)throw unavailable();
    return {grantId:row.grant_id,provider:row.provider,resource:row.resource};
  }
  /** Read failures retain the same checkpoint, with durable retry delay. */
  async defer(claim:MailboxClaim,seconds:number):Promise<boolean> {
    if(!Number.isFinite(seconds)||seconds<60||seconds>86400)throw unavailable();
    const {row,grant}=await this.stream(claim.streamId);
    const result=await this.env.AGENT_DB.prepare(`UPDATE agent_mailbox_sync SET lease_token=NULL,lease_until=?,updated_at=?
      WHERE id=? AND tenant_id=? AND lease_token=? AND lease_until>? AND ${this.fence}`)
      .bind(new Date(this.clock()+Math.ceil(seconds)*1000).toISOString(),this.now(),row.id,this.actor.tenantId,claim.token,this.now(),...this.args(row.grant_id,grant)).run();
    return result.meta.changes===1;
  }
  async commit(claim:MailboxClaim,input:SyncPage):Promise<boolean> {
    const page=pageSchema.parse(input),{row,grant}=await this.stream(claim.streamId);
    this.cursor(row.provider,row.resource,(page.nextCursor??page.syncCursor)!,Boolean(page.syncCursor));
    if(row.provider==='google'&&page.syncCursor&&row.checkpoint&&BigInt(page.syncCursor)<BigInt(row.checkpoint))throw unavailable();
    const hash=await digest(JSON.stringify(page));
    const prior=await this.env.AGENT_DB.prepare('SELECT payload_hash FROM agent_mailbox_sync_pages WHERE stream_id=? AND token=?').bind(row.id,claim.token).first<{payload_hash:string}>();
    if(prior){if(prior.payload_hash!==hash)throw unavailable();return true;}
    if(row.lease_token!==claim.token||!row.lease_until||row.lease_until<=this.now())return false;
    if(claim.checkpoint!==row.checkpoint||claim.pageCursor!==row.page_cursor)throw unavailable();
    const nextHash=page.nextCursor?await digest(page.nextCursor):null;
    if(nextHash){
      const loop=await this.env.AGENT_DB.prepare('SELECT 1 FROM agent_mailbox_sync_pages WHERE stream_id=? AND round_id=? AND next_hash=?')
        .bind(row.id,row.round_id,nextHash).first();
      if(loop)throw new HttpError(409,'mailbox_cursor_loop','Mailbox continuation repeated. Review synchronization before retrying.');
    }
    const now=this.now();
    // The receipt gates both changes and checkpoint. D1 batch is one transaction;
    // a stale token inserts nothing, and any statement failure rolls back everything.
    const receipt=this.env.AGENT_DB.prepare(`INSERT INTO agent_mailbox_sync_pages(stream_id,token,payload_hash,round_id,next_hash,created_at)
      SELECT id,?,?,round_id,?,? FROM agent_mailbox_sync WHERE id=? AND tenant_id=? AND lease_token=? AND lease_until>? AND ${this.fence}
      ON CONFLICT(stream_id,token) DO NOTHING`).bind(claim.token,hash,nextHash,now,row.id,this.actor.tenantId,claim.token,now,...this.args(row.grant_id,grant));
    const changes=this.env.AGENT_DB.prepare(`INSERT OR IGNORE INTO agent_mailbox_changes(stream_id,page_token,ordinal,message_id,kind,created_at)
      SELECT ?,?,CAST(j.key AS INTEGER),json_extract(j.value,'$.messageId'),json_extract(j.value,'$.kind'),? FROM json_each(?) j
      WHERE EXISTS(SELECT 1 FROM agent_mailbox_sync_pages WHERE stream_id=? AND token=? AND payload_hash=?)`)
      .bind(row.id,claim.token,now,JSON.stringify(page.changes),row.id,claim.token,hash);
    const advance=this.env.AGENT_DB.prepare(`UPDATE agent_mailbox_sync SET checkpoint=?,page_cursor=?,round_id=?,page_number=?,state=?,lease_token=NULL,lease_until=NULL,updated_at=?
      WHERE id=? AND tenant_id=? AND lease_token=? AND EXISTS(SELECT 1 FROM agent_mailbox_sync_pages WHERE stream_id=? AND token=? AND payload_hash=?)`)
      .bind(page.syncCursor??row.checkpoint,page.nextCursor??null,page.syncCursor?crypto.randomUUID():row.round_id,page.syncCursor?0:row.page_number+1,page.nextCursor&&row.page_number>=499?'resync_required':'ready',now,row.id,this.actor.tenantId,claim.token,row.id,claim.token,hash);
    const result=await this.env.AGENT_DB.batch([receipt,changes,advance]);
    return result[2].meta.changes===1;
  }
  async requireResync(claim:MailboxClaim):Promise<boolean> {
    const {row,grant}=await this.stream(claim.streamId);
    const result=await this.env.AGENT_DB.prepare(`UPDATE agent_mailbox_sync SET state='resync_required',lease_token=NULL,lease_until=NULL,updated_at=?
      WHERE id=? AND tenant_id=? AND lease_token=? AND lease_until>? AND ${this.fence}`)
      .bind(this.now(),row.id,this.actor.tenantId,claim.token,this.now(),...this.args(row.grant_id,grant)).run();
    return result.meta.changes===1;
  }
}
