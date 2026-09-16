import { z } from 'zod';
import type { Actor, Env } from '../env';
import { digest, HttpError } from '../http';
import { connectionAuthorizationStamp } from './credentials';
import { GOOGLE_MAIL_OPERATIONS } from './google-mail';
import { MICROSOFT_MAIL_OPERATIONS } from './microsoft-mail';
import { cursorURL, segment } from './http';
import type { Provider } from './types';
import {mailSnapshot,type MailSnapshot} from './mail-snapshot';

const id = z.string().min(1).max(2048).regex(/^[^\u0000-\u001f\u007f]+$/);
const pageSchema = z.object({
  changes: z.array(z.object({ messageId: id, kind: z.enum(['upsert','delete']) }).strict()).max(1000),
  nextCursor: z.string().min(1).max(16384).optional(),
  syncCursor: z.string().min(1).max(16384).optional(),
}).strict().refine(p => Boolean(p.nextCursor) !== Boolean(p.syncCursor));
type SyncPage = z.infer<typeof pageSchema>;
type Stream = { id:string; tenant_id:string; grant_id:string; provider:Provider; resource:string; authorization:string;
  checkpoint:string|null; page_cursor:string|null; round_id:string; page_number:number; state:string; lease_token:string|null; lease_until:string|null; consecutive_attempts:number; sync_mode:'bootstrap'|'incremental' };
export type MailboxClaim = { streamId:string; token:string; checkpoint:string|null; pageCursor:string|null };
export type MailboxChangeClaim = {streamId:string;token:string};
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
    const grant=await this.env.AGENT_DB.prepare('SELECT user_id,authorization_revision,granted_scopes,mailbox_paused FROM auth_provider_grants WHERE id=? AND tenant_scope=? AND provider=?')
      .bind(grantId,this.actor.tenantId,provider).first<{user_id:string;authorization_revision:number;granted_scopes:string;mailbox_paused:number}>();
    if(!grant||grant.user_id!==this.actor.userId||grant.mailbox_paused)throw unavailable();
    // Read the stamp again so consent cannot change between the stamp and SQL fence.
    if(authorization!==await connectionAuthorizationStamp(this.env,this.actor,grantId,provider,
      provider==='google'?GOOGLE_MAIL_OPERATIONS.read:MICROSOFT_MAIL_OPERATIONS.read))throw unavailable();
    return {authorization,grant};
  }
  private fence = `EXISTS (SELECT 1 FROM auth_provider_grants g
    JOIN agent_tenants t ON t.id=g.tenant_scope JOIN agent_memberships m ON m.tenant_id=t.id AND m.user_id=g.user_id
    WHERE g.id=? AND g.tenant_scope=? AND g.user_id=? AND g.status='authorized' AND g.mailbox_paused=0
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
  /** Look up existing progress without changing its baseline or recovery state. */
  async existing(grantId:string,provider:Provider,resource:string):Promise<string|null> {
    const {authorization}=await this.authority(grantId,provider);
    const streamId=await digest(JSON.stringify(['mailbox-sync-v1',this.actor.tenantId,grantId,provider,resource,authorization]));
    const row=await this.env.AGENT_DB.prepare('SELECT id FROM agent_mailbox_sync WHERE id=? AND tenant_id=?').bind(streamId,this.actor.tenantId).first<{id:string}>();
    if(row)await this.stream(streamId);
    return row?.id??null;
  }
  /** Without bootstrapAuthorization, Google history must come from an already
   * completed bootstrap; Graph can start enumeration with no delta link. */
  async open(grantId:string,provider:Provider,resource:string,initialCheckpoint?:string,bootstrapAuthorization?:string) {
    if(!['google','microsoft'].includes(provider)||!id.safeParse(resource).success||(provider==='google'&&resource!=='mailbox'))throw unavailable();
    if(provider==='google'&&!initialCheckpoint)throw unavailable();
    if(initialCheckpoint)this.cursor(provider,resource,initialCheckpoint,true);
    const {authorization,grant}=await this.authority(grantId,provider);
    if(bootstrapAuthorization&&(provider!=='google'||bootstrapAuthorization!==authorization))throw unavailable();
    const streamId=await digest(JSON.stringify(['mailbox-sync-v1',this.actor.tenantId,grantId,provider,resource,authorization]));
    await this.env.AGENT_DB.prepare(`INSERT INTO agent_mailbox_sync(id,tenant_id,grant_id,provider,resource,authorization,checkpoint,round_id,updated_at,sync_mode)
      SELECT ?,?,?,?,?,?,?,?,?,? WHERE ${this.fence} ON CONFLICT(id) DO NOTHING`)
      .bind(streamId,this.actor.tenantId,grantId,provider,resource,authorization,initialCheckpoint??null,crypto.randomUUID(),this.now(),bootstrapAuthorization?'bootstrap':'incremental',...this.args(grantId,grant)).run();
    await this.stream(streamId);
    return streamId;
  }
  /** Atomically add a verified Outlook selection. Exact repeats preserve all existing cursors and recovery state. */
  async openMicrosoftFolders(grantId:string,folders:{id:string;name:string}[],expectedAuthorization:string) {
    const resources=folders.map(folder=>folder.id);
    if(!resources.length||resources.length>100||new Set(resources).size!==resources.length||resources.some(resource=>!id.safeParse(resource).success)
      ||folders.some(folder=>typeof folder.name!=='string'||!folder.name||folder.name.length>2048))throw unavailable();
    const {authorization,grant}=await this.authority(grantId,'microsoft');
    if(authorization!==expectedAuthorization)throw unavailable();
    const rows=await Promise.all(folders.map(async folder=>({resource:folder.id,name:folder.name,
      id:await digest(JSON.stringify(['mailbox-sync-v1',this.actor.tenantId,grantId,'microsoft',folder.id,authorization])),round:crypto.randomUUID()})));
    await this.env.AGENT_DB.prepare(`INSERT INTO agent_mailbox_sync(id,tenant_id,grant_id,provider,resource,authorization,checkpoint,round_id,updated_at,sync_mode,display_name)
      SELECT json_extract(value,'$.id'),?,?,'microsoft',json_extract(value,'$.resource'),?,NULL,json_extract(value,'$.round'),?,'incremental',json_extract(value,'$.name')
      FROM json_each(?) WHERE ${this.fence} ON CONFLICT(id) DO UPDATE SET display_name=excluded.display_name`)
      .bind(this.actor.tenantId,grantId,authorization,this.now(),JSON.stringify(rows),...this.args(grantId,grant)).run();
    for(const row of rows)await this.stream(row.id);
    return {configuredFolders:rows.length};
  }
  /** Internal recovery primitive. The service must verify readiness and, for
   * Gmail, capture a fresh profile baseline before calling with a stable key.
   * Cached messages remain unverified until individually observed again. */
  async recoveryContext(streamId:string,requestKey:string,expectedRound:string) {
    if(!z.string().uuid().safeParse(requestKey).success||!z.string().uuid().safeParse(expectedRound).success)throw unavailable();
    const {row}=await this.stream(streamId);
    const prior=await this.env.AGENT_DB.prepare('SELECT expected_round FROM agent_mailbox_resync_receipts WHERE stream_id=? AND request_key=?')
      .bind(streamId,requestKey).first<{expected_round:string|null}>();
    if(prior&&prior.expected_round!==expectedRound)throw unavailable();
    if(!prior) {
      const consumer=await this.env.AGENT_DB.prepare('SELECT state FROM agent_mailbox_consumers WHERE stream_id=?').bind(streamId).first<{state:string}>();
      if(row.round_id!==expectedRound||(row.state!=='resync_required'&&consumer?.state!=='review_required'))throw unavailable();
    }
    return {grantId:row.grant_id,provider:row.provider,authorization:row.authorization,alreadyRestarted:!!prior};
  }
  async recoveryCandidate(grantId:string,provider:Provider) {
    const {authorization}=await this.authority(grantId,provider);
    const candidate=await this.env.AGENT_DB.prepare(`SELECT s.id,s.round_id,s.display_name,COUNT(*) OVER() AS affectedStreams,
      (SELECT COUNT(*) FROM agent_mailbox_changes c WHERE c.stream_id=s.id AND c.state='pending') AS pending,
      (SELECT COUNT(*) FROM agent_mailbox_messages m WHERE m.stream_id=s.id) AS cached
      FROM agent_mailbox_sync s LEFT JOIN agent_mailbox_consumers w ON w.stream_id=s.id
      WHERE s.tenant_id=? AND s.grant_id=? AND s.provider=? AND s.authorization=?
        AND (s.state='resync_required' OR w.state='review_required') ORDER BY s.updated_at,s.id LIMIT 1`)
      .bind(this.actor.tenantId,grantId,provider,authorization).first<{id:string;round_id:string;display_name:string|null;affectedStreams:number;pending:number;cached:number}>();
    if((await this.authority(grantId,provider)).authorization!==authorization)throw unavailable();
    return candidate;
  }
  async restart(streamId:string,requestKey:string,expectedRound:string,gmailBaseline?:string) {
    if(!z.string().uuid().safeParse(requestKey).success||!z.string().uuid().safeParse(expectedRound).success)throw unavailable();
    const {row,grant}=await this.stream(streamId),now=this.now();
    if(row.provider==='google')this.cursor('google',row.resource,gmailBaseline??'',true);
    else if(gmailBaseline!==undefined)throw unavailable();
    const payloadHash=await digest(JSON.stringify([expectedRound,gmailBaseline??null]));
    const prior=await this.env.AGENT_DB.prepare('SELECT payload_hash FROM agent_mailbox_resync_receipts WHERE stream_id=? AND request_key=?')
      .bind(streamId,requestKey).first<{payload_hash:string}>();
    if(prior){if(prior.payload_hash!==payloadHash)throw unavailable();return {state:'restarted' as const};}
    const newRound=crypto.randomUUID();
    const receipt=this.env.AGENT_DB.prepare(`INSERT INTO agent_mailbox_resync_receipts(stream_id,request_key,payload_hash,new_round,created_at,expected_round)
      SELECT ?,?,?,?,?,? FROM agent_mailbox_sync WHERE id=? AND round_id=? AND
      (state='resync_required' OR EXISTS(SELECT 1 FROM agent_mailbox_consumers WHERE stream_id=? AND state='review_required'))
      AND ${this.fence} ON CONFLICT(stream_id,request_key) DO NOTHING`)
      .bind(streamId,requestKey,payloadHash,newRound,now,expectedRound,streamId,expectedRound,streamId,...this.args(row.grant_id,grant));
    const saved=`EXISTS(SELECT 1 FROM agent_mailbox_resync_receipts WHERE stream_id=? AND request_key=? AND new_round=?)`;
    const savedArgs=[streamId,requestKey,newRound];
    const results=await this.env.AGENT_DB.batch([receipt,
      this.env.AGENT_DB.prepare(`UPDATE agent_mailbox_sync SET checkpoint=?,page_cursor=NULL,round_id=?,page_number=0,state='ready',
        lease_token=NULL,lease_until=NULL,next_poll_at=?,consecutive_attempts=0,sync_mode=?,updated_at=?,last_completed_at=NULL WHERE id=? AND ${saved}`)
        .bind(gmailBaseline??null,newRound,now,row.provider==='google'?'bootstrap':'incremental',now,streamId,...savedArgs),
      this.env.AGENT_DB.prepare(`UPDATE agent_mailbox_changes SET state='discarded' WHERE stream_id=? AND state='pending' AND ${saved}`).bind(streamId,...savedArgs),
      this.env.AGENT_DB.prepare(`UPDATE agent_mailbox_consumers SET page_token=NULL,ordinal=NULL,lease_token=NULL,lease_until=NULL,
        attempts=0,state='ready',next_attempt_at=? WHERE stream_id=? AND ${saved}`).bind(now,streamId,...savedArgs),
      this.env.AGENT_DB.prepare(`UPDATE agent_mailbox_messages SET needs_reconciliation=1 WHERE stream_id=? AND ${saved}`).bind(streamId,...savedArgs),
    ]);
    if(results[0].meta.changes!==1) {
      const replay=await this.env.AGENT_DB.prepare('SELECT payload_hash FROM agent_mailbox_resync_receipts WHERE stream_id=? AND request_key=?')
        .bind(streamId,requestKey).first<{payload_hash:string}>();
      if(replay?.payload_hash!==payloadHash)throw unavailable();
    }
    return {state:'restarted' as const};
  }
  async claim(streamId:string):Promise<MailboxClaim|null> {
    const {row,grant}=await this.stream(streamId),token=crypto.randomUUID(),now=this.now();
    // Crashes also consume attempts. A dead worker cannot cause endless provider reads.
    await this.env.AGENT_DB.prepare(`UPDATE agent_mailbox_sync SET state='resync_required',lease_token=NULL,lease_until=NULL,updated_at=?
      WHERE id=? AND tenant_id=? AND state='ready' AND consecutive_attempts>=12 AND (lease_until IS NULL OR lease_until<=?) AND ${this.fence}`)
      .bind(now,streamId,this.actor.tenantId,now,...this.args(row.grant_id,grant)).run();
    const acquired=await this.env.AGENT_DB.prepare(`UPDATE agent_mailbox_sync SET lease_token=?,lease_until=?,updated_at=?,consecutive_attempts=consecutive_attempts+1
      WHERE id=? AND tenant_id=? AND state='ready' AND page_number<500 AND consecutive_attempts<12 AND next_poll_at<=?
      AND (SELECT COUNT(*) FROM agent_mailbox_changes c JOIN agent_mailbox_sync s ON s.id=c.stream_id WHERE s.tenant_id=? AND c.state='pending')<=9000
      AND (lease_until IS NULL OR lease_until<=?) AND ${this.fence}
      RETURNING checkpoint,page_cursor`)
      .bind(token,new Date(this.clock()+90000).toISOString(),now,streamId,this.actor.tenantId,now,this.actor.tenantId,now,...this.args(row.grant_id,grant)).first<{checkpoint:string|null;page_cursor:string|null}>();
    if(!acquired)return null;
    return {streamId,token,checkpoint:acquired.checkpoint,pageCursor:acquired.page_cursor};
  }
  async context(claim:MailboxClaim) {
    const {row}=await this.stream(claim.streamId);
    if(row.state!=='ready'||row.lease_token!==claim.token||!row.lease_until||row.lease_until<=this.now()
      ||row.checkpoint!==claim.checkpoint||row.page_cursor!==claim.pageCursor)throw unavailable();
    return {grantId:row.grant_id,provider:row.provider,resource:row.resource,attempts:row.consecutive_attempts,syncMode:row.sync_mode};
  }
  /** Read failures retain the same checkpoint, with durable retry delay. */
  async defer(claim:MailboxClaim,seconds:number):Promise<boolean> {
    if(!Number.isFinite(seconds)||seconds<60||seconds>86400)throw unavailable();
    const {row,grant}=await this.stream(claim.streamId);
    const result=await this.env.AGENT_DB.prepare(`UPDATE agent_mailbox_sync SET lease_token=NULL,lease_until=NULL,next_poll_at=?,updated_at=?,
      state=CASE WHEN consecutive_attempts>=12 THEN 'resync_required' ELSE state END
      WHERE id=? AND tenant_id=? AND lease_token=? AND lease_until>? AND ${this.fence}`)
      .bind(new Date(this.clock()+Math.ceil(seconds)*1000).toISOString(),this.now(),row.id,this.actor.tenantId,claim.token,this.now(),...this.args(row.grant_id,grant)).run();
    return result.meta.changes===1;
  }
  async commit(claim:MailboxClaim,input:SyncPage):Promise<boolean> {
    const page=pageSchema.parse(input),{row,grant}=await this.stream(claim.streamId);
    this.cursor(row.provider,row.resource,(page.nextCursor??page.syncCursor)!,Boolean(page.syncCursor));
    if(row.provider==='google'&&page.syncCursor&&row.checkpoint&&BigInt(page.syncCursor)<BigInt(row.checkpoint))throw unavailable();
    if(row.sync_mode==='bootstrap'&&page.syncCursor&&page.syncCursor!==row.checkpoint)throw unavailable();
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
    const receipt=this.env.AGENT_DB.prepare(`INSERT INTO agent_mailbox_sync_pages(stream_id,token,payload_hash,round_id,next_hash,created_at,source_mode)
      SELECT id,?,?,round_id,?,?,CASE WHEN provider='microsoft' AND checkpoint IS NULL THEN 'bootstrap' ELSE sync_mode END
      FROM agent_mailbox_sync WHERE id=? AND tenant_id=? AND lease_token=? AND lease_until>? AND ${this.fence}
      AND (SELECT COUNT(*) FROM agent_mailbox_changes c JOIN agent_mailbox_sync s ON s.id=c.stream_id WHERE s.tenant_id=? AND c.state='pending')+?<=10000
      ON CONFLICT(stream_id,token) DO NOTHING`).bind(claim.token,hash,nextHash,now,row.id,this.actor.tenantId,claim.token,now,...this.args(row.grant_id,grant),this.actor.tenantId,page.changes.length);
    const changes=this.env.AGENT_DB.prepare(`INSERT OR IGNORE INTO agent_mailbox_changes(stream_id,page_token,ordinal,message_id,kind,created_at)
      SELECT ?,?,CAST(j.key AS INTEGER),json_extract(j.value,'$.messageId'),json_extract(j.value,'$.kind'),? FROM json_each(?) j
      WHERE EXISTS(SELECT 1 FROM agent_mailbox_sync_pages WHERE stream_id=? AND token=? AND payload_hash=?)`)
      .bind(row.id,claim.token,now,JSON.stringify(page.changes),row.id,claim.token,hash);
    const advance=this.env.AGENT_DB.prepare(`UPDATE agent_mailbox_sync SET checkpoint=?,page_cursor=?,round_id=?,page_number=?,state=?,lease_token=NULL,lease_until=NULL,updated_at=?,consecutive_attempts=0,next_poll_at=?,sync_mode=?,last_completed_at=COALESCE(?,last_completed_at)
      WHERE id=? AND tenant_id=? AND lease_token=? AND EXISTS(SELECT 1 FROM agent_mailbox_sync_pages WHERE stream_id=? AND token=? AND payload_hash=?)`)
      .bind(page.syncCursor??row.checkpoint,page.nextCursor??null,page.syncCursor?crypto.randomUUID():row.round_id,page.syncCursor?0:row.page_number+1,page.nextCursor&&row.page_number>=499?'resync_required':'ready',now,new Date(this.clock()+(page.syncCursor&&row.sync_mode!=='bootstrap'?300000:0)).toISOString(),page.syncCursor?'incremental':row.sync_mode,page.syncCursor?now:null,row.id,this.actor.tenantId,claim.token,row.id,claim.token,hash);
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
  async claimChange(streamId:string):Promise<MailboxChangeClaim|null> {
    const {row,grant}=await this.stream(streamId),now=this.now(),token=crypto.randomUUID();
    await this.env.AGENT_DB.prepare('INSERT OR IGNORE INTO agent_mailbox_consumers(stream_id) VALUES (?)').bind(streamId).run();
    await this.env.AGENT_DB.prepare("UPDATE agent_mailbox_consumers SET state='review_required' WHERE stream_id=? AND attempts>=12 AND (lease_until IS NULL OR lease_until<=?)").bind(streamId,now).run();
    const next=`SELECT c.PAGE FROM agent_mailbox_changes c WHERE c.stream_id=? AND c.state='pending' ORDER BY c.created_at,c.rowid LIMIT 1`;
    const result=await this.env.AGENT_DB.prepare(`UPDATE agent_mailbox_consumers SET page_token=(${next.replace('PAGE','page_token')}),ordinal=(${next.replace('PAGE','ordinal')}),
      lease_token=?,lease_until=?,attempts=attempts+1 WHERE stream_id=? AND state='ready' AND next_attempt_at<=? AND (lease_until IS NULL OR lease_until<=?)
      AND EXISTS(SELECT 1 FROM agent_mailbox_changes WHERE stream_id=? AND state='pending') AND ${this.fence}`)
      .bind(streamId,streamId,token,new Date(this.clock()+90000).toISOString(),streamId,now,now,streamId,...this.args(row.grant_id,grant)).run();
    return result.meta.changes===1?{streamId,token}:null;
  }
  async changeContext(claim:MailboxChangeClaim) {
    const {row}=await this.stream(claim.streamId);
    const change=await this.env.AGENT_DB.prepare(`SELECT c.message_id,c.page_token,c.ordinal,p.source_mode,w.attempts FROM agent_mailbox_consumers w
      JOIN agent_mailbox_changes c ON c.stream_id=w.stream_id AND c.page_token=w.page_token AND c.ordinal=w.ordinal
      JOIN agent_mailbox_sync_pages p ON p.stream_id=c.stream_id AND p.token=c.page_token
      WHERE w.stream_id=? AND w.lease_token=? AND w.lease_until>? AND w.state='ready' AND c.state='pending'`)
      .bind(row.id,claim.token,this.now()).first<{message_id:string;page_token:string;ordinal:number;source_mode:string;attempts:number}>();
    if(!change)throw unavailable();
    return {...change,grantId:row.grant_id,provider:row.provider,resource:row.resource};
  }
  async deferChange(claim:MailboxChangeClaim,seconds=300,review=false) {
    const context=await this.changeContext(claim);
    if(!Number.isFinite(seconds)||seconds<60||seconds>86400)throw unavailable();
    return this.env.AGENT_DB.prepare(`UPDATE agent_mailbox_consumers SET lease_token=NULL,lease_until=NULL,next_attempt_at=?,state=?
      WHERE stream_id=? AND lease_token=? AND lease_until>?`)
      .bind(new Date(this.clock()+seconds*1000).toISOString(),review||context.attempts>=12?'review_required':'ready',claim.streamId,claim.token,this.now()).run();
  }
  async saveChange(claim:MailboxChangeClaim,snapshot:MailSnapshot|null):Promise<boolean> {
    const context=await this.changeContext(claim),{row,grant}=await this.stream(claim.streamId),now=this.now();
    if(snapshot&&(snapshot.provider!==row.provider||snapshot.id!==context.message_id))throw unavailable();
    const content=snapshot?JSON.stringify(mailSnapshot(row.provider,snapshot.content,context.message_id).content):null;
    const bytes=content?new TextEncoder().encode(content).length:0;
    const receipt=this.env.AGENT_DB.prepare(`INSERT INTO agent_mailbox_messages(stream_id,message_id,state,content_json,content_bytes,source_mode,observed_at,receipt_token)
      SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM agent_mailbox_consumers WHERE stream_id=? AND lease_token=? AND lease_until>?) AND ${this.fence}
      AND (SELECT COALESCE(SUM(m.content_bytes),0) FROM agent_mailbox_messages m JOIN agent_mailbox_sync s ON s.id=m.stream_id WHERE s.tenant_id=? AND NOT(m.stream_id=? AND m.message_id=?))+?<=10000000
      AND (SELECT COUNT(*) FROM agent_mailbox_messages m JOIN agent_mailbox_sync s ON s.id=m.stream_id WHERE s.tenant_id=? AND NOT(m.stream_id=? AND m.message_id=?))<10000
      ON CONFLICT(stream_id,message_id) DO UPDATE SET state=excluded.state,content_json=excluded.content_json,content_bytes=excluded.content_bytes,
        source_mode=excluded.source_mode,observed_at=excluded.observed_at,receipt_token=excluded.receipt_token,needs_reconciliation=0`)
      .bind(row.id,context.message_id,snapshot?'present':'missing',content,bytes,context.source_mode,now,claim.token,row.id,claim.token,now,...this.args(row.grant_id,grant),this.actor.tenantId,row.id,context.message_id,bytes,this.actor.tenantId,row.id,context.message_id);
    const acknowledge=this.env.AGENT_DB.prepare(`UPDATE agent_mailbox_changes SET state='applied' WHERE stream_id=? AND page_token=? AND ordinal=? AND state='pending'
      AND EXISTS(SELECT 1 FROM agent_mailbox_messages WHERE stream_id=? AND message_id=? AND receipt_token=?)`)
      .bind(row.id,context.page_token,context.ordinal,row.id,context.message_id,claim.token);
    const release=this.env.AGENT_DB.prepare(`UPDATE agent_mailbox_consumers SET lease_token=NULL,lease_until=NULL,attempts=0,next_attempt_at=? WHERE stream_id=? AND lease_token=?
      AND EXISTS(SELECT 1 FROM agent_mailbox_messages WHERE stream_id=? AND message_id=? AND receipt_token=?)`)
      .bind(now,row.id,claim.token,row.id,context.message_id,claim.token);
    const results=await this.env.AGENT_DB.batch([receipt,acknowledge,release]);
    return results[1].meta.changes===1;
  }
}
