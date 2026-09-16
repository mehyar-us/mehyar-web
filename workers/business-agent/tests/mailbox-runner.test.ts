import {env} from 'cloudflare:workers';
import {describe,it,expect,vi} from 'vitest';
import type {Env} from '../src/env';
import {createTenant} from '../src/tenants';
import {storeProviderGrant} from '../src/auth/vault';
import {CATALOG_VERSION} from '../src/catalog';
import {RELEASE_GATES} from '../src/billing/service';
import {MailboxSync} from '../src/connectors/mailbox-sync';
import {runMailboxPage} from '../src/connectors/mailbox-runner';
import {initializeGoogleMailbox} from '../src/connectors/mailbox-bootstrap';
import {consumeMailboxChange} from '../src/connectors/mailbox-consumer';
import {googleMailboxStatus,microsoftMailboxStatus} from '../src/connectors/mailbox-status';
import {runInDurableObject} from 'cloudflare:test';
import {getAgentByName} from 'agents';
import {FolderSessions} from '../src/connectors/folder-sessions';
import {connectedMailboxFolders,initializeMicrosoftFolders} from '../src/connectors/folder-access';
import {stopMailbox,resumeMailbox} from '../src/connectors/mailbox-control';
import {restartMailbox} from '../src/connectors/mailbox-restart';
import {MailboxRecoveryOffers} from '../src/connectors/mailbox-recovery-offers';
import {BusinessAgent,unwrap} from '../src/agent';
import {runMailboxTriageDispatch} from '../src/connectors/mailbox-triage-dispatch';
import {calibratedTextReservation} from '../src/billing/text-calibration';
const e={...env,MAILBOX_SYNC_ENABLED:'true',GOOGLE_ENABLED_CAPABILITIES:'gmail_read',MICROSOFT_ENABLED_CAPABILITIES:'mail_read'} as unknown as Env;
const guard=async()=>{};
async function fixture(provider:'google'|'microsoft'='google',createStream=true) {
  const userId=crypto.randomUUID();
  await e.AGENT_DB.prepare('INSERT INTO auth_user(id,name,email,createdAt,updatedAt) VALUES (?,?,?,?,?)')
    .bind(userId,'Fixture',`${userId}@example.test`,Date.now(),Date.now()).run();
  const tenant=await createTenant(e,userId,{name:'Mailbox runner'},crypto.randomUUID()),actor={userId,tenantId:tenant.id};
  const binding={...actor,provider,accountId:crypto.randomUUID()};
  const credential={accountEmail:'owner@example.test',accessToken:'fixture-access',refreshToken:'fixture-refresh',accessTokenExpiresAt:new Date(Date.now()+3600000).toISOString(),
    grantedScopes:provider==='google'?['https://www.googleapis.com/auth/gmail.readonly']:['Mail.Read']};
  const grantId=await storeProviderGrant(e,binding,credential,[]);
  await e.AGENT_DB.prepare("UPDATE agent_tenants SET status='active',plan_id='business' WHERE id=?").bind(tenant.id).run();
  await e.AGENT_DB.prepare("INSERT INTO agent_billing_subscriptions(tenant_id,stripe_subscription_id,plan_id,status,paid_through,updated_at,access_state,usage_anchor) VALUES (?,?,'business','active',?,?,'active',?)")
    .bind(tenant.id,'sub_'+crypto.randomUUID(),new Date(Date.now()+86400000).toISOString(),new Date().toISOString(),new Date(Date.now()-10000).toISOString()).run();
  for(const [scope,gates] of [['catalog',RELEASE_GATES],[tenant.id,['activation_approved']],[`connector:${provider}.mail.read`,['provider_approval','live_acceptance']]] as const)
    for(const gate of gates)await e.AGENT_DB.prepare("INSERT OR REPLACE INTO agent_billing_readiness(scope_id,gate,catalog_version,status,evidence_ref,verified_by,verified_at,valid_until) VALUES (?,?,?,'verified','fixture-only','test',?,?)")
      .bind(scope,gate,CATALOG_VERSION,new Date().toISOString(),new Date(Date.now()+86400000).toISOString()).run();
  const ledger=new MailboxSync(e,actor),streamId=createStream?await ledger.open(grantId,provider,provider==='google'?'mailbox':'inbox',provider==='google'?'200':undefined):'';
  return {actor,streamId,ledger,grantId,binding,credential};
}
async function changes(streamId:string) {return (await e.AGENT_DB.prepare('SELECT message_id,kind FROM agent_mailbox_changes WHERE stream_id=? ORDER BY created_at,ordinal').bind(streamId).all()).results;}
describe('one-page mailbox provider runner',()=>{
  it.each(['missing','mismatch'] as const)('releases multi-credit aggregation on %s usage and settles a verified retry once',async(failure)=>{
    vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-09-17T00:00:00Z'));
    try{
      const f=await fixture(),text='Please book Friday. '.repeat(1000);
      await f.ledger.commit((await f.ledger.claim(f.streamId))!,{changes:[{messageId:'metered',kind:'upsert'}],syncCursor:'300'});
      const claim=(await f.ledger.claimChange(f.streamId))!;
      await f.ledger.saveChange(claim,{provider:'google',id:'metered',content:{id:'metered',threadId:'t',payload:{mimeType:'text/plain',body:{size:text.length,data:btoa(text).replace(/=+$/,'')}}}});
      const stub=await getAgentByName(e.BUSINESS_AGENTS,f.actor.tenantId);
      await runInDurableObject(stub,async(instance:BusinessAgent,ctx)=>{
        const original=(instance as any).env;let calls=0,valid=false,requiredCredits=0;
        (instance as any).env={...e,MAILBOX_PROCESSING_ENABLED:'true',MAILBOX_TRIAGE_ENABLED:'true',MAILBOX_EXTENDED_TRIAGE_ENABLED:'true',AI_ENABLED:'true',AI_GATEWAY_ID:'mehyar-business-agent-dev',AI:{run:async(_model:string,input:any)=>{
          calls++;const data=JSON.parse(input.messages[1].content);
          if(data.sections){
            const meter=calibratedTextReservation(input,'mehyar-business-agent-dev');requiredCredits=meter.credits;expect(requiredCredits).toBeGreaterThan(1);
            expect(ctx.storage.sql.exec<{units:number}>("SELECT units FROM background_text_usage WHERE status='running'").toArray()).toEqual([{units:requiredCredits}]);
            const prompt=meter.inputTokens+(valid?0:-1);
            return {...(!valid&&failure==='missing'?{}:{usage:{prompt_tokens:prompt,completion_tokens:100,total_tokens:prompt+100}}),
              choices:[{message:{content:JSON.stringify({category:'appointment',priority:'routine',summary:'Review the booking inquiry.',evidenceIds:[0]})}}]};
          }
          return {choices:[{message:{content:JSON.stringify({category:'appointment',priority:'routine',summary:'\u0800'.repeat(1500),evidence:[{excerpt:data.emailText.slice(0,20)}]})}}]};
        }}};
        try{
          const initial=unwrap(await instance.mailboxSectionProgress(f.actor,f.streamId,'metered',claim.token));
          for(const index of initial.missingSections)unwrap(await instance.analyzeMailboxSection(f.actor,f.streamId,'metered',claim.token,index));
          const sectionCredits=initial.analysisCredits;expect(sectionCredits).toBe(4);
          expect(await instance.aggregateMailboxSections(f.actor,f.streamId,'metered',claim.token)).toMatchObject({ok:false,error:{code:'text_calibration_mismatch'}});
          expect(unwrap(await instance.usage(f.actor)).textCredits).toMatchObject({used:sectionCredits,reserved:0});
          expect(ctx.storage.sql.exec('SELECT id FROM mailbox_triage_aggregations').toArray()).toEqual([]);
          expect(ctx.storage.sql.exec("SELECT id FROM provider_attempts WHERE status='failed'").toArray()).toHaveLength(1);
          valid=true;const result=unwrap(await instance.aggregateMailboxSections(f.actor,f.streamId,'metered',claim.token));
          expect(unwrap(await instance.usage(f.actor)).textCredits).toMatchObject({used:sectionCredits+requiredCredits,reserved:0});
          expect(unwrap(await instance.aggregateMailboxSections(f.actor,f.streamId,'metered',claim.token))).toEqual(result);
          expect(calls).toBe(sectionCredits+2);
          expect(ctx.storage.sql.exec('SELECT attempt_id FROM text_provider_receipts').toArray()).toHaveLength(sectionCredits+2);
          expect(unwrap(await instance.mailboxAnalyses(f.actor,f.grantId)).items).toHaveLength(1);
        }finally{(instance as any).env=original;}
      });
    }finally{vi.useRealTimers();}
  });
  it('aggregates complete sections with durable credits, replay and source fencing',async()=>{
    const f=await fixture(),text='Please book Friday. '.repeat(500);
    await f.ledger.commit((await f.ledger.claim(f.streamId))!,{changes:[{messageId:'aggregate',kind:'upsert'}],syncCursor:'300'});
    const claim=(await f.ledger.claimChange(f.streamId))!;
    await f.ledger.saveChange(claim,{provider:'google',id:'aggregate',content:{id:'aggregate',threadId:'t',payload:{mimeType:'text/plain',body:{size:text.length,data:btoa(text).replace(/=+$/,'')}}}});
    const stub=await getAgentByName(e.BUSINESS_AGENTS,f.actor.tenantId);
    await runInDurableObject(stub,async(instance:BusinessAgent,ctx)=>{
      const original=(instance as any).env;let calls=0,mode='invalid';
      (instance as any).env={...e,MAILBOX_PROCESSING_ENABLED:'true',MAILBOX_TRIAGE_ENABLED:'true',MAILBOX_EXTENDED_TRIAGE_ENABLED:'true',AI_ENABLED:'true',AI_GATEWAY_ID:'fixture',AI:{run:async(_model:string,input:any,options:any)=>{
        calls++;const data=JSON.parse(input.messages[1].content);
        if(data.sections){
          expect(options.gateway.metadata.workload).toBe('mailbox_triage_aggregation');expect(data.sections).toHaveLength(2);
          if(mode==='stale')await e.AGENT_DB.prepare('UPDATE agent_mailbox_messages SET needs_reconciliation=1 WHERE stream_id=?').bind(f.streamId).run();
          return {choices:[{message:{content:JSON.stringify({category:'appointment',priority:'routine',summary:'Booking inquiry; review the timing.',evidenceIds:[mode==='invalid'?999:0]})}}]};
        }
        return {choices:[{message:{content:JSON.stringify({category:'appointment',priority:'routine',summary:'Booking in this section.',evidence:[{excerpt:data.emailText.slice(0,20)}]})}}]};
      }}};
      try{
        expect(await instance.aggregateMailboxSections(f.actor,f.streamId,'aggregate',claim.token)).toMatchObject({ok:false,error:{code:'triage_coverage_incomplete'}});expect(calls).toBe(0);
        for(const index of [0,1])unwrap(await instance.analyzeMailboxSection(f.actor,f.streamId,'aggregate',claim.token,index));
        expect(await instance.aggregateMailboxSections(f.actor,f.streamId,'aggregate',claim.token)).toMatchObject({ok:false,error:{code:'triage_invalid_response'}});
        expect(unwrap(await instance.usage(f.actor)).textCredits).toMatchObject({used:2,reserved:0});
        mode='stale';expect((await instance.aggregateMailboxSections(f.actor,f.streamId,'aggregate',claim.token)).ok).toBe(false);
        expect(ctx.storage.sql.exec('SELECT id FROM mailbox_triage_aggregations').toArray()).toEqual([]);
        expect(unwrap(await instance.usage(f.actor)).textCredits).toMatchObject({used:2,reserved:0});
        await e.AGENT_DB.prepare('UPDATE agent_mailbox_messages SET needs_reconciliation=0 WHERE stream_id=?').bind(f.streamId).run();
        mode='valid';const result=unwrap(await instance.aggregateMailboxSections(f.actor,f.streamId,'aggregate',claim.token));
        expect(result).toMatchObject({requiresReview:true,authorizesActions:false,aggregation:{basis:'validated_section_summaries',extractedTextCoverageComplete:true}});
        expect(unwrap(await instance.usage(f.actor)).textCredits).toMatchObject({used:3,reserved:0});
        expect(unwrap(await instance.aggregateMailboxSections(f.actor,f.streamId,'aggregate',claim.token))).toEqual(result);expect(calls).toBe(5);
        expect(ctx.storage.sql.exec('SELECT id FROM provider_attempts').toArray()).toHaveLength(5);
        const directory=unwrap(await instance.mailboxAnalyses(f.actor,f.grantId));
        expect(directory.items).toHaveLength(1);expect(directory.items[0]).toMatchObject({summary:result.summary,aggregation:{basis:'validated_section_summaries',sectionCount:2}});
        const saved=ctx.storage.sql.exec<{id:string;value:string}>('SELECT id,value FROM mailbox_triage_aggregations').toArray()[0];
        ctx.storage.sql.exec('UPDATE mailbox_triage_aggregations SET value=? WHERE id=?',JSON.stringify({...JSON.parse(saved.value),authorizesActions:true}),saved.id);
        expect(unwrap(await instance.mailboxAnalyses(f.actor,f.grantId))).toMatchObject({items:[],withheld:1});
        ctx.storage.sql.exec('UPDATE mailbox_triage_aggregations SET value=? WHERE id=?',saved.value,saved.id);
        (instance as any).env.MAILBOX_EXTENDED_TRIAGE_ENABLED='false';
        expect(unwrap(await instance.mailboxAnalyses(f.actor,f.grantId)).items).toHaveLength(1);expect(calls).toBe(5);
        await e.AGENT_DB.prepare('UPDATE agent_mailbox_messages SET needs_reconciliation=1 WHERE stream_id=?').bind(f.streamId).run();
        expect(unwrap(await instance.mailboxAnalyses(f.actor,f.grantId))).toMatchObject({items:[],withheld:1});
        expect(await instance.aggregateMailboxSections(f.actor,f.streamId,'aggregate',claim.token)).toMatchObject({ok:false,error:{code:'extended_triage_disabled'}});expect(calls).toBe(5);
      }finally{(instance as any).env=original;}
    });
  });
  it('resumes paid section analyses without exposing them as whole-message results',async()=>{
    const f=await fixture(),text='Please book Friday. '.repeat(500);
    await f.ledger.commit((await f.ledger.claim(f.streamId))!,{changes:[{messageId:'long',kind:'upsert'}],syncCursor:'300'});
    const claim=(await f.ledger.claimChange(f.streamId))!;
    await f.ledger.saveChange(claim,{provider:'google',id:'long',content:{id:'long',threadId:'t',payload:{mimeType:'text/plain',body:{size:text.length,data:btoa(text).replace(/=+$/,'')}}}});
    const stub=await getAgentByName(e.BUSINESS_AGENTS,f.actor.tenantId);
    await runInDurableObject(stub,async(instance:BusinessAgent,ctx)=>{
      const original=(instance as any).env;let calls=0;
      (instance as any).env={...e,MAILBOX_PROCESSING_ENABLED:'true',MAILBOX_TRIAGE_ENABLED:'true',MAILBOX_EXTENDED_TRIAGE_ENABLED:'true',AI_ENABLED:'true',AI_GATEWAY_ID:'fixture',AI:{run:async(_model:string,input:any)=>{
        calls++;const data=JSON.parse(input.messages[1].content);expect(data.coverage.total).toBe(text.trim().length);
        return {choices:[{message:{content:JSON.stringify({category:'appointment',priority:'routine',summary:'This section discusses booking.',evidence:[{excerpt:data.emailText.slice(0,20)}]})}}]};
      }}};
      try{
        const initial=unwrap(await instance.mailboxSectionProgress(f.actor,f.streamId,'long',claim.token));
        expect(initial).toMatchObject({analysisCredits:2,completedSections:[],missingSections:[0,1],aggregationCreditsIncluded:false});expect(initial.coverage).toBeUndefined();expect(calls).toBe(0);
        const section=unwrap(await instance.analyzeMailboxSection(f.actor,f.streamId,'long',claim.token,1));
        expect(section).toMatchObject({partial:true,sectionIndex:1});expect(section.sectionCount).toBeGreaterThan(1);
        expect(section.evidence[0].start).toBeGreaterThan(0);expect(text.slice(section.evidence[0].start,section.evidence[0].end)).toBe(section.evidence[0].excerpt);
        expect(unwrap(await instance.analyzeMailboxSection(f.actor,f.streamId,'long',claim.token,1))).toEqual(section);expect(calls).toBe(1);
        expect(unwrap(await instance.mailboxSectionProgress(f.actor,f.streamId,'long',claim.token))).toMatchObject({completedSections:[1],missingSections:[0]});expect(calls).toBe(1);
        await e.AGENT_DB.prepare('UPDATE agent_mailbox_messages SET needs_reconciliation=1 WHERE stream_id=?').bind(f.streamId).run();
        expect((await instance.analyzeMailboxSection(f.actor,f.streamId,'long',claim.token,1)).ok).toBe(false);expect(calls).toBe(1);
        expect((await instance.mailboxSectionProgress(f.actor,f.streamId,'long',claim.token)).ok).toBe(false);
        await e.AGENT_DB.prepare('UPDATE agent_mailbox_messages SET needs_reconciliation=0 WHERE stream_id=?').bind(f.streamId).run();
        unwrap(await instance.analyzeMailboxSection(f.actor,f.streamId,'long',claim.token,0));expect(calls).toBe(2);
        expect(unwrap(await instance.usage(f.actor)).textCredits).toMatchObject({used:2,reserved:0});
        expect(unwrap(await instance.mailboxAnalyses(f.actor,f.grantId)).items).toEqual([]);
        expect(ctx.storage.sql.exec<{n:number}>('SELECT COUNT(*) AS n FROM mailbox_triage_sections').toArray()[0].n).toBe(2);
        const complete=unwrap(await instance.mailboxSectionProgress(f.actor,f.streamId,'long',claim.token));
        expect(complete).toMatchObject({completedSections:[0,1],missingSections:[],coverage:{extractedTextCoverageComplete:true,wholeMessageConclusionAvailable:false}});expect(calls).toBe(2);
        const saved=ctx.storage.sql.exec<{id:string;value:string}>('SELECT id,value FROM mailbox_triage_sections LIMIT 1').toArray()[0];
        ctx.storage.sql.exec('UPDATE mailbox_triage_sections SET value=? WHERE id=?',JSON.stringify({...JSON.parse(saved.value),partial:false}),saved.id);
        expect((await instance.mailboxSectionProgress(f.actor,f.streamId,'long',claim.token)).ok).toBe(false);
        ctx.storage.sql.exec('UPDATE mailbox_triage_sections SET value=? WHERE id=?',saved.value,saved.id);
        unwrap(await instance.saveBusinessBrief(f.actor,{expectedRevision:0,reviewed:true,fields:{businessName:'Changed salon'}},crypto.randomUUID()));
        const changed=unwrap(await instance.mailboxSectionProgress(f.actor,f.streamId,'long',claim.token));expect(changed.completedSections).toEqual([]);expect(changed.missingSections.length).toBeGreaterThan(0);expect(changed.coverage).toBeUndefined();expect(calls).toBe(2);
        (instance as any).env.MAILBOX_EXTENDED_TRIAGE_ENABLED='false';
        expect(await instance.analyzeMailboxSection(f.actor,f.streamId,'long',claim.token,0)).toMatchObject({ok:false,error:{code:'extended_triage_disabled'}});
        expect(calls).toBe(2);
      }finally{(instance as any).env=original;}
    });
  });
  it.each([
    ['triage_long_message','review_required',1,'long_message'],
    ['triage_no_text','review_required',1,'no_text'],
    ['triage_invalid_response','review_required',1,'invalid_response'],
    ['usage_limit','pending',0,'allowance_unavailable'],
    ['provider_budget_limit','pending',0,'allowance_unavailable'],
    ['analysis_running','pending',0,'analysis_running'],
  ] as const)('classifies automatic triage failure %s without blind retries',async(code,state,attempts,reason)=>{
    await e.AGENT_DB.prepare("UPDATE agent_mailbox_triage_queue SET state='complete'").run();
    const f=await fixture();
    await f.ledger.commit((await f.ledger.claim(f.streamId))!,{changes:[{messageId:'queued',kind:'upsert'}],syncCursor:'300'});
    await f.ledger.saveChange((await f.ledger.claimChange(f.streamId))!,{provider:'google',id:'queued',content:{id:'queued',threadId:'t',payload:{}}});
    const ready={...e,MAILBOX_TRIAGE_DISPATCH_ENABLED:'true',MAILBOX_TRIAGE_ENABLED:'true',MAILBOX_PROCESSING_ENABLED:'true',AI_ENABLED:'true'};
    const time=Date.now();
    await runMailboxTriageDispatch(ready,async()=>({ok:false,error:{code}}),()=>time);
    expect(await e.AGENT_DB.prepare('SELECT state,attempts,last_reason FROM agent_mailbox_triage_queue WHERE stream_id=?').bind(f.streamId).first()).toEqual({state,attempts,last_reason:reason});
    expect(await runMailboxTriageDispatch(ready,async()=>{throw new Error('early retry');},()=>time+1000)).toMatchObject({selected:0});
  });
  it('leases automatic triage once and cannot acknowledge a superseding observation',async()=>{
    await e.AGENT_DB.prepare("UPDATE agent_mailbox_triage_queue SET state='complete'").run();
    const f=await fixture();
    await f.ledger.commit((await f.ledger.claim(f.streamId))!,{changes:[{messageId:'queued',kind:'upsert'}],syncCursor:'300'});
    const claim=(await f.ledger.claimChange(f.streamId))!;
    await f.ledger.saveChange(claim,{provider:'google',id:'queued',content:{id:'queued',threadId:'t',payload:{mimeType:'text/plain',body:{size:5,data:'SGVsbG8'}}}});
    const ready={...e,MAILBOX_TRIAGE_DISPATCH_ENABLED:'true',MAILBOX_TRIAGE_ENABLED:'true',MAILBOX_PROCESSING_ENABLED:'true',AI_ENABLED:'true'};
    expect(await runMailboxTriageDispatch({...ready,MAILBOX_TRIAGE_DISPATCH_ENABLED:'false'},async()=>{throw new Error('disabled');})).toMatchObject({disabled:true});
    let calls=0;
    const result=await runMailboxTriageDispatch(ready,async(actor,stream,message,receipt)=>{
      calls++;expect(actor).toEqual(f.actor);expect([stream,message,receipt]).toEqual([f.streamId,'queued',claim.token]);
      expect(await runMailboxTriageDispatch(ready,async()=>{throw new Error('overlap');})).toMatchObject({selected:0});
      await e.AGENT_DB.prepare("UPDATE agent_mailbox_triage_queue SET receipt_token='replacement',lease_token=NULL,lease_until=NULL,attempts=0 WHERE stream_id=?").bind(f.streamId).run();
      return {ok:true};
    });
    expect(calls).toBe(1);expect(result.complete).toBe(0);
    expect(await e.AGENT_DB.prepare('SELECT state,receipt_token,attempts FROM agent_mailbox_triage_queue WHERE stream_id=?').bind(f.streamId).first()).toEqual({state:'pending',receipt_token:'replacement',attempts:0});
  });
  it('backs off failed automatic analyses and stops after six attempts',async()=>{
    await e.AGENT_DB.prepare("UPDATE agent_mailbox_triage_queue SET state='complete'").run();
    const f=await fixture();
    await f.ledger.commit((await f.ledger.claim(f.streamId))!,{changes:[{messageId:'queued',kind:'upsert'}],syncCursor:'300'});
    await f.ledger.saveChange((await f.ledger.claimChange(f.streamId))!,{provider:'google',id:'queued',content:{id:'queued',threadId:'t',payload:{}}});
    const ready={...e,MAILBOX_TRIAGE_DISPATCH_ENABLED:'true',MAILBOX_TRIAGE_ENABLED:'true',MAILBOX_PROCESSING_ENABLED:'true',AI_ENABLED:'true'};
    let time=Date.now(),calls=0;
    for(let i=0;i<6;i++){
      expect(await runMailboxTriageDispatch(ready,async()=>{calls++;return {ok:false};},()=>time)).toMatchObject({selected:1,deferred:1});
      expect(await runMailboxTriageDispatch(ready,async()=>{throw new Error('early retry');},()=>time)).toMatchObject({selected:0});
      time+=86400000;
    }
    expect(calls).toBe(6);expect(await e.AGENT_DB.prepare('SELECT state,attempts FROM agent_mailbox_triage_queue WHERE stream_id=?').bind(f.streamId).first()).toEqual({state:'review_required',attempts:6});
  });
  it.each(['success','malformed','stopped','invalidated','brief_changed'] as const)('runs guarded budgeted triage with %s model completion',async(mode)=>{
    const f=await fixture();
    await f.ledger.commit((await f.ledger.claim(f.streamId))!,{changes:[{messageId:'message',kind:'upsert'}],syncCursor:'300'});
    const claim=(await f.ledger.claimChange(f.streamId))!;
    await f.ledger.saveChange(claim,{provider:'google',id:'message',content:{id:'message',threadId:'thread',payload:{mimeType:'text/plain',body:{size:5,data:'SGVsbG8'}}}});
    const stub=await getAgentByName(e.BUSINESS_AGENTS,f.actor.tenantId);
    await runInDurableObject(stub,async(instance:BusinessAgent,ctx)=>{
      const original=(instance as any).env;let calls=0;
      unwrap(await instance.saveBusinessBrief(f.actor,{expectedRevision:0,reviewed:true,fields:{businessName:'Reviewed salon',services:'Haircuts'}},crypto.randomUUID()));
      (instance as any).env={...e,MAILBOX_PROCESSING_ENABLED:'true',MAILBOX_TRIAGE_ENABLED:'true',AI_ENABLED:'true',AI_GATEWAY_ID:'fixture',AI:{run:async(_model:string,input:any,options:any)=>{
        calls++;expect(input.messages).toHaveLength(2);expect(options.gateway).toMatchObject({skipCache:true,collectLog:false,metadata:{tenant_id:f.actor.tenantId,workload:'mailbox_triage'}});
        const context=JSON.parse(input.messages[1].content).businessContext;
        expect(context).toMatchObject({briefRevision:calls===2&&mode==='brief_changed'?2:1,reviewed:true});
        expect(context.details).toContain('Reviewed salon');
        if(mode==='brief_changed'&&calls===1)unwrap(await instance.saveBusinessBrief(f.actor,{expectedRevision:1,reviewed:true,fields:{businessName:'Reviewed salon',services:'Haircuts and styling'}},crypto.randomUUID()));
        if(mode==='stopped')await stopMailbox(e,f.actor,f.grantId);
        if(mode==='invalidated')await e.AGENT_DB.prepare('UPDATE agent_mailbox_messages SET needs_reconciliation=1 WHERE stream_id=?').bind(f.streamId).run();
        return {choices:[{message:{content:mode==='malformed'?'invalid':JSON.stringify({category:'unknown',priority:'unknown',summary:'A greeting with no clear request.',evidence:[{excerpt:'Hello'}]})}}]};
      }}};
      try{
        const result=await instance.analyzeMailbox(f.actor,f.streamId,'message',claim.token);
        expect(calls).toBe(1);
        if(mode==='success'){
          expect(unwrap(result)).toMatchObject({requiresReview:true,authorizesActions:false,source:{receipt:claim.token},category:'unknown'});
          expect(await instance.analyzeMailbox(f.actor,f.streamId,'message',claim.token)).toEqual(result);expect(calls).toBe(1);
        }else expect(result.ok).toBe(false);
        expect(unwrap(await instance.usage(f.actor)).textCredits).toMatchObject({used:mode==='success'?1:0,reserved:0});
        expect(ctx.storage.sql.exec<{n:number}>('SELECT COUNT(*) AS n FROM provider_attempts').toArray()[0].n).toBe(1);
        expect(ctx.storage.sql.exec<{n:number}>('SELECT COUNT(*) AS n FROM mailbox_triage_results').toArray()[0].n).toBe(mode==='success'?1:0);
        if(mode==='brief_changed'){
          expect(result).toMatchObject({ok:false,error:{code:'triage_context_changed'}});
          const fresh=unwrap(await instance.analyzeMailbox(f.actor,f.streamId,'message',claim.token));
          expect(fresh.source.businessContext?.briefRevision).toBe(2);expect(calls).toBe(2);
          expect(unwrap(await instance.usage(f.actor)).textCredits).toMatchObject({used:1,reserved:0});
        }
        if(mode==='success'){
          (instance as any).env.AI_ENABLED='false';
          const directory=unwrap(await instance.mailboxAnalyses(f.actor,f.grantId));
          expect(directory.queue).toEqual({pending:1,needsReview:0,longMessages:0,unavailableText:0,invalidResponses:0,dispatchEnabled:false});
          await e.AGENT_DB.prepare("UPDATE agent_mailbox_triage_queue SET state='review_required',last_reason='long_message' WHERE stream_id=?").bind(f.streamId).run();
          expect(unwrap(await instance.mailboxAnalyses(f.actor,f.grantId)).queue).toMatchObject({pending:0,needsReview:1,longMessages:1});
          expect(directory).toMatchObject({withheld:0,items:[{summary:'A greeting with no clear request.',evidence:['Hello'],requiresReview:true,authorizesActions:false}]});
          expect(JSON.stringify(directory)).not.toContain(claim.token);expect(JSON.stringify(directory)).not.toContain(f.streamId);
          expect(await instance.mailboxAnalyses(f.actor,crypto.randomUUID())).toMatchObject({ok:false,error:{code:'triage_access_unavailable'}});
          expect(await instance.mailboxAnalyses(f.actor,f.grantId,'invalid')).toMatchObject({ok:false,error:{code:'invalid_triage_cursor'}});
          const saved=ctx.storage.sql.exec<{value:string}>('SELECT value FROM mailbox_triage_results WHERE id=?',directory.items[0].id).toArray()[0].value;
          for(let i=0;i<12;i++)ctx.storage.sql.exec('INSERT INTO mailbox_triage_results(id,value,user_id,grant_id) VALUES (?,?,?,?)',String(i).padStart(64,'0'),saved,f.actor.userId,f.grantId);
          const firstPage=unwrap(await instance.mailboxAnalyses(f.actor,f.grantId));
          expect(firstPage.items).toHaveLength(10);expect(firstPage.nextCursor).toBeDefined();
          const lastPage=unwrap(await instance.mailboxAnalyses(f.actor,f.grantId,firstPage.nextCursor));
          expect(lastPage.items).toHaveLength(3);expect(lastPage.nextCursor).toBeUndefined();
          expect(new Set([...firstPage.items,...lastPage.items].map(item=>item.id)).size).toBe(13);
          await e.AGENT_DB.prepare('UPDATE agent_mailbox_messages SET needs_reconciliation=1 WHERE stream_id=?').bind(f.streamId).run();
          const withheldPage=unwrap(await instance.mailboxAnalyses(f.actor,f.grantId));
          expect(withheldPage.queue).toMatchObject({pending:0,needsReview:0,longMessages:0});
          expect(withheldPage).toMatchObject({items:[],withheld:10});expect(withheldPage.nextCursor).toBeDefined();
          expect(unwrap(await instance.mailboxAnalyses(f.actor,f.grantId,withheldPage.nextCursor))).toMatchObject({items:[],withheld:3});
          expect(calls).toBe(1);expect(unwrap(await instance.usage(f.actor)).textCredits).toMatchObject({used:1,reserved:0});
        }
      }finally{(instance as any).env=original;}
    });
  });
  it('keeps triage inert without its own release flag',async()=>{
    const f=await fixture(),stub=await getAgentByName(e.BUSINESS_AGENTS,f.actor.tenantId);
    expect(await stub.analyzeMailbox(f.actor,f.streamId,'message',crypto.randomUUID())).toMatchObject({ok:false,error:{code:'mailbox_triage_disabled'}});
  });
  it('reports the oldest completed current-consent folder scan and withholds freshness until every folder completes',async()=>{
    const f=await fixture('microsoft');const second=await f.ledger.open(f.grantId,'microsoft','other-folder');
    await e.AGENT_DB.prepare('UPDATE agent_mailbox_sync SET last_completed_at=? WHERE id=?').bind('2026-09-16T10:00:00.000Z',f.streamId).run();
    expect(await microsoftMailboxStatus(e,f.actor,f.grantId,()=>false)).toMatchObject({lastCheckedAt:null});
    await e.AGENT_DB.prepare('UPDATE agent_mailbox_sync SET last_completed_at=? WHERE id=?').bind('2026-09-16T11:00:00.000Z',second).run();
    expect(await microsoftMailboxStatus(e,f.actor,f.grantId,()=>false)).toMatchObject({lastCheckedAt:'2026-09-16T10:00:00.000Z'});
    await storeProviderGrant(e,f.binding,f.credential,[]);
    expect(await microsoftMailboxStatus(e,f.actor,f.grantId,()=>false)).toMatchObject({lastCheckedAt:null});
  });
  it('prepares private recovery reviews and repeats the same confirmed request safely',async()=>{
    const f=await fixture('microsoft'),ready={...e,MAILBOX_RECOVERY_ENABLED:'true',MAILBOX_PROCESSING_ENABLED:'true'};
    await f.ledger.commit((await f.ledger.claim(f.streamId))!,{changes:[{messageId:'private-message',kind:'upsert'}],nextCursor:'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$skiptoken=private'});
    await e.AGENT_DB.prepare("UPDATE agent_mailbox_sync SET state='resync_required',display_name='Customer inquiries' WHERE id=?").bind(f.streamId).run();
    const stub=await getAgentByName(e.BUSINESS_AGENTS,f.actor.tenantId);
    await runInDurableObject(stub,async(_agent,ctx)=>{
      const offers=new MailboxRecoveryOffers(ctx.storage);offers.initialize();
      const offer=await offers.prepare(ready,f.actor,f.grantId,guard);
      expect(offer).toMatchObject({pendingReferences:1,cachedMessages:0,affectedStreams:1,targetLabel:'Customer inquiries'});
      expect(JSON.stringify(offer)).not.toContain('private');expect(JSON.stringify(offer)).not.toContain(f.streamId);
      await e.AGENT_DB.prepare("UPDATE agent_mailbox_sync SET display_name='Renamed folder' WHERE id=?").bind(f.streamId).run();
      expect(await offers.prepare(ready,f.actor,f.grantId,guard)).toEqual(offer);
      const noNetwork:typeof fetch=async()=>{throw new Error('unexpected network');};
      expect(await offers.execute(ready,f.actor,f.grantId,offer.recoveryId,guard,noNetwork)).toEqual({state:'restarted'});
      expect(await offers.execute(ready,f.actor,f.grantId,offer.recoveryId,guard,noNetwork)).toEqual({state:'restarted'});
      await expect(offers.prepare(ready,f.actor,f.grantId,guard)).rejects.toMatchObject({code:'mailbox_recovery_unneeded'});
    });
  });
  it('rejects foreign and expired recovery reviews before touching a provider',async()=>{
    const f=await fixture('google'),ready={...e,MAILBOX_RECOVERY_ENABLED:'true',MAILBOX_PROCESSING_ENABLED:'true'};
    await e.AGENT_DB.prepare("UPDATE agent_mailbox_sync SET state='resync_required' WHERE id=?").bind(f.streamId).run();
    const stub=await getAgentByName(e.BUSINESS_AGENTS,f.actor.tenantId);
    await runInDurableObject(stub,async(_agent,ctx)=>{
      const offers=new MailboxRecoveryOffers(ctx.storage);offers.initialize();const offer=await offers.prepare(ready,f.actor,f.grantId,guard);
      let reads=0;const transport:typeof fetch=async()=>{reads++;return Response.json({});};
      await expect(offers.execute(ready,{...f.actor,userId:'foreign'},f.grantId,offer.recoveryId,guard,transport)).rejects.toMatchObject({code:'mailbox_recovery_expired'});
      await expect(offers.execute(ready,f.actor,'foreign',offer.recoveryId,guard,transport)).rejects.toMatchObject({code:'mailbox_recovery_expired'});
      ctx.storage.sql.exec('UPDATE mailbox_recovery_offers SET expires=0');
      await expect(offers.execute(ready,f.actor,f.grantId,offer.recoveryId,guard,transport)).rejects.toMatchObject({code:'mailbox_recovery_expired'});
      expect(reads).toBe(0);
    });
  });
  it('captures a fresh Gmail recovery baseline once and replays completed requests without provider reads',async()=>{
    const f=await fixture(),ready={...e,MAILBOX_RECOVERY_ENABLED:'true',MAILBOX_PROCESSING_ENABLED:'true'},key=crypto.randomUUID();
    await e.AGENT_DB.prepare("UPDATE agent_mailbox_sync SET state='resync_required' WHERE id=?").bind(f.streamId).run();
    const round=(await e.AGENT_DB.prepare('SELECT round_id FROM agent_mailbox_sync WHERE id=?').bind(f.streamId).first<{round_id:string}>())!.round_id;
    let calls=0;const transport:typeof fetch=async input=>{calls++;expect(String(input)).toContain('/profile');return Response.json({emailAddress:'owner@example.test',historyId:'900'});};
    expect(await restartMailbox(ready,f.actor,f.streamId,key,round,guard,transport)).toEqual({state:'restarted'});
    const claim=(await f.ledger.claim(f.streamId))!;
    await f.ledger.commit(claim,{changes:[],nextCursor:'new-progress'});
    expect(await restartMailbox(ready,f.actor,f.streamId,key,round,guard,transport)).toEqual({state:'restarted'});
    expect(calls).toBe(1);
    expect(await e.AGENT_DB.prepare('SELECT checkpoint,page_cursor,sync_mode FROM agent_mailbox_sync WHERE id=?').bind(f.streamId).first()).toEqual({checkpoint:'900',page_cursor:'new-progress',sync_mode:'bootstrap'});
    await expect(restartMailbox(ready,f.actor,f.streamId,key,crypto.randomUUID(),guard,transport)).rejects.toBeDefined();expect(calls).toBe(1);
  });
  it('does not restart after an account stop during the recovery profile read',async()=>{
    const f=await fixture(),ready={...e,MAILBOX_RECOVERY_ENABLED:'true',MAILBOX_PROCESSING_ENABLED:'true'};
    await e.AGENT_DB.prepare("UPDATE agent_mailbox_sync SET state='resync_required' WHERE id=?").bind(f.streamId).run();
    const round=(await e.AGENT_DB.prepare('SELECT round_id FROM agent_mailbox_sync WHERE id=?').bind(f.streamId).first<{round_id:string}>())!.round_id;
    await expect(restartMailbox(ready,f.actor,f.streamId,crypto.randomUUID(),round,guard,async()=>{
      await stopMailbox(e,f.actor,f.grantId);return Response.json({emailAddress:'owner@example.test',historyId:'900'});
    })).rejects.toBeDefined();
    expect(await e.AGENT_DB.prepare('SELECT state,checkpoint FROM agent_mailbox_sync WHERE id=?').bind(f.streamId).first()).toEqual({state:'resync_required',checkpoint:'200'});
    expect(await e.AGENT_DB.prepare('SELECT COUNT(*) AS n FROM agent_mailbox_resync_receipts WHERE stream_id=?').bind(f.streamId).first()).toEqual({n:0});
  });
  it('restarts Graph through the guarded service without inventing a provider baseline',async()=>{
    const f=await fixture('microsoft'),ready={...e,MAILBOX_RECOVERY_ENABLED:'true',MAILBOX_PROCESSING_ENABLED:'true'};
    await e.AGENT_DB.prepare("UPDATE agent_mailbox_sync SET state='resync_required' WHERE id=?").bind(f.streamId).run();
    const round=(await e.AGENT_DB.prepare('SELECT round_id FROM agent_mailbox_sync WHERE id=?').bind(f.streamId).first<{round_id:string}>())!.round_id;
    expect(await restartMailbox(ready,f.actor,f.streamId,crypto.randomUUID(),round,guard,async()=>{throw new Error('unexpected network');})).toEqual({state:'restarted'});
    expect(await f.ledger.claim(f.streamId)).toMatchObject({checkpoint:null,pageCursor:null});
  });
  it('resumes with verified access and a matching control revision without resetting work',async()=>{
    const f=await fixture(),ready={...e,MAILBOX_RECOVERY_ENABLED:'true',MAILBOX_PROCESSING_ENABLED:'true'};
    await f.ledger.commit((await f.ledger.claim(f.streamId))!,{changes:[{messageId:'pending',kind:'upsert'}],nextCursor:'next'});
    await stopMailbox(e,f.actor,f.grantId);
    expect(await googleMailboxStatus(ready,f.actor,f.grantId,()=>false)).toMatchObject({state:'stopped',controlRevision:2,resumeEnabled:true,pending:1});
    expect(await resumeMailbox(ready,f.actor,f.grantId,2,guard)).toEqual({state:'resumed'});
    expect(await resumeMailbox(ready,f.actor,f.grantId,2,guard)).toEqual({state:'resumed'});
    expect(await e.AGENT_DB.prepare('SELECT checkpoint,page_cursor FROM agent_mailbox_sync WHERE id=?').bind(f.streamId).first()).toEqual({checkpoint:'200',page_cursor:'next'});
    expect(await f.ledger.claimChange(f.streamId)).not.toBeNull();
    await stopMailbox(e,f.actor,f.grantId);
    await expect(resumeMailbox(ready,f.actor,f.grantId,2,guard)).rejects.toMatchObject({code:'mailbox_control_changed'});
    expect(await googleMailboxStatus(ready,f.actor,f.grantId,()=>false)).toMatchObject({state:'stopped',controlRevision:4});
  });
  it('keeps stopped mailboxes stopped when processing or the owning Agent is unavailable',async()=>{
    const f=await fixture('microsoft');await stopMailbox(e,f.actor,f.grantId);
    await expect(resumeMailbox(e,f.actor,f.grantId,2,guard)).rejects.toMatchObject({code:'mailbox_setup_unavailable'});
    await expect(resumeMailbox({...e,MAILBOX_RECOVERY_ENABLED:'true',MAILBOX_PROCESSING_ENABLED:'true'},f.actor,f.grantId,2,async()=>{throw new Error('paused');})).rejects.toThrow('paused');
    expect(await microsoftMailboxStatus(e,f.actor,f.grantId,()=>false)).toMatchObject({state:'stopped',controlRevision:2,resumeEnabled:false});
  });
  it('summarizes current Outlook folders, bootstrap, pending work and recovery without private identifiers',async()=>{
    const f=await fixture('microsoft'),ready={...e,MAILBOX_RECOVERY_ENABLED:'true',MAILBOX_PROCESSING_ENABLED:'true'};
    const second=await f.ledger.open(f.grantId,'microsoft','private-folder');
    expect(await microsoftMailboxStatus(ready,f.actor,f.grantId,()=>false)).toEqual({state:'initializing',setupEnabled:false,pending:0,lastObservedAt:null,configuredFolders:2,lastCheckedAt:null});
    await f.ledger.commit((await f.ledger.claim(f.streamId))!,{changes:[{messageId:'private-message',kind:'upsert'}],syncCursor:'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=secret'});
    await f.ledger.commit((await f.ledger.claim(second))!,{changes:[],syncCursor:'https://graph.microsoft.com/v1.0/me/mailFolders/private-folder/messages/delta?$deltatoken=secret'});
    const status=await microsoftMailboxStatus(ready,f.actor,f.grantId,()=>false);
    expect(status).toEqual({state:'monitoring',setupEnabled:false,pending:1,lastObservedAt:null,configuredFolders:2,lastCheckedAt:expect.any(String)});
    expect(JSON.stringify(status)).not.toContain('private');expect(JSON.stringify(status)).not.toContain('secret');
    await e.AGENT_DB.prepare("UPDATE agent_mailbox_sync SET state='resync_required' WHERE id=?").bind(second).run();
    expect(await microsoftMailboxStatus(ready,f.actor,f.grantId,()=>false)).toMatchObject({state:'needs_attention'});
    expect(await microsoftMailboxStatus(ready,f.actor,f.grantId,()=>true)).toMatchObject({state:'paused'});
  });
  it('excludes old-consent Outlook progress and rejects foreign status requests',async()=>{
    const f=await fixture('microsoft'),other=await fixture('microsoft');
    await expect(microsoftMailboxStatus(e,other.actor,f.grantId,()=>false)).rejects.toMatchObject({code:'mailbox_not_found'});
    expect(await microsoftMailboxStatus(e,f.actor,f.grantId,()=>false)).toMatchObject({state:'disabled',configuredFolders:1});
    await storeProviderGrant(e,f.binding,f.credential,[]);
    expect(await microsoftMailboxStatus(e,f.actor,f.grantId,()=>false)).toMatchObject({state:'not_started',configuredFolders:0,pending:0});
    await e.AGENT_DB.prepare("UPDATE auth_provider_grants SET status='revoked' WHERE id=?").bind(f.grantId).run();
    expect(await microsoftMailboxStatus(e,f.actor,f.grantId,()=>false)).toMatchObject({state:'reconnect_required'});
  });
  it('configures only verified Outlook folders and preserves existing progress on repeated setup',async()=>{
    const f=await fixture('microsoft',false),stub=await getAgentByName(e.BUSINESS_AGENTS,f.actor.tenantId);
    const ready={...e,MAILBOX_RECOVERY_ENABLED:'true',MAILBOX_PROCESSING_ENABLED:'true'};
    await runInDurableObject(stub,async(_agent,ctx)=>{
      const sessions=new FolderSessions(ctx.storage);sessions.initialize();
      const inventory=await connectedMailboxFolders(e,f.actor,f.grantId,sessions,guard,undefined,async()=>Response.json({value:
        ['inbox','clients'].map(id=>({id,displayName:`Business ${id}`,parentFolderId:'root',childFolderCount:0,isHidden:false}))}));
      const configure=(ids:string[])=>initializeMicrosoftFolders(ready,f.actor,f.grantId,sessions,guard,inventory.inventoryId!,ids);
      await expect(configure(['invented'])).rejects.toMatchObject({code:'unknown_mailbox_folder'});
      expect(await configure(['inbox','clients'])).toEqual({state:'configured',configuredFolders:2});
      expect(await e.AGENT_DB.prepare("SELECT display_name FROM agent_mailbox_sync WHERE grant_id=? AND resource='clients'").bind(f.grantId).first()).toEqual({display_name:'Business clients'});
      await e.AGENT_DB.prepare("UPDATE agent_mailbox_sync SET state='resync_required',page_cursor='private-progress' WHERE grant_id=? AND resource='inbox'").bind(f.grantId).run();
      expect(await configure(['inbox','clients'])).toEqual({state:'configured',configuredFolders:2});
      expect(await e.AGENT_DB.prepare('SELECT COUNT(*) AS n FROM agent_mailbox_sync WHERE grant_id=?').bind(f.grantId).first()).toEqual({n:2});
      expect(await e.AGENT_DB.prepare("SELECT state,page_cursor FROM agent_mailbox_sync WHERE grant_id=? AND resource='inbox'").bind(f.grantId).first())
        .toEqual({state:'resync_required',page_cursor:'private-progress'});
    });
  });
  it('rolls back the whole Outlook selection when one folder insert fails',async()=>{
    const f=await fixture('microsoft',false),stub=await getAgentByName(e.BUSINESS_AGENTS,f.actor.tenantId);
    await runInDurableObject(stub,async(_agent,ctx)=>{
      const sessions=new FolderSessions(ctx.storage);sessions.initialize();
      const inventory=await connectedMailboxFolders(e,f.actor,f.grantId,sessions,guard,undefined,async()=>Response.json({value:
        ['first','fail-selection'].map(id=>({id,displayName:id,parentFolderId:'root',childFolderCount:0,isHidden:false}))}));
      await e.AGENT_DB.prepare("CREATE TRIGGER folder_setup_failure BEFORE INSERT ON agent_mailbox_sync WHEN NEW.resource='fail-selection' BEGIN SELECT RAISE(ABORT,'fixture insert failure'); END").run();
      try {
        await expect(initializeMicrosoftFolders({...e,MAILBOX_RECOVERY_ENABLED:'true',MAILBOX_PROCESSING_ENABLED:'true'},f.actor,f.grantId,sessions,guard,inventory.inventoryId!,['first','fail-selection'])).rejects.toBeDefined();
      } finally {await e.AGENT_DB.prepare('DROP TRIGGER folder_setup_failure').run();}
      expect(await e.AGENT_DB.prepare('SELECT COUNT(*) AS n FROM agent_mailbox_sync WHERE grant_id=?').bind(f.grantId).first()).toEqual({n:0});
    });
  });
  it('refuses Outlook setup while processing is disabled or discovery consent has changed',async()=>{
    const f=await fixture('microsoft',false),stub=await getAgentByName(e.BUSINESS_AGENTS,f.actor.tenantId);
    await runInDurableObject(stub,async(_agent,ctx)=>{
      const sessions=new FolderSessions(ctx.storage);sessions.initialize();
      const inventory=await connectedMailboxFolders(e,f.actor,f.grantId,sessions,guard,undefined,async()=>Response.json({value:
        [{id:'inbox',displayName:'Inbox',parentFolderId:'root',childFolderCount:0,isHidden:false}]}));
      await expect(initializeMicrosoftFolders(e,f.actor,f.grantId,sessions,guard,inventory.inventoryId!,['inbox'])).rejects.toMatchObject({code:'mailbox_setup_unavailable'});
      await storeProviderGrant(e,f.binding,f.credential,[]);
      await expect(initializeMicrosoftFolders({...e,MAILBOX_RECOVERY_ENABLED:'true',MAILBOX_PROCESSING_ENABLED:'true'},f.actor,f.grantId,sessions,guard,inventory.inventoryId!,['inbox'])).rejects.toMatchObject({code:'folder_inventory_expired'});
      expect(await e.AGENT_DB.prepare('SELECT COUNT(*) AS n FROM agent_mailbox_sync WHERE grant_id=?').bind(f.grantId).first()).toEqual({n:0});
    });
  });
  it('discovers current-account Outlook folders through real tenant storage without exposing provider cursors',async()=>{
    const f=await fixture('microsoft',false),stub=await getAgentByName(e.BUSINESS_AGENTS,f.actor.tenantId);
    await runInDurableObject(stub,async(_agent,ctx)=>{
      const sessions=new FolderSessions(ctx.storage);sessions.initialize();let calls=0;
      const transport:typeof fetch=async(input)=>{
        const url=new URL(String(input));expect(url.origin).toBe('https://graph.microsoft.com');calls++;
        return Response.json({value:[],...(calls<=5?{'@odata.nextLink':`https://graph.microsoft.com/v1.0/me/mailFolders?$skiptoken=private-${calls}`}:{})});
      };
      const first=await connectedMailboxFolders(e,f.actor,f.grantId,sessions,guard,undefined,transport);
      expect(first.incomplete).toBe(true);expect(JSON.stringify(first)).not.toContain('private-');
      const last=await connectedMailboxFolders(e,f.actor,f.grantId,sessions,guard,first.continuation,transport);
      expect(last.incomplete).toBe(false);expect(last.inventoryId).toBeTruthy();expect(calls).toBe(6);
      await expect(connectedMailboxFolders(e,f.actor,f.grantId,sessions,guard,first.continuation,transport)).rejects.toMatchObject({code:'folder_inventory_expired'});
      expect(calls).toBe(6);
    });
  });
  it('rejects disabled discovery, foreign grants and nonoperators before provider access',async()=>{
    const f=await fixture('microsoft',false),other=await fixture('microsoft',false),stub=await getAgentByName(e.BUSINESS_AGENTS,f.actor.tenantId);
    await runInDurableObject(stub,async(_agent,ctx)=>{
      const sessions=new FolderSessions(ctx.storage);sessions.initialize();let calls=0;
      const transport:typeof fetch=async()=>{calls++;return Response.json({value:[]});};
      await expect(connectedMailboxFolders({...e,MAILBOX_SYNC_ENABLED:'false'},f.actor,f.grantId,sessions,guard,undefined,transport)).rejects.toMatchObject({code:'mailbox_sync_disabled'});
      await expect(connectedMailboxFolders(e,f.actor,other.grantId,sessions,guard,undefined,transport)).rejects.toMatchObject({code:'mailbox_not_found'});
      await e.AGENT_DB.prepare("UPDATE agent_memberships SET role='billing' WHERE tenant_id=? AND user_id=?").bind(f.actor.tenantId,f.actor.userId).run();
      await expect(connectedMailboxFolders(e,f.actor,f.grantId,sessions,guard,undefined,transport)).rejects.toBeDefined();
      expect(calls).toBe(0);
    });
  });
  it('withholds Outlook folder results when consent changes during provider access',async()=>{
    const f=await fixture('microsoft',false),stub=await getAgentByName(e.BUSINESS_AGENTS,f.actor.tenantId);
    await runInDurableObject(stub,async(_agent,ctx)=>{
      const sessions=new FolderSessions(ctx.storage);sessions.initialize();
      await expect(connectedMailboxFolders(e,f.actor,f.grantId,sessions,guard,undefined,async()=>{
        await storeProviderGrant(e,f.binding,f.credential,[]);return Response.json({value:[]});
      })).rejects.toMatchObject({code:'mailbox_authorization_changed'});
      expect(ctx.storage.sql.exec('SELECT * FROM mailbox_folder_sessions').toArray()).toEqual([]);
    });
  });
  it('checks the live Agent guard after provider access and before committing discovery',async()=>{
    const f=await fixture('microsoft',false),stub=await getAgentByName(e.BUSINESS_AGENTS,f.actor.tenantId);
    await runInDurableObject(stub,async(_agent,ctx)=>{
      const sessions=new FolderSessions(ctx.storage);sessions.initialize();let paused=false;
      await expect(connectedMailboxFolders(e,f.actor,f.grantId,sessions,async()=>{if(paused)throw new Error('paused');},undefined,
        async()=>{paused=true;return Response.json({value:[]});})).rejects.toThrow('paused');
      expect(ctx.storage.sql.exec('SELECT * FROM mailbox_folder_sessions').toArray()).toEqual([]);
    });
  });
  it('enforces tenant binding and the disabled flag at the actual folder Agent RPC',async()=>{
    const f=await fixture('microsoft',false),other=await fixture('microsoft',false),stub=await getAgentByName(e.BUSINESS_AGENTS,f.actor.tenantId);
    expect(await stub.mailboxFolders(other.actor,other.grantId)).toMatchObject({ok:false,error:{code:'agent_mismatch'}});
    expect(await stub.mailboxFolders(f.actor,f.grantId)).toMatchObject({ok:false,error:{code:'mailbox_sync_disabled'}});
  });
  it('reports setup eligibility only after activation and all mailbox gates',async()=>{
    const f=await fixture('google',false);
    expect(await googleMailboxStatus(e,f.actor,f.grantId,()=>false)).toEqual({state:'not_started',setupEnabled:false,pending:0,lastObservedAt:null,lastCheckedAt:null});
    expect(await googleMailboxStatus({...e,MAILBOX_RECOVERY_ENABLED:'true',MAILBOX_PROCESSING_ENABLED:'true'},f.actor,f.grantId,()=>false))
      .toEqual({state:'not_started',setupEnabled:true,pending:0,lastObservedAt:null,lastCheckedAt:null});
    expect(await googleMailboxStatus(e,f.actor,f.grantId,()=>true)).toMatchObject({state:'paused',setupEnabled:false});
  });
  it('reports pending work without exposing cursors, message content or provider identifiers',async()=>{
    const f=await fixture();await f.ledger.commit((await f.ledger.claim(f.streamId))!,{changes:[{messageId:'private-message',kind:'upsert'}],nextCursor:'private-cursor'});
    const status=await googleMailboxStatus(e,f.actor,f.grantId,()=>false);
    expect(status).toEqual({state:'disabled',setupEnabled:false,pending:1,lastObservedAt:null,lastCheckedAt:null});
    expect(JSON.stringify(status)).not.toContain('private');expect(JSON.stringify(status)).not.toContain(f.streamId);
    await e.AGENT_DB.prepare("UPDATE agent_mailbox_sync SET state='resync_required' WHERE id=?").bind(f.streamId).run();
    expect(await googleMailboxStatus(e,f.actor,f.grantId,()=>false)).toMatchObject({state:'needs_attention'});
  });
  it('does not show old-consent progress as the current mailbox and reports revocation',async()=>{
    const f=await fixture();await f.ledger.commit((await f.ledger.claim(f.streamId))!,{changes:[{messageId:'old',kind:'upsert'}],syncCursor:'300'});
    await storeProviderGrant(e,f.binding,f.credential,[]);
    expect(await googleMailboxStatus(e,f.actor,f.grantId,()=>false)).toMatchObject({state:'not_started',pending:0});
    await e.AGENT_DB.prepare("UPDATE auth_provider_grants SET status='revoked' WHERE id=?").bind(f.grantId).run();
    expect(await googleMailboxStatus(e,f.actor,f.grantId,()=>false)).toMatchObject({state:'reconnect_required',setupEnabled:false});
  });
  it('rejects foreign accounts and nonoperator mailbox status reads',async()=>{
    const f=await fixture(),other=await fixture();
    await expect(googleMailboxStatus(e,other.actor,f.grantId,()=>false)).rejects.toMatchObject({code:'mailbox_not_found'});
    await e.AGENT_DB.prepare("UPDATE agent_memberships SET role='billing' WHERE tenant_id=? AND user_id=?").bind(f.actor.tenantId,f.actor.userId).run();
    await expect(googleMailboxStatus(e,f.actor,f.grantId,()=>false)).rejects.toMatchObject({code:'permission_denied'});
  });
  it('processes queued Gmail references from current state and atomically acknowledges them',async()=>{
    const f=await fixture();
    await f.ledger.commit((await f.ledger.claim(f.streamId))!,{changes:[{messageId:'a',kind:'delete'}],syncCursor:'300'});
    const snapshot={id:'a',threadId:'t',payload:{mimeType:'text/plain',headers:[{name:'Subject',value:'Private inquiry'}],body:{data:'aGVsbG8'}}};
    expect(await consumeMailboxChange({...e,MAILBOX_PROCESSING_ENABLED:'true'},f.actor,f.streamId,guard,async input=>{
      expect(String(input)).toContain('/messages/a?format=full');return Response.json(snapshot);
    })).toEqual({state:'processed'});
    const cached=await e.AGENT_DB.prepare('SELECT state,content_json,source_mode FROM agent_mailbox_messages WHERE stream_id=?').bind(f.streamId).first<{state:string;content_json:string;source_mode:string}>();
    expect(cached).toMatchObject({state:'present',source_mode:'incremental'});expect(JSON.parse(cached!.content_json)).toEqual(snapshot);
    expect(await f.ledger.claimChange(f.streamId)).toBeNull();
    expect(await e.AGENT_DB.prepare('SELECT state FROM agent_mailbox_changes WHERE stream_id=?').bind(f.streamId).first()).toEqual({state:'applied'});
  });
  it('reconciles Outlook absence only within the selected folder',async()=>{
    const f=await fixture('microsoft');
    await f.ledger.commit((await f.ledger.claim(f.streamId))!,{changes:[{messageId:'a',kind:'delete'}],syncCursor:'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=x'});
    expect(await consumeMailboxChange({...e,MAILBOX_PROCESSING_ENABLED:'true'},f.actor,f.streamId,guard,async input=>{
      expect(new URL(String(input)).pathname).toBe('/v1.0/me/mailFolders/inbox/messages/a');return Response.json({}, {status:404});
    })).toEqual({state:'processed'});
    expect(await e.AGENT_DB.prepare('SELECT state,content_json,source_mode FROM agent_mailbox_messages WHERE stream_id=?').bind(f.streamId).first())
      .toEqual({state:'missing',content_json:null,source_mode:'bootstrap'});
  });
  it('keeps a reference pending on a mismatched provider receipt and requires review',async()=>{
    const f=await fixture();await f.ledger.commit((await f.ledger.claim(f.streamId))!,{changes:[{messageId:'a',kind:'upsert'}],syncCursor:'300'});
    expect(await consumeMailboxChange({...e,MAILBOX_PROCESSING_ENABLED:'true'},f.actor,f.streamId,guard,async()=>Response.json({id:'wrong',threadId:'t',payload:{}})))
      .toEqual({state:'review_required'});
    expect(await e.AGENT_DB.prepare('SELECT state FROM agent_mailbox_changes WHERE stream_id=?').bind(f.streamId).first()).toEqual({state:'pending'});
    expect(await e.AGENT_DB.prepare('SELECT COUNT(*) AS n FROM agent_mailbox_messages WHERE stream_id=?').bind(f.streamId).first()).toEqual({n:0});
  });
  it('withholds a message and its acknowledgment if the agent is paused during retrieval',async()=>{
    const f=await fixture();await f.ledger.commit((await f.ledger.claim(f.streamId))!,{changes:[{messageId:'a',kind:'upsert'}],syncCursor:'300'});
    let paused=false;
    await expect(consumeMailboxChange({...e,MAILBOX_PROCESSING_ENABLED:'true'},f.actor,f.streamId,async()=>{if(paused)throw new Error('paused');},async()=>{
      paused=true;return Response.json({id:'a',threadId:'t',payload:{}});
    })).rejects.toBeDefined();
    expect(await e.AGENT_DB.prepare('SELECT state FROM agent_mailbox_changes WHERE stream_id=?').bind(f.streamId).first()).toEqual({state:'pending'});
    expect(await e.AGENT_DB.prepare('SELECT COUNT(*) AS n FROM agent_mailbox_messages WHERE stream_id=?').bind(f.streamId).first()).toEqual({n:0});
  });
  it('finishes an empty Gmail bootstrap without inventing a newer baseline',async()=>{
    const f=await fixture('google',false);
    const {streamId}=await initializeGoogleMailbox(e,f.actor,f.grantId,guard,async()=>Response.json({emailAddress:'owner@example.test',historyId:'200'}));
    expect(await runMailboxPage(e,f.actor,streamId,guard,async()=>Response.json({resultSizeEstimate:0}))).toEqual({state:'saved',changes:0,hasMore:false});
    expect(await e.AGENT_DB.prepare('SELECT sync_mode,checkpoint FROM agent_mailbox_sync WHERE id=?').bind(streamId).first()).toEqual({sync_mode:'incremental',checkpoint:'200'});
    expect(await f.ledger.claim(streamId)).not.toBeNull();
  });
  it('rejects a bootstrap commit that tries to skip the captured baseline',async()=>{
    const f=await fixture('google',false);
    const {streamId}=await initializeGoogleMailbox(e,f.actor,f.grantId,guard,async()=>Response.json({emailAddress:'owner@example.test',historyId:'200'}));
    const claim=(await f.ledger.claim(streamId))!;
    await expect(f.ledger.commit(claim,{changes:[],syncCursor:'300'})).rejects.toMatchObject({code:'mailbox_sync_unavailable'});
    expect(await f.ledger.commit(claim,{changes:[],syncCursor:'200'})).toBe(true);
  });
  it('initializes Gmail before enumeration, resumes its pages and catches up from the original baseline',async()=>{
    const f=await fixture('google',false);let calls=0;
    const transport:typeof fetch=async input=>{
      const url=new URL(String(input));calls++;
      if(calls===1){expect(url.pathname.endsWith('/profile')).toBe(true);return Response.json({emailAddress:'owner@example.test',historyId:'200'});}
      if(calls===2){expect(url.pathname.endsWith('/messages')).toBe(true);expect(url.searchParams.get('includeSpamTrash')).toBe('true');return Response.json({messages:[{id:'a',threadId:'t'}],nextPageToken:'page-two'});}
      if(calls===3){expect(url.searchParams.get('pageToken')).toBe('page-two');return Response.json({messages:[{id:'b',threadId:'t'}]});}
      expect(url.pathname.endsWith('/history')).toBe(true);expect(url.searchParams.get('startHistoryId')).toBe('200');
      return Response.json({historyId:'300',history:[{id:'250',messagesDeleted:[{message:{id:'a',threadId:'t'}}]}]});
    };
    const {streamId}=await initializeGoogleMailbox(e,f.actor,f.grantId,guard,transport);
    expect(await initializeGoogleMailbox(e,f.actor,f.grantId,guard,transport)).toEqual({streamId});expect(calls).toBe(1);
    expect(await runMailboxPage(e,f.actor,streamId,guard,transport)).toEqual({state:'saved',changes:1,hasMore:true});
    expect(await e.AGENT_DB.prepare('SELECT sync_mode,checkpoint,page_cursor FROM agent_mailbox_sync WHERE id=?').bind(streamId).first())
      .toEqual({sync_mode:'bootstrap',checkpoint:'200',page_cursor:'page-two'});
    expect(await runMailboxPage(e,f.actor,streamId,guard,transport)).toEqual({state:'saved',changes:1,hasMore:false});
    expect(await e.AGENT_DB.prepare('SELECT sync_mode,checkpoint FROM agent_mailbox_sync WHERE id=?').bind(streamId).first()).toEqual({sync_mode:'incremental',checkpoint:'200'});
    expect(await runMailboxPage(e,f.actor,streamId,guard,transport)).toEqual({state:'saved',changes:1,hasMore:false});
    expect(calls).toBe(4);expect(await changes(streamId)).toContainEqual({message_id:'a',kind:'delete'});
    const origins=(await e.AGENT_DB.prepare('SELECT source_mode,COUNT(*) AS n FROM agent_mailbox_sync_pages WHERE stream_id=? GROUP BY source_mode ORDER BY source_mode').bind(streamId).all()).results;
    expect(origins).toEqual([{source_mode:'bootstrap',n:2},{source_mode:'incremental',n:1}]);
  });
  it.each([{emailAddress:'other@example.test',historyId:'200'},{emailAddress:'owner@example.test',historyId:200},null])('rejects an invalid or mismatched Gmail profile: %j',async profile=>{
    const f=await fixture('google',false);
    await expect(initializeGoogleMailbox(e,f.actor,f.grantId,guard,async()=>Response.json(profile))).rejects.toMatchObject({kind:'invalid_response'});
    expect(await f.ledger.existing(f.grantId,'google','mailbox')).toBeNull();
  });
  it('withholds initialization after consent changes during the profile request',async()=>{
    const f=await fixture('google',false);
    await expect(initializeGoogleMailbox(e,f.actor,f.grantId,guard,async()=>{
      await storeProviderGrant(e,f.binding,f.credential,[]);return Response.json({emailAddress:'owner@example.test',historyId:'200'});
    })).rejects.toMatchObject({code:'mailbox_authorization_changed'});
    expect(await f.ledger.existing(f.grantId,'google','mailbox')).toBeNull();
  });
  it('keeps the baseline and requires recovery when a bootstrap page is malformed',async()=>{
    const f=await fixture('google',false);
    const {streamId}=await initializeGoogleMailbox(e,f.actor,f.grantId,guard,async()=>Response.json({emailAddress:'owner@example.test',historyId:'200'}));
    expect(await runMailboxPage(e,f.actor,streamId,guard,async()=>Response.json({messages:[{}]}))).toEqual({state:'resync_required'});
    expect(await changes(streamId)).toEqual([]);
    expect(await e.AGENT_DB.prepare('SELECT sync_mode,checkpoint FROM agent_mailbox_sync WHERE id=?').bind(streamId).first()).toEqual({sync_mode:'bootstrap',checkpoint:'200'});
  });
  it('stops the twelfth transient failure for recovery rather than scheduling another retry',async()=>{
    const f=await fixture();
    await e.AGENT_DB.prepare('UPDATE agent_mailbox_sync SET consecutive_attempts=11 WHERE id=?').bind(f.streamId).run();
    expect(await runMailboxPage(e,f.actor,f.streamId,guard,async()=>Response.json({}, {status:503}))).toEqual({state:'resync_required'});
    expect(await f.ledger.claim(f.streamId)).toBeNull();
    expect(await changes(f.streamId)).toEqual([]);
  });
  it('resumes Gmail pages, preserves deletions and deduplicates general/specific history references',async()=>{
    const f=await fixture();let calls=0;
    const transport:typeof fetch=async(input,init)=>{
      calls++;const url=new URL(String(input));expect(url.searchParams.get('startHistoryId')).toBe('200');expect(init?.method).toBe('GET');
      if(calls===1)return Response.json({historyId:'300',nextPageToken:'second',history:[{id:'250',messages:[{id:'a',threadId:'t'}],messagesAdded:[{message:{id:'a',threadId:'t'}}],messagesDeleted:[{message:{id:'b',threadId:'t'}}]}]});
      expect(url.searchParams.get('pageToken')).toBe('second');return Response.json({historyId:'301'});
    };
    expect(await runMailboxPage(e,f.actor,f.streamId,guard,transport)).toEqual({state:'saved',changes:2,hasMore:true});
    expect(await runMailboxPage(e,f.actor,f.streamId,guard,transport)).toEqual({state:'saved',changes:0,hasMore:false});
    expect(calls).toBe(2);expect(await changes(f.streamId)).toEqual([{message_id:'a',kind:'upsert'},{message_id:'b',kind:'delete'}]);
    expect(await f.ledger.claim(f.streamId)).toBeNull();
    expect(await e.AGENT_DB.prepare('SELECT checkpoint,page_cursor FROM agent_mailbox_sync WHERE id=?').bind(f.streamId).first()).toEqual({checkpoint:'301',page_cursor:null});
  });
  it('reads Graph bootstrap and persists folder removal references without copying bodies',async()=>{
    const f=await fixture('microsoft');
    const result=await runMailboxPage(e,f.actor,f.streamId,guard,async()=>Response.json({value:[{id:'a',body:{content:'private'}},{id:'b','@removed':{reason:'changed'}}],
      '@odata.deltaLink':'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=private'}));
    expect(result).toEqual({state:'saved',changes:2,hasMore:false});
    expect(JSON.stringify(result)).not.toContain('private');
    expect(await changes(f.streamId)).toEqual([{message_id:'a',kind:'upsert'},{message_id:'b',kind:'delete'}]);
    expect((await e.AGENT_DB.prepare('SELECT source_mode FROM agent_mailbox_sync_pages WHERE stream_id=?').bind(f.streamId).all()).results)
      .toEqual([{source_mode:'bootstrap'}]);
  });
  it.each(['disabled','capability','billing','readiness','pause'] as const)('does not contact the provider when %s is unavailable',async condition=>{
    const f=await fixture();let calls=0;
    if(condition==='billing')await e.AGENT_DB.prepare("UPDATE agent_billing_subscriptions SET access_state='suspended' WHERE tenant_id=?").bind(f.actor.tenantId).run();
    if(condition==='readiness')await e.AGENT_DB.prepare("DELETE FROM agent_billing_readiness WHERE scope_id='connector:google.mail.read'").run();
    const config={...e,...condition==='disabled'?{MAILBOX_SYNC_ENABLED:'false'}:{},...condition==='capability'?{GOOGLE_ENABLED_CAPABILITIES:''}:{}};
    await expect(runMailboxPage(config,f.actor,f.streamId,async()=>{if(condition==='pause')throw new Error('fixture paused');},async()=>{calls++;return Response.json({historyId:'300'});})).rejects.toBeDefined();
    expect(calls).toBe(0);expect(await changes(f.streamId)).toEqual([]);
  });
  it.each(['consent','billing','pause'] as const)('withholds a provider page when %s changes in flight',async condition=>{
    const f=await fixture();let paused=false;
    await expect(runMailboxPage(e,f.actor,f.streamId,async()=>{if(paused)throw new Error('fixture paused');},async()=>{
      if(condition==='consent')await storeProviderGrant(e,f.binding,f.credential,[]);
      if(condition==='billing')await e.AGENT_DB.prepare("UPDATE agent_billing_subscriptions SET paid_through='2000-01-01T00:00:00.000Z' WHERE tenant_id=?").bind(f.actor.tenantId).run();
      if(condition==='pause')paused=true;
      return Response.json({historyId:'300',history:[{id:'250',messagesAdded:[{message:{id:'private',threadId:'t'}}]}]});
    })).rejects.toBeDefined();
    expect(await changes(f.streamId)).toEqual([]);
    expect(await e.AGENT_DB.prepare('SELECT checkpoint FROM agent_mailbox_sync WHERE id=?').bind(f.streamId).first()).toEqual({checkpoint:'200'});
  });
  it('marks expired history for resync without advancing it',async()=>{
    const f=await fixture();
    expect(await runMailboxPage(e,f.actor,f.streamId,guard,async()=>Response.json({}, {status:404}))).toEqual({state:'resync_required'});
    expect(await f.ledger.claim(f.streamId)).toBeNull();
    expect(await changes(f.streamId)).toEqual([]);
  });
  it('requires review for malformed pages without saving partial changes',async()=>{
    const f=await fixture();
    expect(await runMailboxPage(e,f.actor,f.streamId,guard,async()=>Response.json({historyId:'300',history:[{id:'250',messagesAdded:[{}]}]})))
      .toEqual({state:'resync_required'});
    expect(await changes(f.streamId)).toEqual([]);
    expect(await e.AGENT_DB.prepare('SELECT checkpoint FROM agent_mailbox_sync WHERE id=?').bind(f.streamId).first()).toEqual({checkpoint:'200'});
  });
  it('rejects an expired lease after a provider read',async()=>{
    const f=await fixture();
    await expect(runMailboxPage(e,f.actor,f.streamId,guard,async()=>{
      await e.AGENT_DB.prepare("UPDATE agent_mailbox_sync SET lease_until='2000-01-01T00:00:00.000Z' WHERE id=?").bind(f.streamId).run();
      return Response.json({historyId:'300'});
    })).rejects.toMatchObject({code:'mailbox_sync_unavailable'});
    expect(await e.AGENT_DB.prepare('SELECT checkpoint FROM agent_mailbox_sync WHERE id=?').bind(f.streamId).first()).toEqual({checkpoint:'200'});
  });
  it('defers transient provider failures on the original checkpoint',async()=>{
    const f=await fixture();let calls=0;
    expect(await runMailboxPage(e,f.actor,f.streamId,guard,async()=>{calls++;return Response.json({}, {status:503});})).toEqual({state:'deferred'});
    expect(calls).toBe(1);expect(await f.ledger.claim(f.streamId)).toBeNull();
    expect(await e.AGENT_DB.prepare('SELECT checkpoint FROM agent_mailbox_sync WHERE id=?').bind(f.streamId).first()).toEqual({checkpoint:'200'});
  });
  it('persists rate-limit backoff and performs no immediate retry',async()=>{
    const f=await fixture();let calls=0;
    const before=Date.now();
    expect(await runMailboxPage(e,f.actor,f.streamId,guard,async()=>{calls++;return Response.json({}, {status:429,headers:{'retry-after':'3600'}});})).toEqual({state:'deferred'});
    expect(calls).toBe(1);expect(await f.ledger.claim(f.streamId)).toBeNull();
    const row=await e.AGENT_DB.prepare('SELECT checkpoint,next_poll_at,lease_token FROM agent_mailbox_sync WHERE id=?').bind(f.streamId).first<{checkpoint:string;next_poll_at:string;lease_token:string|null}>();
    expect(row!.checkpoint).toBe('200');expect(row!.lease_token).toBeNull();expect(Date.parse(row!.next_poll_at)).toBeGreaterThanOrEqual(before+3600000);
  });
});
