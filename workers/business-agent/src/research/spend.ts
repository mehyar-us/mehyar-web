import {HttpError} from '../http';
type Spend={job_id:string;period:string;quote_ref:string;reserved_micros:number;actual_micros:number|null;status:'reserved'|'dispatched'|'settled'|'released'};
const fail=(message:string)=>new HttpError(409,'research_spend_unavailable',message);
const amount=(value:number)=>Number.isSafeInteger(value)&&value>=0&&value<=1_000_000_000_000;

/** Internal USD-micro commitment ledger. Quotes and period budgets must come
 * from verified server pricing, never browser input or a model proposal. */
export class ResearchSpend {
  constructor(private storage:DurableObjectStorage){}
  initialize(){this.storage.sql.exec(`CREATE TABLE IF NOT EXISTS research_spend (
    job_id TEXT PRIMARY KEY,period TEXT NOT NULL,quote_ref TEXT NOT NULL,reserved_micros INTEGER NOT NULL,
    actual_micros INTEGER,status TEXT NOT NULL)`);}
  get(id:string){return this.storage.sql.exec<Spend>('SELECT * FROM research_spend WHERE job_id=?',id).toArray()[0]??null;}
  reserve(id:string,period:string,micros:number,budget:number,quoteRef:string){
    if(!id||!period||period.length>128||!quoteRef||quoteRef.length>200||!amount(micros)||micros===0||!amount(budget))throw fail('A verified positive supplier quote and bounded budget are required.');
    return this.storage.transactionSync(()=>{
      const prior=this.get(id);if(prior){if(prior.period!==period||prior.quote_ref!==quoteRef||prior.reserved_micros!==micros)throw fail('The supplier reservation has different terms.');return prior;}
      const {total}=this.storage.sql.exec<{total:number}>(`SELECT COALESCE(SUM(CASE WHEN status='settled' THEN actual_micros WHEN status IN ('reserved','dispatched') THEN reserved_micros ELSE 0 END),0) AS total FROM research_spend WHERE period=?`,period).one();
      if(total+micros>budget)throw fail('The supplier research budget is reserved or consumed.');
      this.storage.sql.exec("INSERT INTO research_spend(job_id,period,quote_ref,reserved_micros,status) VALUES(?,?,?,?,'reserved')",id,period,quoteRef,micros);return this.get(id)!;
    });
  }
  dispatch(id:string){
    if(this.get(id)?.status!=='reserved')throw fail('Supplier spending must be reserved before dispatch.');
    this.storage.sql.exec("UPDATE research_spend SET status='dispatched' WHERE job_id=?",id);
  }
  release(id:string){
    this.storage.sql.exec("UPDATE research_spend SET status='released' WHERE job_id=? AND status='reserved'",id);
    return this.get(id);
  }
  settle(id:string,actualMicros:number){
    if(!amount(actualMicros))throw fail('A valid reconciled supplier cost is required.');
    const prior=this.get(id);
    if(prior?.status==='settled'&&prior.actual_micros===actualMicros)return prior;
    if(prior?.status!=='dispatched')throw fail('Only dispatched supplier commitments can be reconciled.');
    // Record overruns in full so later admissions fail instead of hiding expense.
    this.storage.sql.exec("UPDATE research_spend SET status='settled',actual_micros=? WHERE job_id=?",actualMicros,id);return this.get(id)!;
  }
}
