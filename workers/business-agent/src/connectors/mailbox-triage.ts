import type {Actor,Env} from '../env';
import {digest,HttpError} from '../http';
import {requireTenant} from '../permissions';
import {textAccess} from '../billing/text-access';
import {TextUsage} from '../billing/text-usage';
import {MailboxSync} from './mailbox-sync';
import {requireMailboxAccess} from './mailbox-runner';
import {mailTriageRequest,parseMailTriage,type MailTriageResult} from './mail-triage';

/** Internal, review-only analysis. No sender, calendar tool or public route. */
export class MailboxTriage {
  constructor(private storage:DurableObjectStorage){}
  initialize(){this.storage.sql.exec('CREATE TABLE IF NOT EXISTS mailbox_triage_results(id TEXT PRIMARY KEY,value TEXT NOT NULL)');}
  async run(env:Env,actor:Actor,streamId:string,messageId:string,receipt:string,agentGuard:()=>Promise<void>):Promise<MailTriageResult> {
    const enabled=()=>{
      if(env.MAILBOX_TRIAGE_ENABLED!=='true'||env.MAILBOX_PROCESSING_ENABLED!=='true'||env.AI_ENABLED!=='true'||!env.AI||!env.AI_GATEWAY_ID)
        throw new HttpError(503,'mailbox_triage_disabled','Mailbox analysis is not enabled.');
    };
    enabled();await requireMailboxAccess(env,actor,agentGuard);
    const ledger=new MailboxSync(env,actor),source=await ledger.readText(streamId,messageId,receipt);
    const guard=async()=>{enabled();await requireMailboxAccess(env,actor,agentGuard,source.provider);};
    await guard();
    const request=mailTriageRequest(source),access=await textAccess(env,actor,await requireTenant(env,actor));
    const id=await digest(JSON.stringify(['mailbox-triage-v1',actor.userId,streamId,messageId,receipt]));
    const payloadHash=await digest(JSON.stringify(source));
    const usage=new TextUsage(this.storage),reservation=usage.reserve(id,actor.userId,payloadHash,access);
    if(reservation.state==='complete'){
      await guard();await ledger.readText(streamId,messageId,receipt);
      const saved=this.storage.sql.exec<{value:string}>('SELECT value FROM mailbox_triage_results WHERE id=?',id).toArray()[0];
      if(!saved)throw new HttpError(409,'triage_result_unavailable','This analysis needs service review.');
      return JSON.parse(saved.value) as MailTriageResult;
    }
    try {
      const current=await textAccess(env,actor,await requireTenant(env,actor));
      if(current.period!==access.period||current.limit!==access.limit||current.attemptLimit!==access.attemptLimit)
        throw new HttpError(409,'usage_period_changed','The analysis allowance changed. Retry the analysis.');
      await guard();await ledger.readText(streamId,messageId,receipt);await agentGuard();
      usage.startAttempt(reservation.token,current);
      const response=await env.AI!.run('@cf/openai/gpt-oss-120b',request,
        {gateway:{id:env.AI_GATEWAY_ID!,skipCache:true,collectLog:false,metadata:{tenant_id:actor.tenantId,billing_domain:'business_agent',workload:'mailbox_triage'}},signal:AbortSignal.timeout(60_000)});
      const raw=typeof response==='object'&&response&&'choices' in response?response.choices?.[0]?.message?.content:null;
      if(typeof raw!=='string')throw new Error('Invalid mailbox triage response');
      const result=parseMailTriage(raw,source);
      await guard();
      const delivery=await textAccess(env,actor,await requireTenant(env,actor));
      if(delivery.period!==access.period||delivery.limit!==access.limit)throw new HttpError(409,'usage_period_changed','The analysis allowance changed. Retry the analysis.');
      await ledger.readText(streamId,messageId,receipt);await agentGuard();
      this.storage.transactionSync(()=>{
        usage.finish(reservation.token,true);
        this.storage.sql.exec('INSERT INTO mailbox_triage_results(id,value) VALUES (?,?)',id,JSON.stringify(result));
      });
      return result;
    }catch(error){
      // A restart may already have retired the token. Never affect its replacement.
      try{usage.finish(reservation.token,false);}catch{}
      throw error;
    }
  }
}
