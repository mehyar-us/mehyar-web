import {test,expect,type Page} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
async function fixture(page:Page,{empty=false,role='owner'}={}){
  const tenant={id:'business-a',name:'Oak Studio',status:'active',agentName:'Mayor',planId:'business'};
  let joined=!empty,revoked=false,created=false,attempts=0;
  const keys:string[]=[],calls:string[]=[],id='a'.repeat(64);
  await page.route('**/api/**',async route=>{
    const request=route.request(),path=new URL(request.url()).pathname;calls.push(path);const reply=(json:unknown,status=200)=>route.fulfill({json,status});
    if(path==='/api/session')return reply({user:{id:'user',name:'Sam',email:'sam@example.test'}});
    if(path==='/api/auth/capabilities')return reply({providers:{google:{configured:false,capabilities:[]},microsoft:{configured:false,capabilities:[]}}});
    if(path==='/api/catalog')return reply({plans:[],addons:[],currency:'USD',commerceEnabled:false});
    if(path==='/api/auth/grants')return reply({grants:[]});
    if(path==='/api/tenants')return reply({tenants:joined?[tenant]:[]});
    if(path==='/api/invitations')return reply({invitations:empty&&!joined?[{id,businessName:tenant.name,role:'staff',expiresAt:'2026-09-23T00:00:00Z'}]:[],more:false});
    if(path==='/api/invitations/accept'){expect(request.postDataJSON()).toEqual({id});joined=true;return reply({tenantId:tenant.id});}
    if(path.endsWith('/team/invitations')){
      keys.push(request.headers()['x-idempotency-key']);expect(request.postDataJSON()).toEqual({email:'pat@example.test',role:'billing'});
      created=true;if(++attempts===1)return reply({error:{message:'Response could not be confirmed.'}},503);return reply({invitation:{id}});
    }
    if(path.endsWith('/team/revoke-member')){expect(request.postDataJSON()).toEqual({userId:'pat',expectedRevision:1});revoked=true;return reply({revoked:true});}
    if(path.endsWith('/team'))return reply({seatLimit:3,moreMembers:false,moreInvitations:false,members:[{id:'user',name:'Sam',email:'sam@example.test',role:'owner',status:'active',expiresAt:null},{id:'pat',name:'Pat',email:'pat@other.test',role:'staff',revision:1,status:revoked?'revoked':'active',expiresAt:null}],invitations:created?[{id,email:'pat@example.test',role:'billing',status:'pending',expiresAt:'2026-09-23T00:00:00Z'}]:[]});
    if(path.endsWith('/messages'))return reply({messages:[]});
    if(path.startsWith('/api/tenants/'))return reply({tenant,membership:{role},memory:[],connections:[],activity:[],usage:{}});
    return reply({error:{message:'Unavailable fixture action'}},503);
  });return {keys,calls};
}
test('owner creates an invitation with exact retry and confirms member removal',async({page})=>{
  const {keys}=await fixture(page);await page.goto('/');await page.getByRole('button',{name:'Team',exact:true}).click();const team=page.getByRole('region',{name:'Manage team'});
  await team.getByLabel('Email address').fill('pat@example.test');await team.getByLabel('Team role').selectOption('billing');await team.getByRole('button',{name:'Create invitation'}).click();
  await expect(team.getByRole('alert')).toContainText('Response could not be confirmed');await expect(team.getByLabel('Email address')).toBeDisabled();
  await team.getByRole('button',{name:'Retry invitation'}).click();await expect(team.getByText('pat@example.test',{exact:true})).toBeVisible();expect(keys).toHaveLength(2);expect(keys[0]).toBe(keys[1]);
  await team.getByRole('button',{name:'Remove access for Pat'}).click();await team.getByRole('button',{name:'Confirm removal'}).click();
  await expect(team.getByText('staff · revoked',{exact:true})).toBeVisible();
  expect((await new AxeBuilder({page}).include('[aria-label="Manage team"]').analyze()).violations).toEqual([]);
});
test('a signed-in invitee joins before creating a separate business',async({page})=>{
  await fixture(page,{empty:true,role:'staff'});await page.goto('/');
  await page.getByRole('button',{name:'Accept invitation to Oak Studio'}).click();
  await expect(page.getByLabel('YOUR WORKSPACE')).toHaveValue('business-a');
  await page.goto('/');await page.getByRole('button',{name:'Team',exact:true}).click();await expect(page.getByText('The business owner manages team invitations and access.',{exact:false})).toBeVisible();
  await expect(page.getByRole('region',{name:'Manage team'})).toHaveCount(0);
});
test('non-owners never request the private team directory',async({page})=>{
  const {calls}=await fixture(page,{role:'manager'});await page.goto('/');await page.getByRole('button',{name:'Team',exact:true}).click();
  await expect(page.getByText('The business owner manages team invitations and access.',{exact:false})).toBeVisible();
  expect(calls.some(path=>path.endsWith('/team'))).toBe(false);
});

test('role changes preserve the exact request after an uncertain response and refresh the saved role',async({page})=>{
  await fixture(page);let role='staff',revision=1;const attempts:{key:string;body:unknown}[]=[];
  await page.route('**/api/tenants/business-a/team',route=>route.fulfill({json:{seatLimit:3,moreMembers:false,moreInvitations:false,invitations:[],members:[{id:'pat',name:'Pat',email:'pat@example.test',role,status:'active',revision,expiresAt:null}]}}));
  await page.route('**/api/tenants/business-a/team/role',route=>{
    attempts.push({key:route.request().headers()['x-idempotency-key'],body:route.request().postDataJSON()});role='billing';revision=2;
    return attempts.length===1?route.fulfill({status:503,json:{error:{message:'Confirmation unavailable. Retry the same change.'}}}):route.fulfill({json:{recorded:true,role,revision}});
  });
  await page.goto('/');await page.getByRole('button',{name:'Team',exact:true}).click();
  const form=page.getByRole('form',{name:'Change role for Pat'});
  await form.getByLabel('Role for Pat').selectOption('billing');await expect(form).toContainText('Change this member from staff to billing?');
  await form.getByRole('button',{name:'Confirm role change'}).click();await expect(form.getByRole('alert')).toContainText('Confirmation unavailable');
  await expect(form.getByLabel('Role for Pat')).toBeDisabled();await form.getByRole('button',{name:'Retry role change'}).click();
  await expect(page.getByText('billing · active',{exact:true})).toBeVisible();expect(attempts).toHaveLength(2);expect(attempts[0]).toEqual(attempts[1]);expect(attempts[0].body).toEqual({userId:'pat',role:'billing',expectedRevision:1});
  expect((await new AxeBuilder({page}).include('[aria-label="Manage team"]').analyze()).violations).toEqual([]);
});

test('a stale role edit requires a refreshed membership before another change',async({page})=>{
  await fixture(page);let revision=1;
  await page.route('**/api/tenants/business-a/team',route=>route.fulfill({json:{seatLimit:3,moreMembers:false,moreInvitations:false,invitations:[],members:[{id:'pat',name:'Pat',email:'pat@example.test',role:revision===1?'staff':'viewer',status:'active',revision,expiresAt:null}]}}));
  await page.route('**/api/tenants/business-a/team/role',route=>{revision=3;return route.fulfill({status:409,json:{error:{code:'membership_changed',message:'Refresh the team list.'}}});});
  await page.goto('/');await page.getByRole('button',{name:'Team',exact:true}).click();const form=page.getByRole('form',{name:'Change role for Pat'});
  await form.getByLabel('Role for Pat').selectOption('manager');await form.getByRole('button',{name:'Confirm role change'}).click();
  await expect(form.getByRole('alert')).toHaveText('Refresh the team list.');await expect(form.getByRole('button',{name:'Retry role change'})).toBeDisabled();
  await page.getByRole('button',{name:'Refresh team',exact:true}).click();await expect(form.getByLabel('Role for Pat')).toHaveValue('viewer');await expect(form.getByLabel('Role for Pat')).toBeEnabled();
});

test('uncertain member removal retries the original membership revision and request key',async({page})=>{
  await fixture(page);let removed=false;const requests:{body:unknown;key:string}[]=[];
  await page.route('**/api/tenants/business-a/team',route=>route.fulfill({json:{seatLimit:3,moreMembers:false,moreInvitations:false,invitations:[],members:[{id:'pat',name:'Pat',email:'pat@example.test',role:'staff',status:removed?'revoked':'active',revision:removed?8:7,expiresAt:null}]}}));
  await page.route('**/api/tenants/business-a/team/revoke-member',route=>{
    requests.push({body:route.request().postDataJSON(),key:route.request().headers()['x-idempotency-key']});removed=true;
    return requests.length===1?route.fulfill({status:503,json:{error:{message:'Removal confirmation unavailable.'}}}):route.fulfill({json:{recorded:true,revision:8}});
  });
  await page.goto('/');await page.getByRole('button',{name:'Team',exact:true}).click();
  await page.getByRole('button',{name:'Remove access for Pat'}).click();await page.getByRole('button',{name:'Confirm removal'}).click();
  await expect(page.getByRole('region',{name:'Manage team'}).getByRole('alert')).toHaveText('Removal confirmation unavailable.');
  await page.getByRole('button',{name:'Confirm removal'}).click();await expect(page.getByText('staff · revoked',{exact:true})).toBeVisible();
  expect(requests).toHaveLength(2);expect(requests[0]).toEqual(requests[1]);expect(requests[0].body).toEqual({userId:'pat',expectedRevision:7});expect(requests[0].key).toBeTruthy();
});

test('team lists load independently and discard private pages when continuation fails',async({page})=>{
  await fixture(page);let failure=false;const queries:string[]=[];
  const member=(id:string)=>({id,name:id,email:`${id}@example.test`,role:'staff',status:'revoked',revision:2,expiresAt:null});
  const invite=(id:string)=>({id,email:`${id}@example.test`,role:'staff',status:'revoked',expiresAt:'2026-09-23T00:00:00Z'});
  await page.route('**/api/tenants/business-a/team?*',route=>{
    const url=new URL(route.request().url());queries.push(url.search);
    if(failure)return route.fulfill({status:403,json:{error:{message:'Team access is unavailable.'}}});
    return route.fulfill({json:{seatLimit:3,members:[member('older-member')],invitations:[invite('older-invite')],moreMembers:false,moreInvitations:false,nextMembersCursor:null,nextInvitationsCursor:null}});
  });
  await page.route('**/api/tenants/business-a/team',route=>route.fulfill({json:{seatLimit:3,members:[member('first-member')],invitations:[invite('first-invite')],moreMembers:true,moreInvitations:true,nextMembersCursor:'member-cursor',nextInvitationsCursor:'invite-cursor'}}));
  await page.goto('/');await page.getByRole('button',{name:'Team',exact:true}).click();const team=page.getByRole('region',{name:'Manage team'});
  await team.getByRole('button',{name:'Load more members'}).click();await expect(team.getByText('older-member',{exact:true})).toBeVisible();await expect(team.getByText('older-invite@example.test',{exact:true})).toHaveCount(0);
  await team.getByRole('button',{name:'Load older invitations'}).click();await expect(team.getByText('older-invite@example.test',{exact:true})).toBeVisible();await expect(team.getByText('first-member',{exact:true})).toBeVisible();
  expect(queries).toEqual(['?membersCursor=member-cursor','?invitationsCursor=invite-cursor']);
  await team.getByRole('button',{name:'Refresh team',exact:true}).click();await expect(team.getByText('older-member',{exact:true})).toHaveCount(0);
  failure=true;await team.getByRole('button',{name:'Load more members'}).click();await expect(team.getByRole('alert')).toHaveText('Team access is unavailable.');await expect(team.getByText('first-member',{exact:true})).toHaveCount(0);
});
