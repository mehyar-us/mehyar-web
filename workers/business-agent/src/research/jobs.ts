import {HttpError} from '../http';
import {normalizeWebsite} from '../tenants';
import {extractSiteEvidence,type ExtractedPage} from './extract';
import type {CrawlRecord} from './cloudflare-crawl';
import {ResearchSpend} from './spend';

type Status='reserved'|'submitting'|'uncertain'|'running'|'cancel_requested'|'completed'|'cancelled'|'failed';
type Job={id:string;request_key:string;source:string;period:string;page_limit:number;depth:number;deadline:number;
  status:Status;provider_id:string|null;used:number;reserved:number};
const conflict=(message:string)=>new HttpError(409,'research_job_conflict',message);

/** Private per-business ledger. Callers must independently authorize membership,
 * entitlement and network readiness before reserving or dispatching work. */
export class ResearchJobs {
  constructor(private storage:DurableObjectStorage){}
  initialize(){
    new ResearchSpend(this.storage).initialize();
    this.storage.sql.exec(`CREATE TABLE IF NOT EXISTS research_jobs (
      id TEXT PRIMARY KEY,request_key TEXT NOT NULL UNIQUE,source TEXT NOT NULL,period TEXT NOT NULL,
      page_limit INTEGER NOT NULL,depth INTEGER NOT NULL,deadline INTEGER NOT NULL,status TEXT NOT NULL,
      provider_id TEXT UNIQUE,used INTEGER NOT NULL DEFAULT 0,reserved INTEGER NOT NULL)`);
    this.storage.sql.exec(`CREATE TABLE IF NOT EXISTS research_pages (
      job_id TEXT NOT NULL,url TEXT NOT NULL,content_hash TEXT NOT NULL,evidence TEXT NOT NULL,
      PRIMARY KEY(job_id,url))`);
    this.storage.sql.exec(`CREATE TABLE IF NOT EXISTS research_poll (
      job_id TEXT PRIMARY KEY,cursor INTEGER NOT NULL,steps INTEGER NOT NULL,
      outcome TEXT NOT NULL,done INTEGER NOT NULL)`);
    this.storage.sql.exec(`CREATE TABLE IF NOT EXISTS research_withdrawals (
      job_id TEXT PRIMARY KEY,user_id TEXT NOT NULL,requested_at TEXT NOT NULL)`);
    this.storage.sql.exec(`CREATE TABLE IF NOT EXISTS research_provider_usage (
      job_id TEXT PRIMARY KEY,browser_seconds REAL NOT NULL,observed_at TEXT NOT NULL,
      terminal_observed INTEGER NOT NULL DEFAULT 0)`);
    this.storage.sql.exec(`CREATE TABLE IF NOT EXISTS research_poll_work (
      job_id TEXT PRIMARY KEY,attempts INTEGER NOT NULL DEFAULT 0,failures INTEGER NOT NULL DEFAULT 0,
      next_at INTEGER NOT NULL DEFAULT 0,lease_id TEXT,lease_until INTEGER NOT NULL DEFAULT 0)`);
    // An interrupted POST may have created a billable provider job. Keep its reservation.
    this.storage.sql.exec("UPDATE research_jobs SET status='uncertain' WHERE status='submitting'");
    this.expire();
  }
  expire(now=Date.now()) {
    this.storage.transactionSync(()=>{
      this.storage.sql.exec("UPDATE research_jobs SET status='cancelled',reserved=0 WHERE status='reserved' AND deadline<=?",now);
      this.storage.sql.exec("UPDATE research_jobs SET status='cancel_requested' WHERE status='running' AND deadline<=?",now);
      this.storage.sql.exec("UPDATE research_jobs SET status='uncertain' WHERE status='submitting' AND deadline<=?",now);
      this.storage.sql.exec("UPDATE research_spend SET status='released' WHERE status='reserved' AND job_id IN (SELECT id FROM research_jobs WHERE status='cancelled' AND provider_id IS NULL)");
    });
  }
  hasDeadlines(){return this.storage.sql.exec<{count:number}>("SELECT COUNT(*) AS count FROM research_jobs WHERE status IN ('reserved','submitting','running')").one().count>0;}
  get(id:string):Job {
    const row=this.storage.sql.exec<Job>('SELECT * FROM research_jobs WHERE id=?',id).toArray()[0];
    if(!row)throw new HttpError(404,'research_job_missing','Research job not found.');return row;
  }
  byRequestKey(key:string){return this.storage.sql.exec<Job>('SELECT * FROM research_jobs WHERE request_key=?',key).toArray()[0];}
  providerUsage(id:string){
    this.get(id);
    return this.storage.sql.exec<{browser_seconds:number;observed_at:string;terminal_observed:number}>('SELECT browser_seconds,observed_at,terminal_observed FROM research_provider_usage WHERE job_id=?',id).toArray()[0]??null;
  }
  claimPoll(id:string,now=Date.now()){
    const job=this.get(id);
    if(!['running','cancel_requested'].includes(job.status)||!job.provider_id)throw conflict('This research job cannot be polled.');
    return this.storage.transactionSync(()=>{
      this.storage.sql.exec('INSERT OR IGNORE INTO research_poll_work(job_id) VALUES(?)',id);
      const work=this.storage.sql.exec<{attempts:number;failures:number;next_at:number;lease_until:number}>('SELECT attempts,failures,next_at,lease_until FROM research_poll_work WHERE job_id=?',id).one();
      if(work.attempts>=job.page_limit+120||work.failures>=8)throw new HttpError(409,'research_poll_review','Research polling needs operator review before more provider requests.');
      if(work.next_at>now||work.lease_until>now)throw new HttpError(409,'research_poll_wait','Research polling is already active or waiting to retry.');
      const lease=crypto.randomUUID();
      this.storage.sql.exec('UPDATE research_poll_work SET attempts=attempts+1,lease_id=?,lease_until=? WHERE job_id=?',lease,now+60_000,id);return lease;
    });
  }
  assertPoll(id:string,lease:string,now=Date.now()){
    const work=this.storage.sql.exec<{lease_id:string;lease_until:number}>('SELECT lease_id,lease_until FROM research_poll_work WHERE job_id=?',id).toArray()[0];
    if(work?.lease_id!==lease||work.lease_until<=now)throw new HttpError(409,'research_poll_stale','A newer research poll owns this result.');
  }
  finishPoll(id:string,lease:string,success:boolean,delayMs:number,now=Date.now()){
    const work=this.storage.sql.exec<{lease_id:string;failures:number}>('SELECT lease_id,failures FROM research_poll_work WHERE job_id=?',id).toArray()[0];
    if(work?.lease_id!==lease)return;
    const failures=success?0:work.failures+1,delay=success?delayMs:Math.min(900_000,5000*2**Math.min(failures-1,8));
    this.storage.sql.exec('UPDATE research_poll_work SET failures=?,next_at=?,lease_id=NULL,lease_until=0 WHERE job_id=? AND lease_id=?',failures,now+delay,id,lease);
  }
  observeProviderUsage(id:string,providerId:string,seconds:number|undefined,terminal:boolean){
    const job=this.get(id);
    if(!job.provider_id||job.provider_id!==providerId)throw conflict('Provider usage does not match this research job.');
    if(seconds===undefined)return this.providerUsage(id);
    if(!Number.isFinite(seconds)||seconds<0||seconds>Number.MAX_SAFE_INTEGER)
      throw conflict('The provider reported invalid browser usage.');
    // Provider totals are cumulative across result pages. Never sum repeated polls
    // or reduce the high-water observation when an older result arrives later.
    this.storage.sql.exec(`INSERT INTO research_provider_usage(job_id,browser_seconds,observed_at,terminal_observed) VALUES(?,?,?,?)
      ON CONFLICT(job_id) DO UPDATE SET
      observed_at=CASE WHEN excluded.browser_seconds>=research_provider_usage.browser_seconds THEN excluded.observed_at ELSE research_provider_usage.observed_at END,
      browser_seconds=MAX(research_provider_usage.browser_seconds,excluded.browser_seconds),
      terminal_observed=MAX(research_provider_usage.terminal_observed,excluded.terminal_observed)`,id,seconds,new Date().toISOString(),terminal?1:0);
    return this.providerUsage(id);
  }
  summary(id:string) {
    const job=this.get(id);
    const evidencePages=this.storage.sql.exec<{total:number}>('SELECT COUNT(*) AS total FROM research_pages WHERE job_id=?',id).one().total;
    const work=this.storage.sql.exec<{attempts:number;failures:number}>('SELECT attempts,failures FROM research_poll_work WHERE job_id=?',id).toArray()[0];
    const active=['running','cancel_requested'].includes(job.status);
    const attention=job.status==='uncertain'?'submission_uncertain':active&&work&&work.failures>=8?'poll_failures':active&&work&&work.attempts>=job.page_limit+120?'poll_limit':null;
    return {id:job.id,website:job.source,status:job.status,pageLimit:job.page_limit,evidencePages,
      usedPages:job.used,reservedPages:job.reserved,deadline:new Date(job.deadline).toISOString(),attention};
  }
  list(offset=0) {
    if(!Number.isSafeInteger(offset)||offset<0)throw conflict('Invalid research job offset.');
    const rows=this.storage.sql.exec<{id:string}>('SELECT id FROM research_jobs ORDER BY rowid DESC LIMIT 21 OFFSET ?',offset).toArray();
    return {jobs:rows.slice(0,20).map(row=>this.summary(row.id)),nextOffset:rows.length>20?offset+20:null};
  }
  reserve(input:{key:string;url:string;period:string;allowance:number;pages:number;depth:number;deadline:number;maxJobs?:number},now=Date.now()):Job {
    const source=normalizeWebsite(input.url);
    if(!source||!input.key||input.key.length>128||!input.period||input.period.length>128||
      !Number.isSafeInteger(input.allowance)||input.allowance<1||input.allowance>100_000||
      (input.maxJobs!==undefined&&(!Number.isSafeInteger(input.maxJobs)||input.maxJobs<1||input.maxJobs>100_000))||
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
      if(input.maxJobs!==undefined){
        const jobs=this.storage.sql.exec<{total:number}>("SELECT COUNT(*) AS total FROM research_jobs WHERE period=? AND NOT(status='cancelled' AND provider_id IS NULL)",input.period).one().total;
        if(jobs>=input.maxJobs)throw new HttpError(429,'research_job_limit','The included website crawl has already been reserved or used.');
      }
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
  beginFunded(id:string){return this.storage.transactionSync(()=>{const job=this.begin(id);new ResearchSpend(this.storage).dispatch(id);return job;});}
  reserveSpend(id:string,micros:number,budget:number,quoteRef:string){
    const job=this.get(id);if(job.status!=='reserved')throw conflict('Only queued research can reserve supplier spending.');
    return new ResearchSpend(this.storage).reserve(id,job.period,micros,budget,quoteRef);
  }
  submitted(id:string,providerId:string):Job {
    const job=this.get(id);
    if(!/^[a-zA-Z0-9_-]{16,128}$/.test(providerId))throw conflict('A verified provider identifier is required.');
    if(job.provider_id===providerId)return job;
    if(!['submitting','uncertain'].includes(job.status)||job.provider_id)throw conflict('Research submission no longer matches.');
    // A late verified POST receipt resolves the identity but does not renew permission.
    const status=job.status==='uncertain'||job.deadline<=Date.now()?'cancel_requested':'running';
    this.storage.sql.exec('UPDATE research_jobs SET status=?,provider_id=? WHERE id=?',status,providerId,id);return this.get(id);
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
    if(job.status==='reserved')new ResearchSpend(this.storage).release(id);
    return this.get(id);
  }
  withdraw(id:string,userId:string){
    return this.storage.transactionSync(()=>{
      const job=this.cancel(id);
      this.storage.sql.exec('INSERT OR IGNORE INTO research_withdrawals(job_id,user_id,requested_at) VALUES(?,?,?)',id,userId,new Date().toISOString());
      return job;
    });
  }
  async ingest(id:string,providerId:string,record:CrawlRecord,retrievedAt:string):Promise<ExtractedPage> {
    const job=this.get(id);
    if(job.provider_id!==providerId||!['running','cancel_requested'].includes(job.status))throw conflict('Research does not accept pages for this provider job.');
    if(record.status!=='completed'||typeof record.html!=='string'||!Number.isInteger(record.httpStatus)||record.httpStatus!<200||record.httpStatus!>=300)
      throw conflict('Only permitted successful HTML may become research evidence.');
    const url=normalizeWebsite(record.url),finalUrl=normalizeWebsite(record.finalUrl??record.url);
    if(!url||!finalUrl||new URL(url).origin!==new URL(job.source).origin||new URL(finalUrl).origin!==new URL(job.source).origin)
      throw conflict('Research evidence must belong to the approved website.');
    const page=await extractSiteEvidence(record.html,finalUrl,retrievedAt);
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(record.html));
    const hash=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
    return this.storage.transactionSync(()=>{
      const current=this.get(id);
      if(current.provider_id!==providerId||!['running','cancel_requested'].includes(current.status))throw conflict('Research stopped accepting evidence during extraction.');
      const prior=this.storage.sql.exec<{content_hash:string;evidence:string}>('SELECT content_hash,evidence FROM research_pages WHERE job_id=? AND url=?',id,finalUrl).toArray()[0];
      if(prior){if(prior.content_hash!==hash)throw conflict('This page has conflicting content in the same crawl.');return JSON.parse(prior.evidence) as ExtractedPage;}
      const count=this.storage.sql.exec<{total:number}>('SELECT COUNT(*) AS total FROM research_pages WHERE job_id=?',id).one().total;
      if(count>=current.page_limit)throw conflict('Research has reached its reserved page limit.');
      this.storage.sql.exec('INSERT INTO research_pages(job_id,url,content_hash,evidence) VALUES(?,?,?,?)',id,finalUrl,hash,JSON.stringify(page));
      return page;
    });
  }
  pages(id:string,offset=0):ExtractedPage[] {
    this.get(id);
    if(!Number.isSafeInteger(offset)||offset<0)throw conflict('Invalid research page offset.');
    return this.storage.sql.exec<{evidence:string}>('SELECT evidence FROM research_pages WHERE job_id=? ORDER BY url LIMIT 20 OFFSET ?',id,offset).toArray().map(row=>JSON.parse(row.evidence) as ExtractedPage);
  }
  claim(id:string,url:string,index:number) {
    this.get(id);
    const row=this.storage.sql.exec<{evidence:string}>('SELECT evidence FROM research_pages WHERE job_id=? AND url=?',id,url).toArray()[0];
    const claim=row?(JSON.parse(row.evidence) as ExtractedPage).evidence[index]:undefined;
    if(!claim)throw new HttpError(404,'research_claim_missing','This source claim is not available.');
    return claim;
  }
  checkpoint(id:string) {
    this.get(id);
    return this.storage.sql.exec<{cursor:number;steps:number;outcome:string;done:number}>('SELECT cursor,steps,outcome,done FROM research_poll WHERE job_id=?',id).toArray()[0]
      ??{cursor:0,steps:0,outcome:'',done:0};
  }
  advance(id:string,expectedCursor:number,outcome:string,nextCursor?:number) {
    return this.storage.transactionSync(()=>{
      const job=this.get(id),prior=this.checkpoint(id);
      if(!['running','cancel_requested'].includes(job.status)||prior.done||prior.cursor!==expectedCursor||prior.steps>job.page_limit)
        throw conflict('Research polling checkpoint changed or exceeded its bound.');
      if(!['completed','cancelled_due_to_timeout','cancelled_due_to_limits','cancelled_by_user','errored'].includes(outcome)||prior.outcome&&prior.outcome!==outcome)
        throw conflict('The provider completion snapshot changed.');
      if(nextCursor!==undefined&&(!Number.isSafeInteger(nextCursor)||nextCursor<=prior.cursor||prior.steps>=job.page_limit))
        throw conflict('The provider returned a looping or excessive result cursor.');
      this.storage.sql.exec(`INSERT INTO research_poll(job_id,cursor,steps,outcome,done) VALUES(?,?,?,?,?)
        ON CONFLICT(job_id) DO UPDATE SET cursor=excluded.cursor,steps=excluded.steps,outcome=excluded.outcome,done=excluded.done`,
        id,nextCursor??prior.cursor,prior.steps+1,outcome,nextCursor===undefined?1:0);
      return this.checkpoint(id);
    });
  }
  finish(id:string) {
    const checkpoint=this.checkpoint(id);
    if(!checkpoint.done)throw conflict('All provider result pages must be traversed before settlement.');
    const count=this.storage.sql.exec<{total:number}>('SELECT COUNT(*) AS total FROM research_pages WHERE job_id=?',id).one().total;
    return this.settle(id,checkpoint.outcome==='completed'?'completed':checkpoint.outcome==='errored'?'failed':'cancelled',count);
  }
  settle(id:string,status:'completed'|'cancelled'|'failed',successfulPages:number):Job {
    const job=this.get(id);
    if(!Number.isInteger(successfulPages)||successfulPages<0||successfulPages>job.page_limit)throw conflict('Invalid verified page count.');
    const imported=this.storage.sql.exec<{total:number}>('SELECT COUNT(*) AS total FROM research_pages WHERE job_id=?',id).one().total;
    if(successfulPages<imported)throw conflict('Verified page count cannot omit stored successful pages.');
    if(job.status===status&&job.used===successfulPages&&job.reserved===0)return job;
    if(!job.provider_id||!['running','cancel_requested'].includes(job.status))throw conflict('Provider completion must be verified before settling research.');
    this.storage.sql.exec('UPDATE research_jobs SET status=?,used=?,reserved=0 WHERE id=?',status,successfulPages,id);return this.get(id);
  }
}
