import {describe,it,expect,vi,beforeEach,afterEach} from 'vitest';
import {HttpError} from '../src/http';
import type {Env} from '../src/env';
import {
 isInstagramDmEnabled,redactSecret,resolveTenantForPage,parseInstagramEvent,
 buildUnansweredLeadRow,ingestInstagramDm,handleInstagramWebhook,
} from '../src/instagram-dm';

/** Crew 6f: Instagram DM ingestion — DARK behind INSTAGRAM_DM_ENABLED.
 * No real Meta calls anywhere; the DB is an in-memory mock. */

const TENANT='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const PAGE='page9';
const SENDER='sender42';

function env(overrides:Record<string,string>={}):Env{
 return {
  INSTAGRAM_DM_ENABLED:'0',
  INSTAGRAM_VERIFY_TOKEN:'sekrit-verify-token',
  INSTAGRAM_PAGE_TOKEN:'sekrit-page-token',
  INSTAGRAM_DM_TENANT_MAP:JSON.stringify({[PAGE]:TENANT}),
  ...overrides,
 } as unknown as Env;
}

/** Minimal D1 mock: emulates the idempotent INSERT ... WHERE NOT EXISTS. */
function mockDb(){
 const rows:Record<string,unknown>[]=[];
 const prepareCalls:string[]=[];
 const db={
  prepare(sql:string){
   prepareCalls.push(sql);
   let bound:unknown[]=[];
   const stmt={
    bind(...args:unknown[]){bound=args;return stmt;},
    async run(){
     if(sql.includes('INSERT INTO mayor_sms_log')){
      const id=bound[0];
      if(rows.some(r=>r.id===id))return {meta:{changes:0}};
      const cols=['id','tenant_id','direction','to_number','from_number','body','provider_message_id','status','created_at'];
      rows.push(Object.fromEntries(cols.map((k,i)=>[k,bound[i]])));
      return {meta:{changes:1}};
     }
     return {meta:{changes:0}};
    },
    async first(){return null;},
    async all(){return {results:[]} as never;},
    batch(){return Promise.resolve([]);},
   };
   return stmt;
  },
 } as unknown as Env['AGENT_DB'];
 return {db,rows,prepareCalls};
}

function dmEvent(message:object,entryId=PAGE,timestamp=1699999999000){
 return {
  object:'instagram',
  entry:[{id:entryId,time:timestamp,messaging:[{
   sender:{id:SENDER},recipient:{id:entryId},timestamp,message,
  }]}],
 };
}
const post=(body:unknown)=>new Request('https://worker.test/api/webhooks/instagram',{
 method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
const get=(query:string)=>new Request(`https://worker.test/api/webhooks/instagram?${query}`);

let logged:string[];
const origLog=console.log,origWarn=console.warn;
beforeEach(()=>{logged=[];console.log=(...a:unknown[])=>{logged.push(a.join(' '));};console.warn=(...a:unknown[])=>{logged.push(a.join(' '));};});
afterEach(()=>{console.log=origLog;console.warn=origWarn;vi.restoreAllMocks();});

describe('feature flag',()=>{
 it('is dark by default (unset) and for any non-"1" value',()=>{
  expect(isInstagramDmEnabled(env({INSTAGRAM_DM_ENABLED:undefined as never}))).toBe(false);
  expect(isInstagramDmEnabled(env({}))).toBe(false);
  for(const v of ['0','','false','true','yes'])expect(isInstagramDmEnabled(env({INSTAGRAM_DM_ENABLED:v}))).toBe(false);
 });
 it('is enabled only when explicitly "1"',()=>{
  expect(isInstagramDmEnabled(env({INSTAGRAM_DM_ENABLED:'1'}))).toBe(true);
 });
});

describe('dark mode: route 404s, nothing executes',()=>{
 it('GET verification returns 404 when dark',async()=>{
  await expect(handleInstagramWebhook(get('hub.mode=subscribe&hub.verify_token=sekrit-verify-token&hub.challenge=abc'),env())).rejects.toMatchObject({status:404});
 });
 it('POST events return 404 when dark and never touch the DB',async()=>{
  const {db,prepareCalls}=mockDb();
  const e=env();(e as {AGENT_DB:unknown}).AGENT_DB=db;
  await expect(handleInstagramWebhook(post(dmEvent({mid:'mid.1',text:'hi'})),e)).rejects.toMatchObject({status:404});
  expect(prepareCalls).toHaveLength(0);
 });
 it('non-POST/GET methods 404 when dark too',async()=>{
  const req=new Request('https://worker.test/api/webhooks/instagram',{method:'PUT'});
  await expect(handleInstagramWebhook(req,env())).rejects.toMatchObject({status:404});
 });
});

describe('verification handshake (flag on)',()=>{
 it('returns the challenge when the token matches',async()=>{
  const res=await handleInstagramWebhook(get('hub.mode=subscribe&hub.verify_token=sekrit-verify-token&hub.challenge=challenge-123'),env({INSTAGRAM_DM_ENABLED:'1'}));
  expect(res.status).toBe(200);
  expect(await res.text()).toBe('challenge-123');
 });
 it('rejects a wrong token with 403 and never logs the secret',async()=>{
  await expect(handleInstagramWebhook(get('hub.mode=subscribe&hub.verify_token=wrong-token&hub.challenge=x'),env({INSTAGRAM_DM_ENABLED:'1'}))).rejects.toMatchObject({status:403});
  expect(logged.join('\n')).not.toContain('sekrit-verify-token');
 });
 it('rejects missing challenge / wrong mode with 403',async()=>{
  const e=env({INSTAGRAM_DM_ENABLED:'1'});
  await expect(handleInstagramWebhook(get('hub.mode=subscribe&hub.verify_token=sekrit-verify-token'),e)).rejects.toMatchObject({status:403});
  await expect(handleInstagramWebhook(get('hub.mode=unsubscribe&hub.verify_token=sekrit-verify-token&hub.challenge=x'),e)).rejects.toMatchObject({status:403});
 });
});

describe('event parsing',()=>{
 it('parses a text DM',()=>{
  const dm=parseInstagramEvent(PAGE,dmEvent({mid:'mid.1',text:'do you have slots tomorrow?'}).entry[0].messaging[0]);
  expect(dm).toMatchObject({isEcho:false,senderId:SENDER,pageId:PAGE,mid:'mid.1',text:'do you have slots tomorrow?',hasAttachment:false,timestampMs:1699999999000});
 });
 it('parses an attachment-only DM as non-text',()=>{
  const dm=parseInstagramEvent(PAGE,dmEvent({mid:'mid.2',attachments:[{type:'image'}]}).entry[0].messaging[0]);
  expect(dm).toMatchObject({isEcho:false,text:null,hasAttachment:true});
 });
 it('flags own echoes by is_echo',()=>{
  const dm=parseInstagramEvent(PAGE,dmEvent({mid:'mid.3',text:'hi',is_echo:true}).entry[0].messaging[0]);
  expect(dm?.isEcho).toBe(true);
 });
 it('flags echoes when sender equals recipient',()=>{
  const dm=parseInstagramEvent(PAGE,{sender:{id:PAGE},recipient:{id:PAGE},timestamp:1,message:{mid:'mid.4',text:'hi'}});
  expect(dm?.isEcho).toBe(true);
 });
 it('ignores non-message events (postback, read)',()=>{
  expect(parseInstagramEvent(PAGE,{sender:{id:SENDER},recipient:{id:PAGE},timestamp:1,postback:{payload:'X'}})).toBeNull();
  expect(parseInstagramEvent(PAGE,{sender:{id:SENDER},recipient:{id:PAGE},timestamp:1})).toBeNull();
 });
 it('rejects malformed events',()=>{
  expect(parseInstagramEvent(PAGE,{garbage:true})).toBeNull();
 });
});

describe('unanswered-lead detector input shape',()=>{
 it('builds the exact row shape detectUnansweredLeads consumes',()=>{
  const dm=parseInstagramEvent(PAGE,dmEvent({mid:'mid.9',text:'hey'}).entry[0].messaging[0])!;
  const row=buildUnansweredLeadRow(TENANT,dm);
  // The detector SELECTs id, from_number, body, created_at for direction='inbound'.
  expect(row).toMatchObject({direction:'inbound',tenant_id:TENANT});
  expect(row.id).toBe('igdm:mid.9');
  expect(row.from_number).toBe(`ig:${SENDER}`);
  expect(row.body).toBe('hey');
  expect(row.created_at).toBe(new Date(1699999999000).toISOString());
  expect(Object.keys(row).sort()).toEqual(['body','created_at','direction','from_number','id','provider_message_id','status','tenant_id','to_number'].sort());
 });
});

describe('ingestion',()=>{
 it('ingests a text DM and ignores echoes, attachments recorded, duplicates idempotent',async()=>{
  const {db,rows}=mockDb();
  const e=env({INSTAGRAM_DM_ENABLED:'1'});(e as {AGENT_DB:unknown}).AGENT_DB=db;
  const dm=parseInstagramEvent(PAGE,dmEvent({mid:'mid.1',text:'hi'}).entry[0].messaging[0])!;
  expect(await ingestInstagramDm(e,TENANT,dm)).toBe(true);
  expect(rows).toHaveLength(1);
  // Same mid again → not a duplicate, returns false.
  expect(await ingestInstagramDm(e,TENANT,dm)).toBe(false);
  expect(rows).toHaveLength(1);
  // Echo → never ingested.
  const echo=parseInstagramEvent(PAGE,dmEvent({mid:'mid.2',text:'hi',is_echo:true}).entry[0].messaging[0])!;
  expect(await ingestInstagramDm(e,TENANT,echo)).toBe(false);
  expect(rows).toHaveLength(1);
  // Attachment → ingested with a placeholder body.
  const att=parseInstagramEvent(PAGE,dmEvent({mid:'mid.3',attachments:[{type:'image'}]}).entry[0].messaging[0])!;
  expect(await ingestInstagramDm(e,TENANT,att)).toBe(true);
  expect(rows[1].body).toBe('[attachment received]');
 });
});

describe('POST handler (flag on)',()=>{
 it('ingests DMs and reports counts',async()=>{
  const {db,rows}=mockDb();
  const e=env({INSTAGRAM_DM_ENABLED:'1'});(e as {AGENT_DB:unknown}).AGENT_DB=db;
  const res=await handleInstagramWebhook(post(dmEvent({mid:'mid.1',text:'hi'})),e);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({received:true,ingested:1,skipped:0});
  expect(rows).toHaveLength(1);
 });
 it('skips echoes and unknown pages without failing',async()=>{
  const {db,rows}=mockDb();
  const e=env({INSTAGRAM_DM_ENABLED:'1'});(e as {AGENT_DB:unknown}).AGENT_DB=db;
  const body={object:'instagram',entry:[
   {id:PAGE,messaging:[{sender:{id:SENDER},recipient:{id:PAGE},timestamp:1,message:{mid:'m1',text:'hi',is_echo:true}}]},
   {id:'unknown-page',messaging:[{sender:{id:SENDER},recipient:{id:'unknown-page'},timestamp:1,message:{mid:'m2',text:'hi'}}]},
  ]};
  const res=await handleInstagramWebhook(post(body),e);
  expect(await res.json()).toEqual({received:true,ingested:0,skipped:2});
  expect(rows).toHaveLength(0);
 });
 it('rejects non-instagram payloads with 400',async()=>{
  const e=env({INSTAGRAM_DM_ENABLED:'1'});
  await expect(handleInstagramWebhook(post({object:'page',entry:[]}),e)).rejects.toMatchObject({status:400});
 });
 it('returns 405 for other methods when enabled',async()=>{
  const req=new Request('https://worker.test/api/webhooks/instagram',{method:'DELETE'});
  await expect(handleInstagramWebhook(req,env({INSTAGRAM_DM_ENABLED:'1'}))).rejects.toMatchObject({status:405});
 });
});

describe('tenant resolution',()=>{
 it('maps configured pages, rejects unknown/malformed maps',()=>{
  expect(resolveTenantForPage(env({INSTAGRAM_DM_ENABLED:'1'}),PAGE)).toBe(TENANT);
  expect(resolveTenantForPage(env({INSTAGRAM_DM_ENABLED:'1'}),'nope')).toBeNull();
  expect(resolveTenantForPage(env({INSTAGRAM_DM_ENABLED:'1',INSTAGRAM_DM_TENANT_MAP:'not-json'}),PAGE)).toBeNull();
  expect(resolveTenantForPage(env({INSTAGRAM_DM_ENABLED:'1',INSTAGRAM_DM_TENANT_MAP:JSON.stringify({[PAGE]:'not-a-tenant'})}),PAGE)).toBeNull();
  expect(resolveTenantForPage(env({INSTAGRAM_DM_ENABLED:'1',INSTAGRAM_DM_TENANT_MAP:undefined as never}),PAGE)).toBeNull();
 });
});

describe('secret hygiene',()=>{
 it('redactSecret never returns the value',()=>{
  expect(redactSecret('sekrit-verify-token')).toBe('set');
  expect(redactSecret('')).toBe('unset');
  expect(redactSecret(undefined)).toBe('unset');
  expect(redactSecret(null)).toBe('unset');
 });
 it('no handler path logs the verify token or page token',async()=>{
  const {db}=mockDb();
  const e=env({INSTAGRAM_DM_ENABLED:'1'});(e as {AGENT_DB:unknown}).AGENT_DB=db;
  await handleInstagramWebhook(post(dmEvent({mid:'mid.1',text:'hi there'})),e).catch(()=>{});
  await handleInstagramWebhook(get('hub.mode=subscribe&hub.verify_token=nope&hub.challenge=x'),e).catch(()=>{});
  await handleInstagramWebhook(get('hub.mode=subscribe&hub.verify_token=sekrit-verify-token&hub.challenge=ok'),e).catch(()=>{});
  const out=logged.join('\n');
  expect(out).not.toContain('sekrit-verify-token');
  expect(out).not.toContain('sekrit-page-token');
  // Sanity: we did log *something* structured, just without secrets.
  expect(out).toContain('instagram_dm_ingested');
 });
 it('HttpError messages carry no secrets',async()=>{
  try{
   await handleInstagramWebhook(get('hub.mode=subscribe&hub.verify_token=nope&hub.challenge=x'),env({INSTAGRAM_DM_ENABLED:'1'}));
   expect.unreachable();
  }catch(err){
   expect(err).toBeInstanceOf(HttpError);
   expect((err as HttpError).message).not.toContain('sekrit-verify-token');
  }
 });
});
