import type {Actor,Env} from '../env';
import {HttpError} from '../http';
import {MailboxSync} from './mailbox-sync';
import {requireMailboxAccess} from './mailbox-runner';
import {restartMailbox} from './mailbox-restart';
type Offer={id:string;user_id:string;grant_id:string;stream_id:string;round_id:string;expires:number;pending:number;cached:number;affected:number};
const expired=()=>new HttpError(409,'mailbox_recovery_expired','This recovery review expired. Review the mailbox again.');

/** Opaque per-business offers keep stream IDs, rounds and provider cursors server-side. */
export class MailboxRecoveryOffers {
  constructor(private storage:DurableObjectStorage){}
  initialize(){this.storage.sql.exec(`CREATE TABLE IF NOT EXISTS mailbox_recovery_offers(
    id TEXT PRIMARY KEY,user_id TEXT NOT NULL,grant_id TEXT NOT NULL,stream_id TEXT NOT NULL,round_id TEXT NOT NULL,
    expires INTEGER NOT NULL,pending INTEGER NOT NULL,cached INTEGER NOT NULL,affected INTEGER NOT NULL)`);}
  async prepare(env:Env,actor:Actor,grantId:string,guard:()=>Promise<void>) {
    await guard();
    if(env.MAILBOX_RECOVERY_ENABLED!=='true'||env.MAILBOX_PROCESSING_ENABLED!=='true')throw new HttpError(503,'mailbox_setup_unavailable','Mailbox recovery is awaiting activation.');
    const grant=await env.AGENT_DB.prepare('SELECT provider FROM auth_provider_grants WHERE id=? AND tenant_scope=? AND user_id=?')
      .bind(grantId,actor.tenantId,actor.userId).first<{provider:'google'|'microsoft'}>();
    if(!grant)throw new HttpError(404,'mailbox_not_found','This mailbox is unavailable.');
    await requireMailboxAccess(env,actor,guard,grant.provider);
    const candidate=await new MailboxSync(env,actor).recoveryCandidate(grantId,grant.provider);
    await guard();
    if(!candidate)throw new HttpError(409,'mailbox_recovery_unneeded','No mailbox stream currently requires recovery. Refresh status.');
    const now=Date.now();
    const offer=this.storage.transactionSync(()=>{
      this.storage.sql.exec('DELETE FROM mailbox_recovery_offers WHERE expires<=?',now);
      const prior=this.storage.sql.exec<Offer>('SELECT * FROM mailbox_recovery_offers WHERE user_id=? AND grant_id=? AND stream_id=? AND round_id=?',actor.userId,grantId,candidate.id,candidate.round_id).toArray()[0];
      if(prior)return prior;
      if(this.storage.sql.exec<{n:number}>('SELECT COUNT(*) AS n FROM mailbox_recovery_offers').one().n>=10)
        throw new HttpError(429,'mailbox_recovery_limit','Too many recovery reviews are open. Try again in ten minutes.');
      const item={id:crypto.randomUUID(),user_id:actor.userId,grant_id:grantId,stream_id:candidate.id,round_id:candidate.round_id,
        expires:now+600000,pending:candidate.pending,cached:candidate.cached,affected:candidate.affectedStreams};
      this.storage.sql.exec('INSERT INTO mailbox_recovery_offers VALUES(?,?,?,?,?,?,?,?,?)',item.id,item.user_id,item.grant_id,item.stream_id,item.round_id,item.expires,item.pending,item.cached,item.affected);
      return item;
    });
    return {recoveryId:offer.id,expiresAt:new Date(offer.expires).toISOString(),pendingReferences:offer.pending,cachedMessages:offer.cached,affectedStreams:offer.affected};
  }
  async execute(env:Env,actor:Actor,grantId:string,recoveryId:string,guard:()=>Promise<void>,transport:typeof fetch=fetch) {
    const read=()=>{
      if(!/^[a-f0-9-]{36}$/.test(recoveryId))throw expired();
      const offer=this.storage.sql.exec<Offer>('SELECT * FROM mailbox_recovery_offers WHERE id=?',recoveryId).toArray()[0];
      if(!offer||offer.user_id!==actor.userId||offer.grant_id!==grantId||offer.expires<=Date.now())throw expired();
      return offer;
    };
    await guard();const offer=read();
    const controlled=async()=>{await guard();read();};
    return restartMailbox(env,actor,offer.stream_id,offer.id,offer.round_id,controlled,transport);
  }
}
