import {HttpError} from '../http';
import {normalizeWebsite} from '../tenants';

type Status='reserved'|'submitting'|'uncertain'|'running'|'cancel_requested'|'completed'|'cancelled'|'failed';
type Job={id:string;request_key:string;source:string;period:string;page_limit:number;depth:number;deadline:number;
  status:Status;provider_id:string|null;used:number;reserved:number};
const conflict=(message:string)=>new HttpError(409,'research_job_conflict',message);

/** Private per-business ledger. Callers must independently authorize membership,
 * entitlement and network readiness before reserving or dispatching work. */
export class ResearchJobs {
  constructor(private storage:DurableObjectStorage){}
  initialize(){
    this.storage.sql.exec(`CREATE TABLE IF NOT EXISTS research_jobs (
      id TEXT PRIMARY KEY,request_key TEXT NOT NULL UNIQUE,source TEXT NOT NULL,period TEXT NOT NULL,
      page_limit INTEGER NOT NULL,depth INTEGER NOT NULL,deadline INTEGER NOT NULL,status TEXT NOT NULL,
      provider_id TEXT UNIQUE,used INTEGER NOT NULL DEFAULT 0,reserved INTEGER NOT NULL)`);
    // An interrupted POST may have created a billable provider job. Keep its reservation.
    this.storage.sql.exec("UPDATE research_jobs SET status='uncertain' WHERE status='submitting'");
    this.expire();
  }
  expire(now=Date.now()) {
    this.storage.transactionSync(()=>{
      this.storage.sql.exec("UPDATE research_jobs SET status='cancelled',reserved=0 WHERE status='reserved' AND deadline<=?",now);
      this.storage.sql.exec("UPDATE research_jobs SET status='cancel_requested' WHERE status='running' AND deadline<=?",now);
      this.storage.sql.exec("UPDATE research_jobs SET status='uncertain' WHERE status='submitting' AND deadline<=?",now);
    });
  }
  get(id:string):Job {
    const row=this.storage.sql.exec<Job>('SELECT * FROM research_jobs WHERE id=?',id).toArray()[0];
    if(!row)throw new HttpError(404,'research_job_missing','Research job not found.');return row;
  }
  reserve(input:{key:string;url:string;period:string;allowance:number;pages:number;depth:number;deadline:number},now=Date.now()):Job {
    const source=normalizeWebsite(input.url);
    if(!source||!input.key||input.key.length>128||!input.period||input.period.length>128||
      !Number.isSafeInteger(input.allowance)||input.allowance<1||input.allowance>100_000||
      !Number.isInteger(input.pages)||input.pages<1||input.pages>1000||
      !Number.isInteger(input.depth)||input.depth<0||input.depth>5||
      !Number.isSafeInteger(input.deadline)||input.deadline<=now||input.deadline>now+3_600_000)
      throw new HttpError(400,'invalid_research_job','Research requires bounded pages, depth and a deadline within one hour.');
    return this.storage.transactionSync(()=>{
      const prior=this.storage.sql.exec<Job>('SELECT * FROM research_jobs WHERE request_key=?',input.key).toArray()[0];
      if(prior){
        if(prior.source!==source||prior.period!==input.period||prior.page_limit!==input.pages||prior.depth!==input.depth||prior.deadline!==input.deadline)
          throw conflict('This request key belongs to different research.');
        return prior;
      }
      const usage=this.storage.sql.exec<{total:number}>('SELECT COALESCE(SUM(used+reserved),0) AS total FROM research_jobs WHERE period=?',input.period).one();
      if(usage.total+input.pages>input.allowance)throw new HttpError(429,'research_page_limit','The website research page allowance is reserved or consumed.');
      const id=crypto.randomUUID();
      this.storage.sql.exec("INSERT INTO research_jobs(id,request_key,source,period,page_limit,depth,deadline,status,reserved) VALUES(?,?,?,?,?,?,?,'reserved',?)",
        id,input.key,source,input.period,input.pages,input.depth,input.deadline,input.pages);
      return this.get(id);
    });
  }
  begin(id:string,now=Date.now()):Job {
    const job=this.get(id);
    if(job.status!=='reserved'||job.deadline<=now)throw conflict('This research cannot be submitted.');
    this.storage.sql.exec("UPDATE research_jobs SET status='submitting' WHERE id=?",id);return this.get(id);
  }
  submitted(id:string,providerId:string):Job {
    const job=this.get(id);
    if(!/^[a-zA-Z0-9_-]{16,128}$/.test(providerId))throw conflict('A verified provider identifier is required.');
    if(job.provider_id===providerId)return job;
    if(job.status!=='submitting'||job.provider_id)throw conflict('Research submission no longer matches.');
    this.storage.sql.exec("UPDATE research_jobs SET status='running',provider_id=? WHERE id=?",providerId,id);return this.get(id);
  }
  uncertain(id:string):Job {
    const job=this.get(id);if(job.status==='uncertain')return job;
    if(job.status!=='submitting')throw conflict('Only an unresolved submission may become uncertain.');
    this.storage.sql.exec("UPDATE research_jobs SET status='uncertain' WHERE id=?",id);return this.get(id);
  }
  cancel(id:string):Job {
    const job=this.get(id);
    if(job.status==='reserved')this.storage.sql.exec("UPDATE research_jobs SET status='cancelled',reserved=0 WHERE id=?",id);
    else if(job.status==='running')this.storage.sql.exec("UPDATE research_jobs SET status='cancel_requested' WHERE id=?",id);
    // Unknown submissions remain uncertain; cancellation cannot prove no provider effect.
    else if(job.status==='submitting')return this.uncertain(id);
    return this.get(id);
  }
  settle(id:string,status:'completed'|'cancelled'|'failed',successfulPages:number):Job {
    const job=this.get(id);
    if(!Number.isInteger(successfulPages)||successfulPages<0||successfulPages>job.page_limit)throw conflict('Invalid verified page count.');
    if(job.status===status&&job.used===successfulPages&&job.reserved===0)return job;
    if(!job.provider_id||!['running','cancel_requested'].includes(job.status))throw conflict('Provider completion must be verified before settling research.');
    this.storage.sql.exec('UPDATE research_jobs SET status=?,used=?,reserved=0 WHERE id=?',status,successfulPages,id);return this.get(id);
  }
}
