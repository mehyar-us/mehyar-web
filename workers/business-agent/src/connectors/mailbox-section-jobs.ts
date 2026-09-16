import type {Actor} from '../env';
import {z} from 'zod';
import {HttpError} from '../http';
import type {SectionTerms} from './mailbox-section-offers';
type Job={id:string;offer_id:string;user_id:string;terms:string;state:string;completed:number;attempts:number;next_at:number;deadline:number;lease:string|null;lease_until:number;reason:string|null};
/** Private, bounded execution of an explicitly accepted section offer. Never aggregates. */
export class MailboxSectionJobs {
  constructor(private storage:DurableObjectStorage){}
  initialize(){this.storage.sql.exec(`CREATE TABLE IF NOT EXISTS mailbox_section_jobs(
    id TEXT PRIMARY KEY,offer_id TEXT NOT NULL UNIQUE,user_id TEXT NOT NULL,terms TEXT NOT NULL,state TEXT NOT NULL,
    completed INTEGER NOT NULL DEFAULT 0,attempts INTEGER NOT NULL DEFAULT 0,next_at INTEGER NOT NULL,deadline INTEGER NOT NULL,
    lease TEXT,lease_until INTEGER NOT NULL DEFAULT 0,reason TEXT)`);
    this.storage.sql.exec('CREATE INDEX IF NOT EXISTS mailbox_section_jobs_owner ON mailbox_section_jobs(user_id,id)');}
  recover(){this.storage.sql.exec("UPDATE mailbox_section_jobs SET state=CASE WHEN attempts>=3 THEN 'review_required' ELSE 'queued' END,lease=NULL,lease_until=0,reason='interrupted' WHERE state='running'");this.expire();}
  expire(){
    this.storage.sql.exec("UPDATE mailbox_section_jobs SET state='expired',lease=NULL,reason='approval_expired' WHERE state IN ('queued','running') AND deadline<=?",Date.now());
    this.storage.sql.exec("UPDATE mailbox_section_jobs SET state='review_required',lease=NULL,reason='interrupted' WHERE state='running' AND lease_until<=?",Date.now());
  }
  byOffer(actor:Actor,offerId:string){this.expire();return this.storage.sql.exec<Job>('SELECT * FROM mailbox_section_jobs WHERE offer_id=? AND user_id=?',offerId,actor.userId).toArray()[0];}
  start(actor:Actor,offerId:string,terms:SectionTerms){
    return this.storage.transactionSync(()=>{
      const prior=this.byOffer(actor,offerId);if(prior)return prior;
      if(this.storage.sql.exec<{n:number}>("SELECT COUNT(*) AS n FROM mailbox_section_jobs WHERE state IN ('queued','running')").one().n>=10)
        throw new HttpError(429,'section_jobs_limit','Too many analyses are active. Wait for one to finish.');
      const id=crypto.randomUUID(),now=Date.now();
      this.storage.sql.exec("INSERT INTO mailbox_section_jobs(id,offer_id,user_id,terms,state,next_at,deadline) VALUES(?,?,?,?,'queued',?,?)",id,offerId,actor.userId,JSON.stringify(terms),now,now+86400000);
      return this.get(actor,id);
    });
  }
  get(actor:Actor,id:string){
    this.expire();const job=this.storage.sql.exec<Job>('SELECT * FROM mailbox_section_jobs WHERE id=? AND user_id=?',id,actor.userId).toArray()[0];
    if(!job)throw new HttpError(404,'section_job_unavailable','This analysis job is unavailable.');return job;
  }
  list(actor:Actor,after?:string){
    if(after!==undefined&&!z.string().uuid().safeParse(after).success)throw new HttpError(400,'invalid_section_job_cursor','Refresh background analyses.');
    this.expire();const rows=this.storage.sql.exec<Job>('SELECT * FROM mailbox_section_jobs WHERE user_id=? AND id>? ORDER BY id LIMIT 11',actor.userId,after??'').toArray();
    return {jobs:rows.slice(0,10).map(job=>this.present(job)),nextCursor:rows.length>10?rows[9].id:undefined};
  }
  present(job:Job){const terms=JSON.parse(job.terms) as SectionTerms;return {id:job.id,status:job.state,completedSections:job.completed,totalSections:terms.indices.length,
    maximumTextCredits:terms.indices.length,createdAt:new Date(job.deadline-86400000).toISOString(),approvalExpiresAt:new Date(job.deadline).toISOString(),
    source:{streamId:terms.streamId,messageId:terms.messageId,receipt:terms.receipt},reason:job.reason,includesAggregation:false,authorizesExternalActions:false};}
  hasWork(){this.expire();return this.storage.sql.exec<{n:number}>("SELECT COUNT(*) AS n FROM mailbox_section_jobs WHERE state IN ('queued','running')").one().n>0;}
  stopAll(reason='agent_paused'){this.storage.sql.exec("UPDATE mailbox_section_jobs SET state='cancelled',lease=NULL,reason=? WHERE state IN ('queued','running')",reason);}
  cancel(actor:Actor,id:string){this.get(actor,id);this.storage.sql.exec("UPDATE mailbox_section_jobs SET state='cancelled',lease=NULL,reason='owner_cancelled' WHERE id=? AND user_id=? AND state IN ('queued','running')",id,actor.userId);return this.get(actor,id);}
  claim(){
    return this.storage.transactionSync(()=>{
      this.expire();const row=this.storage.sql.exec<Job>("SELECT * FROM mailbox_section_jobs WHERE state='queued' AND next_at<=? ORDER BY next_at,rowid LIMIT 1",Date.now()).toArray()[0];
      if(!row)return;
      const lease=crypto.randomUUID();this.storage.sql.exec("UPDATE mailbox_section_jobs SET state='running',attempts=attempts+1,lease=?,lease_until=? WHERE id=?",lease,Date.now()+120000,row.id);
      return {...row,state:'running',attempts:row.attempts+1,lease,lease_until:Date.now()+120000};
    });
  }
  guard(job:Job){
    this.expire();const current=this.storage.sql.exec<Job>('SELECT * FROM mailbox_section_jobs WHERE id=?',job.id).toArray()[0];
    if(!current||current.state!=='running'||current.lease!==job.lease)throw new HttpError(409,'section_job_stopped','This analysis job stopped.');
  }
  finish(job:Job,failure?:{error:unknown}){
    this.storage.transactionSync(()=>{
      try{this.guard(job);}catch{return;}
      if(failure){
        const error=failure.error;
        const code=error instanceof HttpError?error.code:'analysis_temporarily_unavailable';
        const retry=(!(error instanceof HttpError)||code==='analysis_running')&&job.attempts<3;
        this.storage.sql.exec('UPDATE mailbox_section_jobs SET state=?,reason=?,lease=NULL,next_at=? WHERE id=?',retry?'queued':'review_required',code,Date.now()+60000*job.attempts,job.id);
      }else{
        const count=(JSON.parse(job.terms) as SectionTerms).indices.length;
        this.storage.sql.exec('UPDATE mailbox_section_jobs SET state=?,completed=completed+1,attempts=0,reason=NULL,lease=NULL,next_at=? WHERE id=?',job.completed+1===count?'completed':'queued',Date.now()+60000,job.id);
      }
    });
  }
}
