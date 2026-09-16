import {HttpError} from '../http';

type Access={period:string;limit:number;attemptLimit:number};
type Reservation={id:string;user_id:string;payload_hash:string;period:string;status:string;token:string;units:number};
const unavailable=()=>new HttpError(409,'text_reservation_unavailable','This analysis reservation is no longer available.');
/** Private per-business Agent accounting. Callers must independently enforce
 * authorization, paid access, readiness and model bounds. All methods are
 * synchronous so checks and reservations cannot interleave across awaits. */
export class TextUsage {
  constructor(private storage:DurableObjectStorage){}
  initialize(){
    this.storage.sql.exec(`CREATE TABLE IF NOT EXISTS background_text_usage(
      id TEXT PRIMARY KEY,user_id TEXT NOT NULL,payload_hash TEXT NOT NULL,period TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('running','complete','failed')),token TEXT NOT NULL UNIQUE)`);
    this.storage.sql.exec('CREATE INDEX IF NOT EXISTS background_text_period ON background_text_usage(period,status)');
    if(!this.storage.sql.exec<{name:string}>('PRAGMA table_info(background_text_usage)').toArray().some(column=>column.name==='units'))
      this.storage.sql.exec('ALTER TABLE background_text_usage ADD COLUMN units INTEGER NOT NULL DEFAULT 1 CHECK(units>=1 AND units<=32)');
  }
  interrupt(){this.storage.sql.exec("UPDATE background_text_usage SET status='failed' WHERE status='running'");}
  usage(period:string){
    return this.storage.sql.exec<{used:number;reserved:number}>(`SELECT COALESCE(SUM(CASE WHEN status='complete' THEN units ELSE 0 END),0) AS used,
      COALESCE(SUM(CASE WHEN status='running' THEN units ELSE 0 END),0) AS reserved FROM
      (SELECT status,1 AS units FROM turns WHERE period=? UNION ALL SELECT status,units FROM background_text_usage WHERE period=?)`,period,period).toArray()[0];
  }
  private access(access:Access){
    if(!access.period||access.period.length>256||![access.limit,access.attemptLimit].every(n=>Number.isSafeInteger(n)&&n>=0))throw unavailable();
  }
  reserve(id:string,userId:string,payloadHash:string,access:Access,units=1){
    this.access(access);
    if(!id||id.length>256||!userId||userId.length>256||!/^([a-f0-9]{64})$/.test(payloadHash))throw unavailable();
    if(!Number.isSafeInteger(units)||units<1||units>32)throw unavailable();
    return this.storage.transactionSync(()=>{
      const prior=this.storage.sql.exec<Reservation>('SELECT * FROM background_text_usage WHERE id=?',id).toArray()[0];
      if(prior&&(prior.user_id!==userId||prior.payload_hash!==payloadHash||prior.units!==units))throw unavailable();
      if(prior?.status==='complete')return {state:'complete' as const,token:prior.token,period:prior.period};
      if(prior?.status==='running')throw new HttpError(409,'analysis_running','This analysis is still running.');
      const counts=this.usage(access.period);
      if(units>access.limit-counts.used-counts.reserved)throw new HttpError(429,'usage_limit','Your included text allowance cannot cover this analysis.');
      const token=crypto.randomUUID();
      this.storage.sql.exec(`INSERT INTO background_text_usage(id,user_id,payload_hash,period,status,token,units) VALUES (?,?,?,?,'running',?,?)
        ON CONFLICT(id) DO UPDATE SET period=excluded.period,status='running',token=excluded.token`,id,userId,payloadHash,access.period,token,units);
      return {state:'reserved' as const,token,period:access.period};
    });
  }
  startAttempt(token:string,access:Access){
    this.access(access);
    return this.storage.transactionSync(()=>{
      const row=this.storage.sql.exec<Reservation>("SELECT * FROM background_text_usage WHERE token=? AND status='running'",token).toArray()[0];
      if(!row||row.period!==access.period)throw unavailable();
      const counts=this.usage(access.period);
      if(counts.used+counts.reserved>access.limit)throw new HttpError(429,'usage_limit','Your current text allowance cannot cover this reservation.');
      const key=`background:${token}`;
      if(this.storage.sql.exec('SELECT id FROM provider_attempts WHERE request_key=?',key).toArray().length)throw unavailable();
      const {n}=this.storage.sql.exec<{n:number}>('SELECT COUNT(*) AS n FROM provider_attempts WHERE period=?',access.period).toArray()[0];
      if(n>=access.attemptLimit)throw new HttpError(429,'provider_budget_limit','The provider attempt allowance has been reached.');
      const id=crypto.randomUUID();
      this.storage.sql.exec("INSERT INTO provider_attempts(id,user_id,request_key,period,status,started_at) VALUES (?,?,?,?,'started',?)",id,row.user_id,key,row.period,new Date().toISOString());
      return id;
    });
  }
  /** Completion belongs in the caller's transaction that persists the result.
   * Failed/interrupted provider attempts remain counted, including uncertain ones. */
  finish(token:string,success:boolean){
    this.storage.transactionSync(()=>{
      const row=this.storage.sql.exec<Reservation>("SELECT * FROM background_text_usage WHERE token=? AND status='running'",token).toArray()[0];
      if(!row)throw unavailable();
      const key=`background:${token}`;
      if(success&&!this.storage.sql.exec("SELECT id FROM provider_attempts WHERE request_key=? AND status='started'",key).toArray().length)throw unavailable();
      this.storage.sql.exec('UPDATE background_text_usage SET status=? WHERE token=?',success?'complete':'failed',token);
      this.storage.sql.exec("UPDATE provider_attempts SET status=? WHERE request_key=? AND status='started'",success?'succeeded':'failed',key);
    });
  }
}
