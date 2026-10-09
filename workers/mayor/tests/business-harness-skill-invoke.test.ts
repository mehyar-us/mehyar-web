import {describe,it,expect} from 'vitest';
import {readTenantSkills,matchTenantSkills,tenantSkillInstructionBlock,type TenantSkill} from '../src/business-harness-skill-invoke';

const skills:TenantSkill[]=[
 {id:'s1',title:'VIP booking confirmation',instructions:'When a VIP customer calls: confirm the booking type and staff before quoting.'},
 {id:'s2',title:'Morning task review',instructions:'Before quoting any job, check the open tasks list for blockers.'},
 {id:'s3',title:'Unrelated',instructions:'Something about inventory counts and supplier deliveries.'},
];

describe('tenant skill matching',()=>{
 it('matches on a title keyword',()=>{
  const matched=matchTenantSkills(skills,'The caller is a VIP, confirm the booking type');
  expect(matched.map(skill=>skill.id)).toEqual(['s1']);
 });
 it('matches on several instruction keywords',()=>{
  const matched=matchTenantSkills(skills,'Check the open tasks before quoting this job');
  expect(matched.map(skill=>skill.id)).toEqual(['s2']);
 });
 it('does not match below the evidence threshold',()=>{
  expect(matchTenantSkills(skills,'Hello, how are you today?')).toEqual([]);
  expect(matchTenantSkills(skills,'')).toEqual([]);
 });
 it('ignores stop words and short filler',()=>{
  expect(matchTenantSkills(skills,'the and of to for')).toEqual([]);
 });
 it('returns at most two skills',()=>{
  const many=Array.from({length:5},(_,i)=>({id:`x${i}`,title:'booking confirmation task',instructions:'confirm booking task open'}));
  expect(matchTenantSkills(many,'confirm the booking and check the open task')).toHaveLength(2);
 });
 it('skips skills with empty instructions',()=>{
  const empty=[{id:'e1',title:'VIP booking confirmation',instructions:'   '}];
  expect(matchTenantSkills(empty,'VIP booking confirmation please')).toEqual([]);
 });
});

describe('skill instruction block',()=>{
 it('returns null when nothing matched',()=>{
  expect(tenantSkillInstructionBlock([])).toBeNull();
 });
 it('quotes the matched skill as data with a permission boundary',()=>{
  const block=tenantSkillInstructionBlock([skills[0]])!;
  expect(block).toContain('"VIP booking confirmation"');
  expect(block).toContain('confirm the booking type');
  expect(block).toContain('never grant permissions');
  expect(block).toContain('quoted business data');
 });
 it('bounds the injected length',()=>{
  const big=[{id:'b',title:'Big',instructions:'x'.repeat(5000)}];
  expect(tenantSkillInstructionBlock(big)!.length).toBeLessThanOrEqual(1500);
 });
});

describe('tenant-scoped skill read',()=>{
 function fakeEnv(rows:{id:string;tenant_id:string;title:string;instructions:string}[]){
  const calls:{sql:string;args:unknown[]}[]=[];
  const prepare=(sql:string)=>({bind:(...args:unknown[])=>{calls.push({sql,args});return{
   all:async()=>({results:rows.filter(row=>row.tenant_id===String(args[0]))}),
   first:async()=>null,
   run:async()=>({meta:{changes:0}}),
  };}});
  return {env:{AGENT_DB:{prepare}} as never,calls};
 }
 it('binds the actor tenant and never returns another tenant\'s rows',async()=>{
  const rows=[
   {id:'a1',tenant_id:'tenant-a',title:'A skill',instructions:'Do A.'},
   {id:'b1',tenant_id:'tenant-b',title:'B skill',instructions:'Do B.'},
  ];
  const {env,calls}=fakeEnv(rows);
  const result=await readTenantSkills(env,{tenantId:'tenant-a',userId:'op'});
  expect(result).toEqual([{id:'a1',title:'A skill',instructions:'Do A.'}]);
  expect(calls).toHaveLength(1);
  expect(calls[0].sql).toContain('WHERE tenant_id=?');
  expect(calls[0].args[0]).toBe('tenant-a');
  expect(JSON.stringify(result)).not.toContain('tenant-b');
 });
 it('tenant B sees only its own skills',async()=>{
  const rows=[
   {id:'a1',tenant_id:'tenant-a',title:'A skill',instructions:'Do A.'},
   {id:'b1',tenant_id:'tenant-b',title:'B skill',instructions:'Do B.'},
  ];
  const {env}=fakeEnv(rows);
  const result=await readTenantSkills(env,{tenantId:'tenant-b',userId:'op'});
  expect(result.map(skill=>skill.id)).toEqual(['b1']);
 });
});
