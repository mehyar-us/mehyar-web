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
    if(path.endsWith('/team/revoke-member')){expect(request.postDataJSON()).toEqual({userId:'pat'});revoked=true;return reply({revoked:true});}
    if(path.endsWith('/team'))return reply({seatLimit:3,moreMembers:false,moreInvitations:false,members:[{id:'user',name:'Sam',email:'sam@example.test',role:'owner',status:'active',expiresAt:null},{id:'pat',name:'Pat',email:'pat@other.test',role:'staff',status:revoked?'revoked':'active',expiresAt:null}],invitations:created?[{id,email:'pat@example.test',role:'billing',status:'pending',expiresAt:'2026-09-23T00:00:00Z'}]:[]});
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
