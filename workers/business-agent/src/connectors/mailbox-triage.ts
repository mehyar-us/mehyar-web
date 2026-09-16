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
import {planMailTriageChunks,parseMailTriageChunk,mailTriageSectionId} from './mail-triage-chunks';
import {validateMailTriageCoverage} from './mail-triage-coverage';
import {mailTriageAggregationRequest,parseMailTriageAggregation,aggregationTextCredits} from './mail-triage-aggregate';

/** Internal, review-only analysis. No sender, calendar tool or public route. */
export class MailboxTriage {
  constructor(private storage:DurableObjectStorage){}
  initialize(){
    this.storage.sql.exec('CREATE TABLE IF NOT EXISTS mailbox_triage_results(id TEXT PRIMARY KEY,value TEXT NOT NULL)');
    const columns=this.storage.sql.exec<{name:string}>('PRAGMA table_info(mailbox_triage_results)').toArray();
    for(const column of ['user_id','grant_id'])if(!columns.some(c=>c.name===column))this.storage.sql.exec(`ALTER TABLE mailbox_triage_results ADD COLUMN ${column} TEXT`);
    this.storage.sql.exec('CREATE INDEX IF NOT EXISTS mailbox_triage_directory ON mailbox_triage_results(user_id,grant_id,id)');
    this.storage.sql.exec('CREATE TABLE IF NOT EXISTS mailbox_triage_sections(id TEXT PRIMARY KEY,value TEXT NOT NULL,user_id TEXT NOT NULL,grant_id TEXT NOT NULL)');
    this.storage.sql.exec('CREATE TABLE IF NOT EXISTS mailbox_triage_aggregations(id TEXT PRIMARY KEY,value TEXT NOT NULL,user_id TEXT NOT NULL,grant_id TEXT NOT NULL)');
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
    const counts=await env.AGENT_DB.prepare(`SELECT COALESCE(SUM(q.state='pending'),0) AS pending,
      COALESCE(SUM(q.state='review_required'),0) AS needsReview,
      COALESCE(SUM(q.state='review_required' AND q.last_reason='long_message'),0) AS longMessages,
      COALESCE(SUM(q.state='review_required' AND q.last_reason='no_text'),0) AS unavailableText,
      COALESCE(SUM(q.state='review_required' AND q.last_reason='invalid_response'),0) AS invalidResponses
      FROM agent_mailbox_triage_queue q JOIN agent_mailbox_sync s ON s.id=q.stream_id
      JOIN agent_mailbox_messages m ON m.stream_id=q.stream_id AND m.message_id=q.message_id AND m.receipt_token=q.receipt_token
      WHERE s.tenant_id=? AND s.grant_id=? AND s.authorization=? AND m.state='present' AND m.needs_reconciliation=0
        AND q.state IN ('pending','review_required')`)
      .bind(actor.tenantId,grantId,authorization).first<{pending:number;needsReview:number;longMessages:number;unavailableText:number;invalidResponses:number}>();
    if(await guard()!==authorization)throw new HttpError(409,'triage_access_changed','Mailbox access changed. Reload analyses.');
    if(JSON.stringify(this.businessContext())!==JSON.stringify(context))throw new HttpError(409,'triage_context_changed','The business brief changed. Reload analyses.');
    return {items,withheld,nextCursor:rows.length>10?rows[9].id:undefined,queue:{...counts!,dispatchEnabled:
      env.MAILBOX_TRIAGE_DISPATCH_ENABLED==='true'&&env.MAILBOX_TRIAGE_ENABLED==='true'&&env.MAILBOX_PROCESSING_ENABLED==='true'&&env.MAILBOX_SYNC_ENABLED==='true'&&env.AI_ENABLED==='true'}};
  }
  private businessContext(){
    const present=new BusinessBrief(this.storage).present();
    const details=conversationContext('',[],present,2000);
    return {briefRevision:present.brief.revision,reviewed:present.brief.confirmedAt!==null,
      details,truncated:JSON.parse(details).truncated as boolean};
  }
  /** Internal resumable progress, not a whole-message summary or new inference. */
  async sections(env:Env,actor:Actor,streamId:string,messageId:string,receipt:string,agentGuard:()=>Promise<void>){
    if(env.MAILBOX_EXTENDED_TRIAGE_ENABLED!=='true')throw new HttpError(503,'extended_triage_disabled','Extended message analysis is not enabled.');
    await requireMailboxAccess(env,actor,agentGuard);
    const ledger=new MailboxSync(env,actor),observed=await ledger.readText(streamId,messageId,receipt);
    await requireMailboxAccess(env,actor,agentGuard,observed.provider);
    const businessContext=this.businessContext(),source={...observed,businessContext},plan=planMailTriageChunks(source);
    const completed:number[]=[],missing:number[]=[],values:unknown[]=[];
    for(const section of plan.chunks){
      if(!section.request)continue;
      const id=await mailTriageSectionId(actor.userId,section);
      const saved=this.storage.sql.exec<{value:string}>(`SELECT r.value FROM mailbox_triage_sections r
        JOIN background_text_usage u ON u.id=r.id WHERE r.id=? AND r.user_id=? AND u.user_id=? AND u.status='complete'`,id,actor.userId,actor.userId).toArray()[0];
      if(saved){values.push(JSON.parse(saved.value));completed.push(section.index);}else missing.push(section.index);
    }
    const coverage=missing.length?undefined:validateMailTriageCoverage(source,values);
    await requireMailboxAccess(env,actor,agentGuard,source.provider);await ledger.readText(streamId,messageId,receipt);await agentGuard();
    if(env.MAILBOX_EXTENDED_TRIAGE_ENABLED!=='true'||JSON.stringify(this.businessContext())!==JSON.stringify(businessContext))throw new HttpError(409,'triage_context_changed','The analysis context changed. Refresh progress.');
    return {sectionCount:plan.chunks.length,analysisCredits:plan.analysisCredits,aggregationCreditsIncluded:false as const,
      completedSections:completed,missingSections:missing,coverage};
  }
  async run(env:Env,actor:Actor,streamId:string,messageId:string,receipt:string,agentGuard:()=>Promise<void>,sectionIndex?:number,aggregate=false):Promise<MailTriageResult> {
    if(aggregate&&sectionIndex!==undefined)throw new HttpError(400,'invalid_triage_section','Aggregation cannot select a single section.');
    if(sectionIndex!==undefined&&!z.number().int().min(0).max(31).safeParse(sectionIndex).success)throw new HttpError(400,'invalid_triage_section','Select a valid message section.');
    const enabled=()=>{
      if((aggregate||sectionIndex!==undefined)&&env.MAILBOX_EXTENDED_TRIAGE_ENABLED!=='true')throw new HttpError(503,'extended_triage_disabled','Extended message analysis is not enabled.');
      if(env.MAILBOX_TRIAGE_ENABLED!=='true'||env.MAILBOX_PROCESSING_ENABLED!=='true'||env.AI_ENABLED!=='true'||!env.AI||!env.AI_GATEWAY_ID)
        throw new HttpError(503,'mailbox_triage_disabled','Mailbox analysis is not enabled.');
    };
    enabled();await requireMailboxAccess(env,actor,agentGuard);
    const ledger=new MailboxSync(env,actor),observed=await ledger.readText(streamId,messageId,receipt);
    const stream=await env.AGENT_DB.prepare('SELECT grant_id FROM agent_mailbox_sync WHERE id=? AND tenant_id=?').bind(streamId,actor.tenantId).first<{grant_id:string}>();
    if(!stream)throw new HttpError(409,'triage_source_unavailable','This mailbox observation is unavailable.');
    const businessContext=this.businessContext(),wholeSource={...observed,businessContext};
    const plan=sectionIndex===undefined?undefined:planMailTriageChunks(wholeSource);
    const section=plan?.chunks[sectionIndex!];
    if(sectionIndex!==undefined&&(!section||!section.request))throw new HttpError(422,'triage_section_unavailable','This section does not require or support model analysis.');
    const source=section?.source??wholeSource;
    const table=aggregate?'mailbox_triage_aggregations':section?'mailbox_triage_sections':'mailbox_triage_results';
    const checkContext=()=>{if(JSON.stringify(this.businessContext())!==JSON.stringify(businessContext))
      throw new HttpError(409,'triage_context_changed','The business brief changed. Retry the analysis with current details.');};
    const guard=async()=>{enabled();await requireMailboxAccess(env,actor,agentGuard,source.provider);};
    await guard();
    const progress=aggregate?await this.sections(env,actor,streamId,messageId,receipt,agentGuard):undefined;
    if(aggregate&&!progress?.coverage)throw new HttpError(409,'triage_coverage_incomplete','Complete every message section before aggregation.');
    const values=progress?.coverage?.sections.map(value=>({...value,sectionCount:progress.sectionCount}));
    const aggregation=values?mailTriageAggregationRequest(source,values):undefined;
    const request=aggregation?.request??mailTriageRequest(source),access=await textAccess(env,actor,await requireTenant(env,actor));
    const id=section?await mailTriageSectionId(actor.userId,section):await digest(JSON.stringify([aggregate?'mailbox-triage-aggregation-v1':'mailbox-triage-v2',actor.userId,streamId,messageId,receipt,businessContext]));
    const payloadHash=await digest(JSON.stringify(aggregation?{source,request}:source));
    const usage=new TextUsage(this.storage),reservation=usage.reserve(id,actor.userId,payloadHash,access,aggregation?aggregationTextCredits(aggregation):1);
    if(reservation.state==='complete'){
      await guard();await ledger.readText(streamId,messageId,receipt);
      checkContext();
      const saved=this.storage.sql.exec<{value:string}>(`SELECT value FROM ${table} WHERE id=?`,id).toArray()[0];
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
        {gateway:{id:env.AI_GATEWAY_ID!,skipCache:true,collectLog:false,metadata:{tenant_id:actor.tenantId,billing_domain:'business_agent',workload:aggregate?'mailbox_triage_aggregation':section?'mailbox_triage_section':'mailbox_triage'}},signal:AbortSignal.timeout(60_000)});
      const raw=typeof response==='object'&&response&&'choices' in response?response.choices?.[0]?.message?.content:null;
      let result:MailTriageResult;
      try{
        if(typeof raw!=='string')throw new Error();
        result=values?parseMailTriageAggregation(raw,source,values):section?{...parseMailTriageChunk(raw,section),sectionCount:plan!.chunks.length}:parseMailTriage(raw,source);
      }catch{throw new HttpError(502,'triage_invalid_response','The analysis response could not be verified.');}
      await guard();
      const delivery=await textAccess(env,actor,await requireTenant(env,actor));
      if(delivery.period!==access.period||delivery.limit!==access.limit)throw new HttpError(409,'usage_period_changed','The analysis allowance changed. Retry the analysis.');
      await ledger.readText(streamId,messageId,receipt);await agentGuard();
      checkContext();
      this.storage.transactionSync(()=>{
        usage.finish(reservation.token,true);
        this.storage.sql.exec(`INSERT INTO ${table}(id,value,user_id,grant_id) VALUES (?,?,?,?)`,id,JSON.stringify(result),actor.userId,stream.grant_id);
      });
      return result;
    }catch(error){
      // A restart may already have retired the token. Never affect its replacement.
      try{usage.finish(reservation.token,false);}catch{}
      throw error;
    }
  }
}
