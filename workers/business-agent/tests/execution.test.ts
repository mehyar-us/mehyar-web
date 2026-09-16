import {env} from 'cloudflare:workers';
import {runInDurableObject} from 'cloudflare:test';
import {getAgentByName} from 'agents';
import {describe,it,expect} from 'vitest';
import type {Env} from '../src/env';
import {BusinessAgent,unwrap} from '../src/agent';
import {ActionControls} from '../src/actions';
import {createTenant} from '../src/tenants';
import {storeProviderGrant} from '../src/auth/vault';
import {CATALOG_VERSION} from '../src/catalog';
import {RELEASE_GATES} from '../src/billing/service';
const e=env as unknown as Env;
async function fixture(provider:'google'|'microsoft'='google',operation:'mail.reply'|'calendar.create'='mail.reply') {
  const userId=crypto.randomUUID();await e.AGENT_DB.prepare('INSERT INTO auth_user(id,name,email,createdAt,updatedAt) VALUES (?,?,?,?,?)')
    .bind(userId,'Fixture',`${userId}@example.test`,Date.now(),Date.now()).run();
  const tenant=await createTenant(e,userId,{name:'Execution fixture'},crypto.randomUUID()),actor={userId,tenantId:tenant.id};
  const grantId=await storeProviderGrant(e,{userId,tenantId:tenant.id,provider,accountId:crypto.randomUUID()},
    {accountEmail:'owner@example.test',accessToken:'fixture-access',refreshToken:'fixture-refresh',accessTokenExpiresAt:new Date(Date.now()+3600000).toISOString(),
      grantedScopes:provider==='google'?['gmail.readonly','gmail.send','calendar.calendarlist.readonly','calendar.events','calendar.freebusy'].map(s=>'https://www.googleapis.com/auth/'+s):['Mail.Read','Mail.Send','Calendars.ReadWrite']},[]);
  await e.AGENT_DB.prepare("UPDATE agent_tenants SET status='active',plan_id='business' WHERE id=?").bind(tenant.id).run();
  await e.AGENT_DB.prepare("INSERT INTO agent_billing_subscriptions(tenant_id,stripe_subscription_id,plan_id,status,paid_through,updated_at,access_state) VALUES (?,?,'business','active',?,?,'active')")
    .bind(tenant.id,'sub_'+crypto.randomUUID(),new Date(Date.now()+86400000).toISOString(),new Date().toISOString()).run();
  for(const [scope,gates] of [['catalog',RELEASE_GATES],[tenant.id,['activation_approved','business_policy_approved']],[`connector:${provider}.${operation}`,['provider_approval','live_acceptance']]] as const) {
    for(const gate of gates)await e.AGENT_DB.prepare("INSERT OR REPLACE INTO agent_billing_readiness(scope_id,gate,catalog_version,status,evidence_ref,verified_by,verified_at,valid_until) VALUES (?,?,?,'verified','fixture-only','test',?,?)")
      .bind(scope,gate,CATALOG_VERSION,new Date().toISOString(),new Date(Date.now()+86400000).toISOString()).run();
  }
  const stub=await getAgentByName(e.BUSINESS_AGENTS,tenant.id);unwrap(await stub.provision(actor));
  const policy=unwrap(await stub.saveActionPolicy(actor,{id:crypto.randomUUID(),expectedVersion:0,name:'Reviewed action',trigger:'Owner request',operation,provider,grantId,
    mode:'approve',resources:['resource-one'],recipients:['client@example.test'],startsAt:new Date(Date.now()-60000).toISOString(),expiresAt:new Date(Date.now()+86400000).toISOString(),
    maxActionsPerDay:5,maxCostMicrosPerDay:0,escalation:'Owner',enabled:true}));
  const payload=operation==='mail.reply'?{operation,resourceId:'resource-one',messageId:'msg-one',recipient:'client@example.test',text:'Your request is received.'}
    :{operation,resourceId:'resource-one',title:'Consultation',attendees:['client@example.test'],start:new Date(Date.now()+3600000).toISOString(),end:new Date(Date.now()+7200000).toISOString(),timeZone:'America/New_York'};
  const proposal={policyId:policy.id,policyVersion:1,action:payload};
  const action=unwrap(await stub.proposeAction(actor,proposal,crypto.randomUUID()));
  unwrap(await stub.decideAction(actor,action.id,{decision:'approve',actionHash:action.actionHash}));
  return {actor,stub,action,proposal,grantId,provider,operation};
}
type Fixture=Awaited<ReturnType<typeof fixture>>;
async function withControls(f:Fixture,work:(controls:ActionControls,instance:BusinessAgent)=>Promise<void>,enabled=true) {
  return runInDurableObject(f.stub,async(instance:BusinessAgent)=>work(new ActionControls((instance as any).ctx.storage.sql,{...e,EXTERNAL_ACTIONS_ENABLED:enabled?'true':'false'},()=>instance.state.paused),instance));
}
function mailTransport(provider:'google'|'microsoft',onWrite:()=>Promise<Response>):typeof fetch {
  return async(_input,init)=>{
    if(init?.method==='POST')return onWrite();
    return Response.json(provider==='google'?{messages:[{id:'msg-one',threadId:'resource-one',payload:{headers:[
      {name:'From',value:'client@example.test'},{name:'Subject',value:'Appointment'},{name:'Message-ID',value:'<source@example.test>'}]} }]}
      :{id:'msg-one',conversationId:'resource-one',subject:'Appointment',from:{emailAddress:{address:'client@example.test'}},internetMessageId:'<source@example.test>'});
  };
}
describe('gated durable external execution',()=>{
  it('books a calendar found after the first provider page',async()=>{
    const f=await fixture('google','calendar.create');let pages=0,creates=0;
    await withControls(f,async controls=>{
      const transport:typeof fetch=async input=>{
        const url=new URL(String(input));
        if(url.pathname.endsWith('calendarList')) {
          pages++;
          return url.searchParams.has('pageToken')?Response.json({items:[{id:'resource-one',accessRole:'owner'}]})
            :Response.json({items:[{id:'unrelated',accessRole:'reader'}],nextPageToken:'second'});
        }
        if(url.pathname.endsWith('freeBusy'))return Response.json({calendars:{'resource-one':{busy:[]}}});
        creates++;return Response.json({id:'later-page-event',etag:'"v1"'});
      };
      expect((await controls.execute(f.actor,f.action.id,{actionHash:f.action.actionHash},transport)).receipt).toMatchObject({id:'later-page-event',state:'applied'});
      expect(pages).toBe(2);expect(creates).toBe(1);
    });
  });
  it('does not book from an incomplete looping calendar directory',async()=>{
    const f=await fixture('google','calendar.create');let pages=0;
    await withControls(f,async controls=>{
      await expect(controls.execute(f.actor,f.action.id,{actionHash:f.action.actionHash},async input=>{
        expect(String(input)).toContain('calendarList');pages++;
        return Response.json({items:[{id:'resource-one',accessRole:'owner'}],nextPageToken:'loop'});
      })).rejects.toMatchObject({code:'calendar_directory_incomplete'});
      expect(pages).toBe(2);expect((await controls.detail(f.actor,f.action.id)).status).toBe('pending');
    });
  });
  it('checks the execution-day allowance again for a previously approved action',async()=>{
    const f=await fixture();let requests=0;
    await withControls(f,async(controls,instance)=>{
      instance.sql`UPDATE action_reviews SET reservation_day='2020-01-01' WHERE id=${f.action.id}`;
      for(let i=0;i<5;i++) {
        const proposal=await controls.propose(f.actor,{...f.proposal,action:{...f.proposal.action,text:`Reserved reply ${i}`}},crypto.randomUUID());
        await controls.decide(f.actor,proposal.id,{decision:'approve',actionHash:proposal.actionHash});
      }
      await expect(controls.execute(f.actor,f.action.id,{actionHash:f.action.actionHash},async()=>{requests++;return Response.json({});})).rejects.toMatchObject({code:'action_budget_limit'});
      expect(requests).toBe(0);
    });
  });
  it('serializes overlapping bookings before either can bypass provider availability checks',async()=>{
    const f=await fixture('google','calendar.create');let entered!:()=>void,release!:()=>void,creates=0;
    const started=new Promise<void>(resolve=>entered=resolve),hold=new Promise<void>(resolve=>release=resolve);
    await withControls(f,async controls=>{
      const other=await controls.propose(f.actor,{...f.proposal,action:{...f.proposal.action,title:'Competing appointment'}},crypto.randomUUID());
      await controls.decide(f.actor,other.id,{decision:'approve',actionHash:other.actionHash});
      const transport:typeof fetch=async input=>{
        if(String(input).includes('calendarList'))return Response.json({items:[{id:'resource-one',accessRole:'owner'}]});
        if(String(input).includes('freeBusy'))return Response.json({calendars:{'resource-one':{busy:[]}}});
        creates++;entered();await hold;return Response.json({id:'booked-event',etag:'"v1"'});
      };
      const first=controls.execute(f.actor,f.action.id,{actionHash:f.action.actionHash},transport);await started;
      try{await expect(controls.execute(f.actor,other.id,{actionHash:other.actionHash},transport)).rejects.toMatchObject({code:'calendar_reserved'});}
      finally{release();}await first;expect(creates).toBe(1);
    });
  });
  it('rejects a revoked grant or missing provider evidence even after approval',async()=>{
    const f=await fixture();let requests=0;
    await e.AGENT_DB.prepare("UPDATE auth_provider_grants SET status='revoked' WHERE id=?").bind(f.grantId).run();
    await withControls(f,async controls=>{
      await expect(controls.execute(f.actor,f.action.id,{actionHash:f.action.actionHash},async()=>{requests++;return Response.json({});})).rejects.toMatchObject({code:'connection_unavailable'});
    });
    expect(requests).toBe(0);
    const g=await fixture('microsoft');
    await e.AGENT_DB.prepare("UPDATE agent_billing_readiness SET status='revoked' WHERE scope_id=?").bind('connector:microsoft.mail.reply').run();
    await withControls(g,async controls=>{
      await expect(controls.execute(g.actor,g.action.id,{actionHash:g.action.actionHash},async()=>{requests++;return Response.json({});})).rejects.toMatchObject({code:'activation_not_ready'});
    });expect(requests).toBe(0);
  });
  it('creates a Microsoft appointment through current ownership and availability checks',async()=>{
    const f=await fixture('microsoft','calendar.create');let creates=0;
    await withControls(f,async controls=>{
      const transport:typeof fetch=async(input,init)=>{
        const url=String(input);
        if(url.includes('calendarView'))return Response.json({value:[]});
        if(url.includes('/me/calendars?'))return Response.json({value:[{id:'resource-one',name:'Work',canEdit:true}]});
        creates++;expect(JSON.parse(init!.body as string).transactionId).toBe(f.action.id);
        return Response.json({id:'event-ms','@odata.etag':'"v1"'});
      };
      expect((await controls.execute(f.actor,f.action.id,{actionHash:f.action.actionHash},transport)).receipt).toMatchObject({provider:'microsoft',state:'applied'});expect(creates).toBe(1);
    });
  });
  it('refuses a busy provider calendar without creating an event',async()=>{
    const f=await fixture('google','calendar.create');let creates=0;
    await withControls(f,async controls=>{
      await expect(controls.execute(f.actor,f.action.id,{actionHash:f.action.actionHash},async input=>{
        if(String(input).includes('calendarList'))return Response.json({items:[{id:'resource-one',accessRole:'owner'}]});
        if(String(input).includes('freeBusy'))return Response.json({calendars:{'resource-one':{busy:[{start:'2026-12-01T10:00:00Z',end:'2026-12-01T11:00:00Z'}]}}});
        creates++;return Response.json({});
      })).rejects.toMatchObject({code:'calendar_conflict'});expect(creates).toBe(0);
    });
  });
  it.each(['google','microsoft'] as const)('executes one approved %s reply and replays its receipt without resending',async provider=>{
    const f=await fixture(provider);let sends=0;
    await withControls(f,async controls=>{
      const transport=mailTransport(provider,async()=>{sends++;return provider==='google'?Response.json({id:'sent-one',threadId:'resource-one'}):new Response(null,{status:202});});
      const first=await controls.execute(f.actor,f.action.id,{actionHash:f.action.actionHash},transport);
      expect(first).toMatchObject({action:{status:'succeeded'},receipt:{state:'accepted',provider},replay:false});
      expect((await controls.execute(f.actor,f.action.id,{actionHash:f.action.actionHash},transport)).replay).toBe(true);
      expect(sends).toBe(1);
    });
  });
  it('blocks disabled execution and expired entitlement before any network request',async()=>{
    const f=await fixture();const transport:typeof fetch=async()=>{throw new Error('unexpected network');};
    await withControls(f,async controls=>{await expect(controls.execute(f.actor,f.action.id,{actionHash:f.action.actionHash},transport)).rejects.toMatchObject({code:'execution_disabled'});},false);
    await e.AGENT_DB.prepare("UPDATE agent_billing_subscriptions SET paid_through='2020-01-01T00:00:00.000Z' WHERE tenant_id=?").bind(f.actor.tenantId).run();
    await withControls(f,async controls=>{await expect(controls.execute(f.actor,f.action.id,{actionHash:f.action.actionHash},transport)).rejects.toMatchObject({code:'subscription_access_expired'});});
  });
  it('serializes competing executions and rejects an identical separately approved proposal',async()=>{
    const f=await fixture();let sends=0,entered!:()=>void,release!:()=>void;
    const started=new Promise<void>(resolve=>entered=resolve),hold=new Promise<void>(resolve=>release=resolve);
    const duplicate=unwrap(await f.stub.proposeAction(f.actor,f.proposal,crypto.randomUUID()));
    unwrap(await f.stub.decideAction(f.actor,duplicate.id,{decision:'approve',actionHash:duplicate.actionHash}));
    await withControls(f,async controls=>{
      const transport=mailTransport('google',async()=>{sends++;entered();await hold;return Response.json({id:'sent',threadId:'resource-one'});});
      const first=controls.execute(f.actor,f.action.id,{actionHash:f.action.actionHash},transport);await started;
      try {
        await expect(controls.execute(f.actor,f.action.id,{actionHash:f.action.actionHash},transport)).rejects.toMatchObject({code:'execution_not_repeatable'});
        await expect(controls.execute(f.actor,duplicate.id,{actionHash:duplicate.actionHash},transport)).rejects.toMatchObject({code:'duplicate_execution'});
      }finally{release();}await first;expect(sends).toBe(1);
    });
  });
  it('records uncertain delivery and refuses another send after a provider timeout',async()=>{
    const f=await fixture();let sends=0;
    await withControls(f,async controls=>{
      const transport=mailTransport('google',async()=>{sends++;throw new Error('connection lost after send');});
      await expect(controls.execute(f.actor,f.action.id,{actionHash:f.action.actionHash},transport)).rejects.toMatchObject({code:'execution_uncertain'});
      expect((await controls.detail(f.actor,f.action.id)).status).toBe('uncertain');
      await expect(controls.execute(f.actor,f.action.id,{actionHash:f.action.actionHash},transport)).rejects.toMatchObject({code:'execution_not_repeatable'});expect(sends).toBe(1);
    });
  });
  it('stops an owner pause during the preliminary read, then requires fresh approval for a safe retry',async()=>{
    const f=await fixture();let sends=0;
    await withControls(f,async(controls,instance)=>{
      const base=mailTransport('google',async()=>{sends++;return Response.json({id:'sent',threadId:'resource-one'});});
      const transport:typeof fetch=async(input,init)=>{const response=await base(input,init);if(init?.method==='GET')unwrap(await instance.pause(f.actor,true));return response;};
      await expect(controls.execute(f.actor,f.action.id,{actionHash:f.action.actionHash},transport)).rejects.toMatchObject({code:'execution_failed'});
      expect(sends).toBe(0);expect((await controls.detail(f.actor,f.action.id)).status).toBe('pending');
      unwrap(await instance.pause(f.actor,false));
      await expect(controls.execute(f.actor,f.action.id,{actionHash:f.action.actionHash},base)).rejects.toMatchObject({code:'approval_required'});
      await controls.decide(f.actor,f.action.id,{decision:'approve',actionHash:f.action.actionHash});
      expect((await controls.execute(f.actor,f.action.id,{actionHash:f.action.actionHash},base)).receipt.state).toBe('accepted');expect(sends).toBe(1);
    });
  });
  it('verifies calendar ownership and availability before creating with a stable action ID',async()=>{
    const f=await fixture('google','calendar.create');let creates=0;
    await withControls(f,async controls=>{
      const transport:typeof fetch=async(input,init)=>{
        const url=String(input);
        if(url.includes('calendarList'))return Response.json({items:[{id:'resource-one',summary:'Business',accessRole:'owner'}]});
        if(url.includes('freeBusy'))return Response.json({calendars:{'resource-one':{busy:[]}}});
        creates++;expect(JSON.parse(init!.body as string).id).toMatch(/^[a-f0-9]{64}$/);
        return Response.json({id:'event-one',etag:'"v1"'});
      };
      expect((await controls.execute(f.actor,f.action.id,{actionHash:f.action.actionHash},transport)).receipt).toMatchObject({state:'applied',id:'event-one'});expect(creates).toBe(1);
    });
  });
  it('treats interrupted durable executions as uncertain on restart',async()=>{
    const f=await fixture();
    await withControls(f,async(controls,instance)=>{
      instance.sql`INSERT INTO action_executions(action_id,intent_hash,status,started_at,dispatched) VALUES (${f.action.id},'fixture-intent','running',${new Date().toISOString()},1)`;
      instance.sql`UPDATE action_reviews SET status='running' WHERE id=${f.action.id}`;
      controls.initialize();
      expect((await controls.detail(f.actor,f.action.id)).status).toBe('uncertain');
      await expect(controls.execute(f.actor,f.action.id,{actionHash:f.action.actionHash})).rejects.toMatchObject({code:'execution_not_repeatable'});
    });
  });
});
