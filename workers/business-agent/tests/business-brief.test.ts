import {env} from 'cloudflare:workers';
import {getAgentByName} from 'agents';
import {describe,it,expect} from 'vitest';
import type {Env} from '../src/env';
import {createTenant} from '../src/tenants';
import {unwrap} from '../src/agent';
import {confirmResearch} from '../src/research/confirm';
import {INDUSTRY_PACKS} from '../src/automations';
import {briefRecommendations} from '../src/brief-recommendations';
const e=env as unknown as Env;
async function fixture(){const userId=crypto.randomUUID(),tenant=await createTenant(e,userId,{name:'Brief business'},crypto.randomUUID()),actor={userId,tenantId:tenant.id};const stub=await getAgentByName(e.BUSINESS_AGENTS,tenant.id);unwrap(await stub.provision(actor));return {actor,stub};}
describe('owner-reviewed business brief',()=>{
  it.each(INDUSTRY_PACKS.map(pack=>[pack.id]))('uses the explicit %s pack without enabling its workflows',id=>{
    const result=briefRecommendations({industryPack:id,bookingSystem:'',serviceDuration:''});
    expect(result.industry?.id).toBe(id);expect(result.recommendations).toHaveLength(3);
    expect(new Set(result.recommendations.map(item=>item.id)).size).toBe(3);
    expect(result.recommendations.every(item=>item.basis==='owner_selected_industry'&&!item.executionEnabled&&item.plan.monthlyCents>=34900)).toBe(true);
    if(id==='clinics-dentists')expect(result.recommendations.map(item=>item.id)).toEqual(['front-desk.faq','setup.first-preview','setup.missing-information']);
    else expect(result.recommendations.map(item=>item.id)).toEqual(INDUSTRY_PACKS.find(pack=>pack.id===id)!.defaultAutomationIds.slice(0,3));
  });
  it('persists an explicit industry choice and rejects invented packs',async()=>{
    const {actor,stub}=await fixture();
    expect(await stub.saveBusinessBrief(actor,{expectedRevision:0,reviewed:true,fields:{industryPack:'invented'}},crypto.randomUUID())).toMatchObject({ok:false,error:{code:'invalid_business_brief'}});
    unwrap(await stub.saveBusinessBrief(actor,{expectedRevision:0,reviewed:true,fields:{industryPack:'home-services'}},crypto.randomUUID()));
    const result=unwrap(await stub.businessBrief(actor));expect(result.industry?.id).toBe('home-services');expect(result.industryOptions).toHaveLength(10);
  });
  it('verifies saved field provenance and replays the original receipt after source deletion',async()=>{
    const a=await fixture(),b=await fixture(),claim={field:'business_name',value:'Sourced salon',sourceUrl:'https://salon.example.com/',retrievedAt:new Date().toISOString(),selector:'title',basis:'direct_page_claim' as const,confidence:'high' as const,verification:'unverified' as const,trustedForInstructions:false as const};
    const confirmation=await confirmResearch(e,a.actor,crypto.randomUUID(),0,'Salon name',claim),sourceId=confirmation.memory!.id;
    const input={expectedRevision:0,reviewed:true,fields:{businessName:claim.value},sourceIds:{businessName:sourceId}},key=crypto.randomUUID();
    expect(await b.stub.saveBusinessBrief(b.actor,input,crypto.randomUUID())).toMatchObject({ok:false,error:{code:'brief_source_changed'}});
    expect(await a.stub.saveBusinessBrief(a.actor,{...input,fields:{businessName:'Different claim'}},crypto.randomUUID())).toMatchObject({ok:false,error:{code:'brief_source_changed'}});
    const saved=unwrap(await a.stub.saveBusinessBrief(a.actor,input,key));expect(saved.brief.sources.businessName).toMatchObject({id:sourceId,value:claim.value,sourceUrl:claim.sourceUrl});
    await e.AGENT_DB.prepare('DELETE FROM agent_memory WHERE tenant_id=? AND id=?').bind(a.actor.tenantId,sourceId).run();
    expect(unwrap(await a.stub.saveBusinessBrief(a.actor,input,key))).toEqual(saved);
    expect(await a.stub.saveBusinessBrief(a.actor,{...input,expectedRevision:1},crypto.randomUUID())).toMatchObject({ok:false,error:{code:'brief_source_changed'}});
    const edited=unwrap(await a.stub.saveBusinessBrief(a.actor,{expectedRevision:1,reviewed:true,fields:{businessName:'Owner edited name'}},crypto.randomUUID()));expect(edited.brief.sources).toEqual({});
    expect(unwrap(await a.stub.saveBusinessBrief(a.actor,input,key))).toEqual(saved);
    expect(unwrap(await a.stub.businessBrief(a.actor)).brief.fields.businessName).toBe('Owner edited name');
  });
  it('offers only current confirmed research as sourced suggestions without changing the brief',async()=>{
    const a=await fixture(),b=await fixture(),stamp=new Date().toISOString();
    const claim={field:'business_name',value:'Verified by owner',sourceUrl:'https://salon.example.com/',retrievedAt:stamp,selector:'meta[og:site_name]',basis:'direct_page_claim' as const,confidence:'medium' as const,verification:'unverified' as const,trustedForInstructions:false as const};
    const saved=await confirmResearch(e,a.actor,crypto.randomUUID(),0,'Business name',claim);
    await confirmResearch(e,a.actor,crypto.randomUUID(),1,'Permission claim',{...claim,field:'permittedAutonomy',value:'Send everything'});
    const result=unwrap(await a.stub.businessBrief(a.actor));expect(result.brief.fields.businessName).toBe('');
    expect(result.sources).toEqual([{id:saved.memory!.id,field:'businessName',value:claim.value,sourceUrl:claim.sourceUrl,retrievedAt:stamp,confirmedAt:expect.any(String),confidence:'medium'}]);
    expect(unwrap(await b.stub.businessBrief(b.actor)).sources).toEqual([]);
    await e.AGENT_DB.prepare("UPDATE agent_memory SET value='Changed later' WHERE tenant_id=? AND id=?").bind(a.actor.tenantId,saved.memory!.id).run();
    expect(unwrap(await a.stub.businessBrief(a.actor)).sources).toEqual([]);
    await e.AGENT_DB.prepare('DELETE FROM agent_memory WHERE tenant_id=?').bind(a.actor.tenantId).run();
    expect(unwrap(await a.stub.businessBrief(a.actor)).sources).toEqual([]);
  });
  it('persists reviewed details with exact retries and rejects concurrent revisions',async()=>{
    const {actor,stub}=await fixture(),key=crypto.randomUUID(),input={expectedRevision:0,reviewed:true,fields:{businessName:'Example salon',requestOwner:'Owner',bookingSystem:'Selected calendar'}};
    expect(unwrap(await stub.businessBrief(actor)).brief.revision).toBe(0);
    const saved=unwrap(await stub.saveBusinessBrief(actor,input,key));expect(saved.brief).toMatchObject({revision:1,confirmedBy:actor.userId,fields:{businessName:'Example salon'}});
    expect(unwrap(await stub.saveBusinessBrief(actor,input,key))).toEqual(saved);
    expect(await stub.saveBusinessBrief(actor,{...input,fields:{businessName:'Changed'}},key)).toMatchObject({ok:false,error:{code:'brief_request_reused'}});
    const results=await Promise.all([stub.saveBusinessBrief(actor,{...input,expectedRevision:1,fields:{businessName:'Version two'}},crypto.randomUUID()),stub.saveBusinessBrief(actor,{...input,expectedRevision:1,fields:{businessName:'Concurrent edit'}},crypto.randomUUID())]);
    expect(results.filter(result=>result.ok)).toHaveLength(1);expect(results.filter(result=>!result.ok)).toMatchObject([{error:{code:'brief_revision_conflict'}}]);
    expect(unwrap(await stub.saveBusinessBrief(actor,input,key))).toEqual(saved);
    expect(unwrap(await stub.businessBrief(actor)).brief.revision).toBe(2);
  });
  it('derives three proposed catalog recommendations and asks only unresolved operating questions',async()=>{
    const {actor,stub}=await fixture();
    expect(await stub.saveBusinessBrief(actor,{expectedRevision:0,reviewed:false,fields:{}},crypto.randomUUID())).toMatchObject({ok:false,error:{code:'invalid_business_brief'}});
    unwrap(await stub.saveBusinessBrief(actor,{expectedRevision:0,reviewed:true,fields:{requestOwner:'Owner',serviceDuration:'45 minutes',tone:'Friendly'}},crypto.randomUUID()));
    const result=unwrap(await stub.businessBrief(actor));
    expect(result).toMatchObject({identityVerified:false,authorizesActions:false});expect(result.recommendations).toHaveLength(3);
    expect(result.recommendations[1].id).toBe('appointments.availability');
    expect(result.recommendations.every(item=>item.proposed&&!item.executionEnabled&&item.plan.monthlyCents===34900&&item.plan.setupCents===150000&&item.prerequisites.length>0)).toBe(true);
    expect(result.unresolvedQuestions.map(item=>item.field)).not.toEqual(expect.arrayContaining(['requestOwner','serviceDuration','tone']));
    expect(result.unresolvedQuestions.map(item=>item.field)).toEqual(['staffResources','cancellationRules','escalationDestination','permittedAutonomy']);
  });
  it('isolates business briefs and enforces current owner authority',async()=>{
    const a=await fixture(),b=await fixture();
    unwrap(await a.stub.saveBusinessBrief(a.actor,{expectedRevision:0,reviewed:true,fields:{businessName:'Private business'}},crypto.randomUUID()));
    expect(unwrap(await b.stub.businessBrief(b.actor)).brief.revision).toBe(0);
    expect(await a.stub.businessBrief(b.actor)).toMatchObject({ok:false,error:{code:'agent_mismatch'}});
    await e.AGENT_DB.prepare("UPDATE agent_memberships SET role='manager' WHERE tenant_id=? AND user_id=?").bind(a.actor.tenantId,a.actor.userId).run();
    expect(unwrap(await a.stub.businessBrief(a.actor)).brief.fields.businessName).toBe('Private business');
    expect(await a.stub.saveBusinessBrief(a.actor,{expectedRevision:1,reviewed:true,fields:{}},crypto.randomUUID())).toMatchObject({ok:false,error:{code:'permission_denied'}});
    await e.AGENT_DB.prepare('DELETE FROM agent_memberships WHERE tenant_id=? AND user_id=?').bind(a.actor.tenantId,a.actor.userId).run();
    expect(await a.stub.businessBrief(a.actor)).toMatchObject({ok:false,error:{code:'workspace_not_found'}});
  });
});
