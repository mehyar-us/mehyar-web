import {describe,it,expect,vi,beforeEach} from 'vitest';

/* Workstream 6g tenant isolation: skills, goals, runs and proposals of
 * business A are never visible to (or writable by) business B. Every read
 * and write path touched by this workstream binds the actor's tenant_id. */

const mockMembership=vi.hoisted(()=>({requireMembership:vi.fn()}));
vi.mock('../src/permissions',()=>({
 OPERATORS:['owner','manager'],
 KNOWLEDGE_ROLES:['owner','manager','billing'],
 requireMembership:mockMembership.requireMembership,
}));

import {prepareHarnessSkill} from '../src/business-harness';
import {readTenantSkills,matchTenantSkills,tenantSkillInstructionBlock} from '../src/business-harness-skill-invoke';

type Call={sql:string;args:unknown[]};
function fakeDb(){
 const calls:Call[]=[];
 const prepare=(sql:string)=>({bind:(...args:unknown[])=>{calls.push({sql,args});return{
  all:async()=>({results:[]}),
  first:async()=>null,
  run:async()=>({meta:{changes:1}}),
 };}});
 return {env:{AGENT_DB:{prepare}} as never,calls};
}
const actorA={tenantId:'tenant-a',userId:'op-a'};
const actorB={tenantId:'tenant-b',userId:'op-b'};

beforeEach(()=>{mockMembership.requireMembership.mockReset();mockMembership.requireMembership.mockResolvedValue({role:'owner'});});

describe('skill proposal write path is tenant-scoped',()=>{
 it('binds the actor tenant on every statement and stages a pending proposal, never a direct save',async()=>{
  const {env,calls}=fakeDb();
  const proposal=await prepareHarnessSkill(env,actorA,{
   revision:0,title:'VIP rule',instructions:'When a VIP calls: confirm the booking type.',
   allowedTools:['bookings'],archived:false,
  });
  expect(proposal.readback).toContain('VIP rule');
  expect(calls.length).toBeGreaterThan(0);
  // Every captured statement carries the requesting tenant in its binds.
  for(const call of calls)expect(call.args,call.sql).toContain('tenant-a');
  // The write goes to the proposals table as pending — a taught rule is never
  // silently auto-saved into mayor_harness_skills.
  const writes=calls.filter(call=>/INSERT INTO/i.test(call.sql));
  expect(writes.some(call=>/mayor_harness_proposals/.test(call.sql)&&/'pending'/.test(call.sql))).toBe(true);
  expect(writes.some(call=>/mayor_harness_skills/.test(call.sql))).toBe(false);
  // The permission guard always scopes the write to the same tenant.
  for(const call of writes)expect(call.sql).toContain('agent_memberships');
 });
 it('tenant B preparing a skill binds tenant B, never tenant A',async()=>{
  const {env,calls}=fakeDb();
  await prepareHarnessSkill(env,actorB,{revision:0,title:'B rule',instructions:'When X: do Y.',allowedTools:['tasks'],archived:false});
  for(const call of calls){
   expect(call.args).toContain('tenant-b');
   expect(call.args).not.toContain('tenant-a');
  }
 });
});

describe('skill read + invoke never crosses tenants',()=>{
 function twoTenantEnv(){
  const rows=[
   {id:'a1',tenant_id:'tenant-a',title:'A-only skill',instructions:'A secret routine for business A.'},
   {id:'b1',tenant_id:'tenant-b',title:'B-only skill',instructions:'B secret routine for business B.'},
  ];
  const calls:Call[]=[];
  const prepare=(sql:string)=>({bind:(...args:unknown[])=>{calls.push({sql,args});return{
   all:async()=>({results:rows.filter(row=>row.tenant_id===String(args[0]))}),
   first:async()=>null,
   run:async()=>({meta:{changes:0}}),
  };}});
  return {env:{AGENT_DB:{prepare}} as never,calls};
 }
 it('the read query filters by the bound tenant',async()=>{
  const {env,calls}=twoTenantEnv();
  const skills=await readTenantSkills(env,actorA);
  expect(skills.map(skill=>skill.id)).toEqual(['a1']);
  expect(calls[0].args[0]).toBe('tenant-a');
  expect(JSON.stringify(skills)).not.toContain('B-only');
 });
 it('the injected turn block contains only the requesting tenant\'s skills',async()=>{
  const {env}=twoTenantEnv();
  const skillsA=await readTenantSkills(env,actorA);
  const matched=matchTenantSkills(skillsA,'run the secret routine for the VIP');
  const block=tenantSkillInstructionBlock(matched);
  if(block){
   expect(block).not.toContain('B-only skill');
   expect(block).not.toContain('business B');
  }
  const skillsB=await readTenantSkills(env,actorB);
  expect(skillsB.map(skill=>skill.id)).toEqual(['b1']);
 });
});
