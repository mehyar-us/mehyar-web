import {env as testEnv} from 'cloudflare:workers';
import {it,expect} from 'vitest';
import type {Env} from '../../src/env';
import {runMvpMaintenance} from '../../src/mvp-maintenance';

const env=testEnv as unknown as Env,now=Date.parse('2026-10-05T12:34:56.000Z');
const timestamp=(offset:number)=>new Date(now+offset).toISOString();
async function proposalFixture(){
 const tenant=crypto.randomUUID(),user=crypto.randomUUID(),connection=crypto.randomUUID();
 await env.AGENT_DB.prepare('INSERT INTO agent_tenants(id,name,created_at) VALUES(?,?,?)').bind(tenant,'Maintenance fixture',timestamp(0)).run();
 await env.AGENT_DB.prepare(`INSERT INTO mayor_custom_connections(id,tenant_id,user_id,request_id,input_sha,label,type,endpoint_origin,ciphertext,has_secret,created_at,updated_at)
  VALUES(?,?,?,?,?,'Fixture','webhook','https://vendor.example','connection ciphertext',1,?,?)`).bind(connection,tenant,user,crypto.randomUUID(),'hash',timestamp(0),timestamp(0)).run();
 const insert=(id:string,state:string,createdAt:string,expiresAt:string)=>env.AGENT_DB.prepare(`INSERT INTO mayor_custom_tool_proposals(id,tenant_id,user_id,connection_id,connection_revision,request_id,tool,effect,ciphertext,input_sha,state,result_json,created_at,expires_at)
  VALUES(?,?,?,?,1,?,'send','write','proposal ciphertext','input hash',?,'{"saved":"result"}',?,?)`).bind(id,tenant,user,connection,crypto.randomUUID(),state,createdAt,expiresAt);
 return {insert};
}
it('preserves exact active hour/day/minute budgets and unknown/running proposal metadata',async()=>{
 const hour=Math.floor(now/3600000),day=Math.floor(now/86400000),minute=Math.floor(now/60000),unique=crypto.randomUUID();
 const buckets=[
  [`phone-verify:${unique}`,hour-49,false],[`phone-verify:${unique}`,hour-48,true],[`phone-verify:${unique}`,hour,true],
  [`custom:${unique}:day`,day-3,false],[`custom:${unique}:day`,day-2,true],[`custom:${unique}:day`,day,true],
  [`custom:${unique}:minute`,minute-2881,false],[`custom:${unique}:minute`,minute-2880,true],[`custom:${unique}:minute`,minute,true],
  [`mcp:call:${unique}`,minute-2881,false],[`mcp:call:${unique}`,minute,true],
  [`mayor:${unique}`,minute-2881,false],[`mayor:${unique}`,minute,true],
  [`usage:${unique}:daily`,minute-2881,false],[`usage:${unique}:daily`,minute,true],
 ] as const;
 await env.AGENT_DB.batch(buckets.map(([subject,bucket])=>env.AGENT_DB.prepare('INSERT INTO mayor_rate_limits(subject,bucket,count) VALUES(?,?,7)').bind(subject,bucket)));
 const {insert}=await proposalFixture(),expired=crypto.randomUUID(),active=crypto.randomUUID(),completed=crypto.randomUUID(),recent=crypto.randomUUID(),boundary=crypto.randomUUID(),unknown=crypto.randomUUID(),running=crypto.randomUUID();
 await env.AGENT_DB.batch([
  insert(expired,'prepared',timestamp(-600000),timestamp(-1)),insert(active,'prepared',timestamp(0),timestamp(300000)),
  insert(completed,'completed',timestamp(-8*86400000),timestamp(-8*86400000+300000)),insert(recent,'completed',timestamp(-10000),timestamp(290000)),
  insert(boundary,'completed',timestamp(-7*86400000),timestamp(-7*86400000+300000)),
  insert(unknown,'unknown',timestamp(-8*86400000),timestamp(-8*86400000)),insert(running,'running',timestamp(-8*86400000),timestamp(-8*86400000)),
 ]);
 const before=(await env.AGENT_DB.prepare('SELECT * FROM mayor_custom_tool_proposals WHERE id IN (?,?,?,?,?,?,?) ORDER BY id').bind(expired,active,completed,recent,boundary,unknown,running).all<any>()).results;
 expect(await runMvpMaintenance(env,now)).toEqual({rateLimitsDeleted:6,expiredPreparedPayloadsCleared:1,completedResultsCleared:1});
 for(const [subject,bucket,retained]of buckets){
  const row=await env.AGENT_DB.prepare('SELECT count FROM mayor_rate_limits WHERE subject=? AND bucket=?').bind(subject,bucket).first();
  expect(row).toEqual(retained?{count:7}:null);
 }
 const after=(await env.AGENT_DB.prepare('SELECT * FROM mayor_custom_tool_proposals WHERE id IN (?,?,?,?,?,?,?) ORDER BY id').bind(expired,active,completed,recent,boundary,unknown,running).all<any>()).results;
 expect(after).toEqual(before.map(row=>({...row,...(row.id===expired?{ciphertext:''}:{}),...(row.id===completed?{result_json:null}:{})})));
 expect(await runMvpMaintenance(env,now)).toEqual({rateLimitsDeleted:0,expiredPreparedPayloadsCleared:0,completedResultsCleared:0});
});
it('bounds each payload update and rate deletion to 500 rows per run',async()=>{
 const {insert}=await proposalFixture(),tag=crypto.randomUUID(),minute=Math.floor(now/60000);
 const statements=[];
 for(let i=0;i<501;i++){
  statements.push(env.AGENT_DB.prepare('INSERT INTO mayor_rate_limits(subject,bucket,count) VALUES(?,?,1)').bind(`mcp:${tag}:${i}`,minute-2881));
  statements.push(insert(crypto.randomUUID(),'prepared',timestamp(-600000),timestamp(-1)));
  statements.push(insert(crypto.randomUUID(),'completed',timestamp(-8*86400000),timestamp(-8*86400000)));
 }
 // Small setup batches stay within the local D1 request-size bounds.
 for(let i=0;i<statements.length;i+=90)await env.AGENT_DB.batch(statements.slice(i,i+90));
 expect(await runMvpMaintenance(env,now)).toEqual({rateLimitsDeleted:500,expiredPreparedPayloadsCleared:500,completedResultsCleared:500});
 expect(await runMvpMaintenance(env,now)).toEqual({rateLimitsDeleted:1,expiredPreparedPayloadsCleared:1,completedResultsCleared:1});
});
