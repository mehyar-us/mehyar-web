import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Browser contract fixtures. No email, booking or live authorization occurs.
async function fixture(page:Page,role='owner',paused=false,execution:false|'ready'|'uncertain'=false,calendarSetup=false) {
  const calls:{path:string;body:any}[]=[];
  let status=execution?'approved':'pending';
  let receipt:unknown=null;
  const action={id:'11111111-1111-4111-8111-111111111111',requestedBy:'fixture-user',policyId:'policy-one',policyVersion:3,
    actionHash:'a'.repeat(64),status,createdAt:'2026-09-16T12:00:00Z',expiresAt:'2027-01-01T12:00:00Z',approvedBy:null,approvedAt:null,reason:null,
    executionAvailable:Boolean(execution),executionNote:'Approval records permission only. Connector execution is not enabled yet.',
    action:{operation:'mail.reply',resourceId:'customer-thread',messageId:'original-message',recipient:'customer@example.com',text:'Your appointment request is being reviewed. <script>secret()</script>'}};
  const tenants=[{id:'business-a',name:'Oak Studio',status:'trial'},{id:'business-b',name:'Second Studio',status:'trial'}];
  await page.route('**/api/**',async route=>{
    const request=route.request(),path=new URL(request.url()).pathname;
    const body=request.method()==='POST'?request.postDataJSON():undefined;
    calls.push({path,body});const reply=(json:unknown)=>route.fulfill({json});
    if(path==='/api/session') return reply({user:{id:'fixture-user',name:'Sam',email:'sam@example.test'}});
    if(path==='/api/auth/capabilities') return reply({providers:{google:{configured:false,capabilities:[]},microsoft:{configured:false,capabilities:[]}}});
    if(path==='/api/auth/grants')return reply({grants:calendarSetup?[{id:'22222222-2222-4222-8222-222222222222',provider:'google',tenantId:'business-a',status:'authorized',grantedCapabilities:['calendar_manage'],grantedScopes:[],selectedCapabilities:[]}]:[]});
    if(path.endsWith('/calendars'))return reply({calendars:[{id:'read-only',name:'Reference',canWrite:false},{id:'work-calendar',name:'Work appointments',canWrite:true}],incomplete:false});
    if(path.endsWith('/action-policies'))return reply({policy:{...body,version:1}});
    if(path==='/api/catalog')return reply({version:'fixture',currency:'USD',plans:[],addons:[]});
    if(path==='/api/tenants')return reply({tenants});
    if(path.endsWith('/messages'))return reply({messages:[]});
    if(path.endsWith('/decision')) {status=body.decision==='approve'?'approved':'rejected';return reply({action:{...action,status}});}
    if(path.endsWith('/execute')) {
      if(execution==='uncertain'){status='uncertain';return route.fulfill({status:503,json:{error:{code:'execution_uncertain',message:'The provider outcome is uncertain. Reconciliation is required before retrying.'}}});}
      status='succeeded';receipt={provider:'google',state:'accepted',id:'provider-receipt'};
      return reply({action:{...action,status,receipt,executionAvailable:false},receipt,replay:false});
    }
    if(path.endsWith('/actions'))return reply({actions:path.includes('business-b')?[]:[{...action,status,receipt,executionAvailable:Boolean(execution)&&status==='approved'}]});
    if(path.startsWith('/api/tenants/'))return reply({tenant:tenants.find(t=>path.endsWith(t.id)),membership:{role},memory:[],activity:[],connections:[],usage:{paused}});
    return route.fulfill({status:404,json:{error:{message:'Fixture route not found'}}});
  });
  await page.goto('/');
  if((page.viewportSize()?.width??1440)<768) await page.getByRole('button',{name:'Open navigation'}).click();
  await page.getByRole('button',{name:'Approvals',exact:true}).click();
  return calls;
}

test('owner selects a writable calendar and saves an exact appointment policy without booking',async({page})=>{
  const calls=await fixture(page,'owner',false,false,true);
  await page.getByRole('button',{name:'Set up appointments',exact:true}).click();
  await page.getByRole('combobox',{name:'Connected account',exact:true}).selectOption('22222222-2222-4222-8222-222222222222');
  await expect(page.getByRole('combobox',{name:'Appointment calendar',exact:true})).toBeEnabled();
  await expect(page.getByRole('option',{name:'Reference (read only)'})).toHaveJSProperty('disabled',true);
  await page.getByRole('combobox',{name:'Appointment calendar',exact:true}).selectOption('work-calendar');
  await page.getByLabel('Allowed attendee emails',{exact:true}).fill('Client@example.com\nclient@example.com');
  expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze()).violations).toEqual([]);
  await page.getByRole('button',{name:'Save appointment policy',exact:true}).click();
  await expect(page.getByText('Appointment policy saved. Each appointment still requires its own review. No booking was made.',{exact:true})).toBeVisible();
  expect(calls.find(c=>c.path.endsWith('/action-policies'))?.body).toMatchObject({expectedVersion:0,operation:'calendar.create',provider:'google',resources:['work-calendar'],recipients:['client@example.com'],mode:'approve',maxActionsPerDay:10,maxCostMicrosPerDay:0});
  expect(calls.some(c=>c.path.endsWith('/execute'))).toBe(false);
});

test('policy retries preserve the request after an uncertain save response',async({page})=>{
  await fixture(page,'owner',false,false,true);const bodies:any[]=[];
  await page.route('**/action-policies',async route=>{
    const body=route.request().postDataJSON();bodies.push(body);
    return bodies.length===1?route.abort():route.fulfill({json:{policy:{...body,version:1}}});
  });
  await page.getByRole('button',{name:'Set up appointments',exact:true}).click();
  await page.getByRole('combobox',{name:'Connected account',exact:true}).selectOption('22222222-2222-4222-8222-222222222222');
  await expect(page.getByRole('combobox',{name:'Appointment calendar',exact:true})).toBeEnabled();
  await page.getByRole('combobox',{name:'Appointment calendar',exact:true}).selectOption('work-calendar');
  await page.getByLabel('Allowed attendee emails',{exact:true}).fill('client@example.com');
  await page.getByRole('button',{name:'Save appointment policy',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText("couldn't reach");
  await page.getByRole('button',{name:'Save appointment policy',exact:true}).click();
  await expect(page.getByText(/Appointment policy saved/)).toBeVisible();expect(bodies).toHaveLength(2);expect(bodies[1]).toEqual(bodies[0]);
});

test('incomplete calendars cannot be selected and managers cannot open policy creation',async({page})=>{
  await fixture(page,'owner',false,false,true);
  await page.route('**/calendars?*',route=>route.fulfill({json:{calendars:[{id:'work-calendar',name:'Work',canWrite:true}],incomplete:true}}));
  await page.getByRole('button',{name:'Set up appointments',exact:true}).click();
  await page.getByRole('combobox',{name:'Connected account',exact:true}).selectOption('22222222-2222-4222-8222-222222222222');
  await expect(page.getByRole('alert')).toContainText('incomplete');
  await expect(page.getByRole('combobox',{name:'Appointment calendar',exact:true})).toBeDisabled();
  await expect(page.getByRole('button',{name:'Save appointment policy',exact:true})).toBeDisabled();
  await fixture(page,'manager',false,false,true);
  await expect(page.getByRole('button',{name:'Set up appointments',exact:true})).toHaveCount(0);
});

test('mobile appointment setup clears calendar access on pause and workspace change',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  await fixture(page,'owner',false,false,true);
  await page.getByRole('button',{name:'Set up appointments',exact:true}).click();
  await page.getByRole('combobox',{name:'Connected account',exact:true}).selectOption('22222222-2222-4222-8222-222222222222');
  await expect(page.getByRole('combobox',{name:'Appointment calendar',exact:true})).toBeEnabled();
  await page.getByRole('combobox',{name:'Appointment calendar',exact:true}).selectOption('work-calendar');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:'test-results/calendar-policy-fixture-mobile.png',fullPage:true});
  await page.getByRole('button',{name:'Open navigation'}).click();
  await page.getByRole('combobox',{name:'YOUR WORKSPACE',exact:true}).selectOption('business-b');
  await expect(page.getByRole('region',{name:'Appointment policy setup'})).toHaveCount(0);
  await fixture(page,'owner',true,false,true);
  await page.getByRole('button',{name:'Set up appointments',exact:true}).click();
  await expect(page.getByRole('combobox',{name:'Connected account',exact:true})).toBeDisabled();
});

const savedPolicy=()=>({id:'33333333-3333-4333-8333-333333333333',version:4,name:'Appointments',trigger:'Owner request',operation:'calendar.create',provider:'google',
  grantId:'22222222-2222-4222-8222-222222222222',mode:'approve',resources:['work-calendar'],recipients:['client@example.com'],startsAt:'2026-01-01T00:00:00.000Z',expiresAt:'2027-01-01T00:00:00.000Z',
  maxActionsPerDay:10,maxCostMicrosPerDay:0,escalation:'Ask the owner',enabled:true,authorizedBy:'fixture-user',updatedAt:'2026-09-16T00:00:00.000Z'});

test('owner can disable a saved policy while paused without changing its permissions',async({page})=>{
  await fixture(page,'owner',true);const bodies:any[]=[];let policy=savedPolicy();
  await page.route('**/action-policies',async route=>{
    if(route.request().method()==='GET')return route.fulfill({json:{policies:[policy]}});
    const body=route.request().postDataJSON();bodies.push(body);policy={...policy,...body,version:body.expectedVersion+1};
    return route.fulfill({json:{policy}});
  });
  await page.getByRole('button',{name:'Manage saved policies',exact:true}).click();
  await page.getByRole('button',{name:'Edit Appointments',exact:true}).click();
  await page.getByLabel('Policy enabled',{exact:true}).uncheck();
  expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze()).violations).toEqual([]);
  await page.getByRole('button',{name:'Save policy changes',exact:true}).click();
  await expect(page.getByRole('region',{name:'Saved policies'})).toContainText('Disabled · Version 5');
  expect(bodies).toHaveLength(1);expect(bodies[0]).toMatchObject({id:policy.id,expectedVersion:4,enabled:false,resources:['work-calendar'],recipients:['client@example.com'],expiresAt:'2027-01-01T00:00:00.000Z'});
  expect(bodies[0]).not.toHaveProperty('authorizedBy');expect(bodies[0]).not.toHaveProperty('updatedAt');
});

test('concurrent policy edits require refresh and never silently overwrite a newer version',async({page})=>{
  await fixture(page);let posts=0;
  await page.route('**/action-policies',async route=>{
    if(route.request().method()==='GET')return route.fulfill({json:{policies:[{...savedPolicy(),version:posts?5:4,name:posts?'Owner revision':'Appointments'}]}});
    posts++;return route.fulfill({status:409,json:{error:{code:'policy_version_conflict',message:'Refresh the policy before saving your changes.'}}});
  });
  await page.getByRole('button',{name:'Manage saved policies',exact:true}).click();
  await page.getByRole('button',{name:'Edit Appointments',exact:true}).click();
  await page.getByRole('button',{name:'Save policy changes',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('Refresh the policy');
  expect(posts).toBe(1);
  await page.getByRole('button',{name:'Refresh policies',exact:true}).click();
  await expect(page.getByRole('button',{name:'Edit Owner revision',exact:true})).toBeVisible();
  await expect(page.getByRole('form',{name:'Edit policy'})).toHaveCount(0);
});
test('reviews exact content and immutable hash, then shows permission without a delivery claim',async({page})=>{
  const calls=await fixture(page);
  await expect(page.getByText('customer@example.com',{exact:true})).toBeVisible();
  await expect(page.getByText('Your appointment request is being reviewed. <script>secret()</script>',{exact:true})).toBeVisible();
  expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze()).violations).toEqual([]);
  await page.getByRole('button',{name:'Approve action',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('Permission recorded. This is not a delivery or booking confirmation.');
  await expect(page.getByText('approved',{exact:true})).toBeVisible();
  expect(calls.find(call=>call.path.endsWith('/decision'))?.body).toEqual({decision:'approve',actionHash:'a'.repeat(64)});
  await page.screenshot({path:'test-results/approvals-fixture-desktop.png',fullPage:true});
});
test('paused agent prevents approval but permits rejection',async({page})=>{
  await fixture(page,'owner',true);
  await expect(page.getByRole('button',{name:'Approve action',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Reject action',exact:true}).click();
  await expect(page.getByText('rejected',{exact:true})).toBeVisible();
});
test('staff cannot decide and switching business clears previous customer content',async({page})=>{
  await fixture(page,'staff');
  await expect(page.getByText('customer@example.com',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Approve action',exact:true})).toHaveCount(0);
  await page.getByRole('combobox').selectOption('business-b');
  await expect(page.getByText('customer@example.com',{exact:true})).toHaveCount(0);
  await expect(page.getByRole('heading',{name:'No actions waiting for review'})).toBeVisible();
});
test('viewer cannot fetch private reviews',async({page})=>{
  const calls=await fixture(page,'viewer');
  await expect(page.getByRole('heading',{name:'Review access is limited'})).toBeVisible();
  expect(calls.some(call=>call.path.endsWith('/actions'))).toBe(false);
});
test('mobile review wraps content without horizontal overflow',async({page})=>{
  await page.setViewportSize({width:390,height:844});await fixture(page);
  await expect(page.getByText('customer@example.com',{exact:true})).toBeVisible();
  await expect.poll(()=>page.locator('.sidebar').evaluate(element=>element.getBoundingClientRect().right)).toBeLessThanOrEqual(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:'test-results/approvals-fixture-mobile.png',fullPage:true});
});
test('executes the exact approved action and distinguishes acceptance from delivery',async({page})=>{
  const calls=await fixture(page,'owner',false,'ready');
  await page.getByRole('button',{name:'Send approved reply'}).click();
  await expect(page.getByRole('status')).toContainText('Delivery is not yet confirmed.');
  await expect(page.getByLabel('Provider receipt')).toContainText('provider-receipt');
  await expect(page.getByRole('button',{name:'Send approved reply'})).toHaveCount(0);
  expect(calls.filter(call=>call.path.endsWith('/execute')).map(call=>call.body)).toEqual([{actionHash:'a'.repeat(64)}]);
});
test('an uncertain result refreshes durable status and never offers an automatic resend',async({page})=>{
  const calls=await fixture(page,'owner',false,'uncertain');
  await page.getByRole('button',{name:'Send approved reply'}).click();
  await expect(page.getByRole('alert')).toContainText('Reconciliation is required');
  await expect(page.getByText('uncertain',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Send approved reply'})).toHaveCount(0);
  expect(calls.filter(call=>call.path.endsWith('/execute'))).toHaveLength(1);
});
