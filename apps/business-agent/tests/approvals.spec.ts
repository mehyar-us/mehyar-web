import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Browser contract fixtures. No email, booking or live authorization occurs.
async function fixture(page:Page,role='owner',paused=false) {
  const calls:{path:string;body:any}[]=[];
  let status='pending';
  const action={id:'11111111-1111-4111-8111-111111111111',requestedBy:'fixture-user',policyId:'policy-one',policyVersion:3,
    actionHash:'a'.repeat(64),status,createdAt:'2026-09-16T12:00:00Z',expiresAt:'2027-01-01T12:00:00Z',approvedBy:null,approvedAt:null,reason:null,
    executionAvailable:false,executionNote:'Approval records permission only. Connector execution is not enabled yet.',
    action:{operation:'mail.reply',resourceId:'customer-thread',messageId:'original-message',recipient:'customer@example.com',text:'Your appointment request is being reviewed. <script>secret()</script>'}};
  const tenants=[{id:'business-a',name:'Oak Studio',status:'trial'},{id:'business-b',name:'Second Studio',status:'trial'}];
  await page.route('**/api/**',async route=>{
    const request=route.request(),path=new URL(request.url()).pathname;
    const body=request.method()==='POST'?request.postDataJSON():undefined;
    calls.push({path,body});const reply=(json:unknown)=>route.fulfill({json});
    if(path==='/api/session') return reply({user:{id:'fixture-user',name:'Sam',email:'sam@example.test'}});
    if(path==='/api/auth/capabilities') return reply({providers:{google:{configured:false,capabilities:[]},microsoft:{configured:false,capabilities:[]}}});
    if(path==='/api/auth/grants')return reply({grants:[]});
    if(path==='/api/catalog')return reply({version:'fixture',currency:'USD',plans:[],addons:[]});
    if(path==='/api/tenants')return reply({tenants});
    if(path.endsWith('/messages'))return reply({messages:[]});
    if(path.endsWith('/decision')) {status=body.decision==='approve'?'approved':'rejected';return reply({action:{...action,status}});}
    if(path.endsWith('/actions'))return reply({actions:path.includes('business-b')?[]:[{...action,status}]});
    if(path.startsWith('/api/tenants/'))return reply({tenant:tenants.find(t=>path.endsWith(t.id)),membership:{role},memory:[],activity:[],connections:[],usage:{paused}});
    return route.fulfill({status:404,json:{error:{message:'Fixture route not found'}}});
  });
  await page.goto('/');
  if((page.viewportSize()?.width??1440)<768) await page.getByRole('button',{name:'Open navigation'}).click();
  await page.getByRole('button',{name:'Approvals',exact:true}).click();
  return calls;
}
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
