import type {Actor,Env} from '../env';
import {digest,HttpError} from '../http';
import {requireTenant} from '../permissions';
import {textAccess} from '../billing/text-access';
import {TextUsage} from '../billing/text-usage';
import {MailboxSync} from './mailbox-sync';
import {requireMailboxAccess} from './mailbox-runner';
import {mailTriageRequest,parseMailTriage,type MailTriageResult} from './mail-triage';
import {BusinessBrief} from '../business-brief';
import {conversationContext} from '../conversation-context';
import {z} from 'zod';
import {OPERATORS,requireMembership} from '../permissions';
import {connectionAuthorizationStamp} from './credentials';
import {GOOGLE_MAIL_OPERATIONS} from './google-mail';
import {MICROSOFT_MAIL_OPERATIONS} from './microsoft-mail';

/** Internal, review-only analysis. No sender, calendar tool or public route. */
export class MailboxTriage {
  constructor(private storage:DurableObjectStorage){}
  initialize(){
    this.storage.sql.exec('CREATE TABLE IF NOT EXISTS mailbox_triage_results(id TEXT PRIMARY KEY,value TEXT NOT NULL)');
    const columns=this.storage.sql.exec<{name:string}>('PRAGMA table_info(mailbox_triage_results)').toArray();
    for(const column of ['user_id','grant_id'])if(!columns.some(c=>c.name===column))this.storage.sql.exec(`ALTER TABLE mailbox_triage_results ADD COLUMN ${column} TEXT`);
    this.storage.sql.exec('CREATE INDEX IF NOT EXISTS mailbox_triage_directory ON mailbox_triage_results(user_id,grant_id,id)');
  }
  /** Read-only directory. No generation, credit reservation or external calls.
   * Scan a bounded page; invalidated records are withheld, not silently refreshed. */
  async list(env:Env,actor:Actor,grantId:string,agentGuard:()=>Promise<void>,after?:string){
    if(!z.string().uuid().safeParse(grantId).success||(after!==undefined&&!/^[a-f0-9]{64}$/.test(after)))
      throw new HttpError(400,'invalid_triage_cursor','Reload mailbox analyses.');
    const guard=async()=>{
      await agentGuard();await requireMembership(env,actor,OPERATORS);
      const grant=await env.AGENT_DB.prepare("SELECT provider FROM auth_provider_grants WHERE id=? AND tenant_scope=? AND user_id=? AND status='authorized' AND mailbox_paused=0")
        .bind(grantId,actor.tenantId,actor.userId).first<{provider:'google'|'microsoft'}>();
      if(!grant)throw new HttpError(403,'triage_access_unavailable','This mailbox analysis is unavailable.');
      return connectionAuthorizationStamp(env,actor,grantId,grant.provider,grant.provider==='google'?GOOGLE_MAIL_OPERATIONS.read:MICROSOFT_MAIL_OPERATIONS.read);
    };
    const authorization=await guard();
    const rows=this.storage.sql.exec<{id:string;value:string}>('SELECT id,value FROM mailbox_triage_results WHERE user_id=? AND grant_id=? AND id>? ORDER BY id LIMIT 11',actor.userId,grantId,after??'').toArray();
    const items=[];let withheld=0;
    const context=this.businessContext(),ledger=new MailboxSync(env,actor);
    for(const row of rows.slice(0,10)){
      try{
        const saved=JSON.parse(row.value) as MailTriageResult;
        const belongs=await env.AGENT_DB.prepare('SELECT id FROM agent_mailbox_sync WHERE id=? AND tenant_id=? AND grant_id=?').bind(saved.source.streamId,actor.tenantId,grantId).first();
        if(!belongs||JSON.stringify(saved.source.businessContext)!==JSON.stringify(context)){withheld++;continue;}
        const observed=await ledger.readText(saved.source.streamId,saved.source.messageId,saved.source.receipt);
        const validated=parseMailTriage(JSON.stringify({category:saved.category,priority:saved.priority,summary:saved.summary,evidence:saved.evidence.map(e=>({excerpt:e.excerpt}))}),{...observed,businessContext:context});
        items.push({id:row.id,category:validated.category,priority:validated.priority,summary:validated.summary,
          evidence:validated.evidence.map(e=>e.excerpt),observedAt:validated.source.observedAt,
          historicalContext:validated.historicalContext,extractionOmissions:validated.extractionOmissions,
          contextTruncated:context.truncated,requiresReview:true,authorizesActions:false});
      }catch(error){
        if(error instanceof HttpError&&![403,409].includes(error.status))throw error;
        if(!(error instanceof HttpError||error instanceof SyntaxError||error instanceof z.ZodError||error instanceof TypeError))throw error;
        withheld++;
      }
    }
    if(await guard()!==authorization)throw new HttpError(409,'triage_access_changed','Mailbox access changed. Reload analyses.');
    if(JSON.stringify(this.businessContext())!==JSON.stringify(context))throw new HttpError(409,'triage_context_changed','The business brief changed. Reload analyses.');
    return {items,withheld,nextCursor:rows.length>10?rows[9].id:undefined};
  }
  private businessContext(){
    const present=new BusinessBrief(this.storage).present();
    const details=conversationContext('',[],present,2000);
    return {briefRevision:present.brief.revision,reviewed:present.brief.confirmedAt!==null,
      details,truncated:JSON.parse(details).truncated as boolean};
  }
  async run(env:Env,actor:Actor,streamId:string,messageId:string,receipt:string,agentGuard:()=>Promise<void>):Promise<MailTriageResult> {
    const enabled=()=>{
      if(env.MAILBOX_TRIAGE_ENABLED!=='true'||env.MAILBOX_PROCESSING_ENABLED!=='true'||env.AI_ENABLED!=='true'||!env.AI||!env.AI_GATEWAY_ID)
        throw new HttpError(503,'mailbox_triage_disabled','Mailbox analysis is not enabled.');
    };
    enabled();await requireMailboxAccess(env,actor,agentGuard);
    const ledger=new MailboxSync(env,actor),observed=await ledger.readText(streamId,messageId,receipt);
    const stream=await env.AGENT_DB.prepare('SELECT grant_id FROM agent_mailbox_sync WHERE id=? AND tenant_id=?').bind(streamId,actor.tenantId).first<{grant_id:string}>();
    if(!stream)throw new HttpError(409,'triage_source_unavailable','This mailbox observation is unavailable.');
    const businessContext=this.businessContext(),source={...observed,businessContext};
    const checkContext=()=>{if(JSON.stringify(this.businessContext())!==JSON.stringify(businessContext))
      throw new HttpError(409,'triage_context_changed','The business brief changed. Retry the analysis with current details.');};
    const guard=async()=>{enabled();await requireMailboxAccess(env,actor,agentGuard,source.provider);};
    await guard();
    const request=mailTriageRequest(source),access=await textAccess(env,actor,await requireTenant(env,actor));
    const id=await digest(JSON.stringify(['mailbox-triage-v2',actor.userId,streamId,messageId,receipt,businessContext]));
    const payloadHash=await digest(JSON.stringify(source));
    const usage=new TextUsage(this.storage),reservation=usage.reserve(id,actor.userId,payloadHash,access);
    if(reservation.state==='complete'){
      await guard();await ledger.readText(streamId,messageId,receipt);
      checkContext();
      const saved=this.storage.sql.exec<{value:string}>('SELECT value FROM mailbox_triage_results WHERE id=?',id).toArray()[0];
      if(!saved)throw new HttpError(409,'triage_result_unavailable','This analysis needs service review.');
      return JSON.parse(saved.value) as MailTriageResult;
    }
    try {
      const current=await textAccess(env,actor,await requireTenant(env,actor));
      if(current.period!==access.period||current.limit!==access.limit||current.attemptLimit!==access.attemptLimit)
        throw new HttpError(409,'usage_period_changed','The analysis allowance changed. Retry the analysis.');
      await guard();await ledger.readText(streamId,messageId,receipt);await agentGuard();
      checkContext();
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
      checkContext();
      this.storage.transactionSync(()=>{
        usage.finish(reservation.token,true);
        this.storage.sql.exec('INSERT INTO mailbox_triage_results(id,value,user_id,grant_id) VALUES (?,?,?,?)',id,JSON.stringify(result),actor.userId,stream.grant_id);
      });
      return result;
    }catch(error){
      // A restart may already have retired the token. Never affect its replacement.
      try{usage.finish(reservation.token,false);}catch{}
      throw error;
    }
  }
}
