import {describe,it,expect} from 'vitest';
import {handleLeadsPublic,deliverPendingLeadEmails,deliverLoopEmails,CHECKLIST_EMAIL_SUBJECT,LOOP_INTERVAL_MS} from '../src/leads';

/* Checklist email leg (CoC ruling 2026-10-17): Email 1 fires on
 * capture. A stateful fake D1 + a recording SendEmail stand in for
 * the real binding, mirroring the leads.test.ts pattern. */

type LeadRow={id:string;email:string;source:string;created_at:number;email1_sent_at:number|null;email1_attempts:number;unsubscribed_at:number|null;loop_last_sent_at:number|null;loop_attempts:number};

function fakeDb(){
 const leads:LeadRow[]=[];
 const prepare=(sql:string)=>({bind:(...args:unknown[])=>({
  first:async()=>{
   if(sql.includes('mayor_rate_limits'))return {count:1};
   if(sql.includes('FROM mayor_sales_leads WHERE email=?'))return leads.find(l=>l.email===args[0])??null;
   return null;
  },
  all:async()=>{
   if(sql.includes('loop_last_sent_at')&&sql.includes('email1_sent_at IS NOT NULL')){
    const cutoff=args[0] as number;
    return {results:leads.filter(l=>l.email1_sent_at!=null&&l.email1_sent_at<=cutoff&&l.unsubscribed_at==null&&l.loop_attempts<3&&(l.loop_last_sent_at==null||l.loop_last_sent_at<=cutoff))};
   }
   return {results:leads.filter(l=>l.email1_sent_at==null&&l.unsubscribed_at==null&&l.email1_attempts<3&&l.created_at>(args[0] as number))};
  },
  run:async()=>{
   if(sql.startsWith('INSERT OR IGNORE INTO mayor_sales_leads')){
    if(!leads.some(l=>l.email===args[1]))leads.push({id:String(args[0]),email:String(args[1]),source:String(args[2]),created_at:Number(args[3]),email1_sent_at:null,email1_attempts:0,unsubscribed_at:null,loop_last_sent_at:null,loop_attempts:0});
    return {success:true,meta:{changes:1}};
   }
   if(sql.includes('SET email1_sent_at')){const l=leads.find(x=>x.id===args[1]);if(l)l.email1_sent_at=Number(args[0]);return {success:true};}
   if(sql.includes('SET email1_attempts')){const l=leads.find(x=>x.id===args[0]);if(l)l.email1_attempts++;return {success:true};}
   if(sql.includes('SET loop_last_sent_at')){const l=leads.find(x=>x.id===args[1]);if(l){l.loop_last_sent_at=Number(args[0]);l.loop_attempts=0;}return {success:true};}
   if(sql.includes('SET loop_attempts')){const l=leads.find(x=>x.id===args[0]);if(l)l.loop_attempts++;return {success:true};}
   if(sql.includes('SET unsubscribed_at')){const l=leads.find(x=>x.email===args[1]);if(l)l.unsubscribed_at=Number(args[0]);return {success:true};}
   return {success:true};
  },
 })});
 return {db:{prepare} as never,leads};
}
function post(fields:Record<string,string>,path='/api/leads'){
 return new Request(`https://mayor.mehyar.us${path}`,{method:'POST',body:new URLSearchParams(fields),headers:{'content-type':'application/x-www-form-urlencoded'}});
}
function mailer(fail=false){
 const sent:{to:string;subject:string;text:string}[]=[];
 return {sent,impl:{send:async(m:{to:string;subject:string;text:string})=>{if(fail)throw new Error('send failed');sent.push(m);return {};}} as never};
}

describe('checklist Email 1 — on-capture delivery',()=>{
 it('sends Email 1 on capture with the §4 footer, exactly once',async()=>{
  const {db,leads}=fakeDb();
  const {sent,impl}=mailer();
  const env={AGENT_DB:db,MAYOR_EMAIL:impl,MAYOR_EMAIL_FROM:'mayor@mehyar.us'};
  const res=await handleLeadsPublic(post({email:'owner@example.com',source:'sales'}),env);
  expect(res!.status).toBe(200);
  expect(sent).toHaveLength(1);
  expect(sent[0].to).toBe('owner@example.com');
  expect(sent[0].subject).toBe(CHECKLIST_EMAIL_SUBJECT);
  expect(sent[0].text).toContain('THE MISSED-CALL REVENUE CHECKLIST');
  expect(sent[0].text).toContain("$79.20/mo for life for the first 25 businesses.");
  expect(sent[0].text).toContain('/api/leads/unsubscribe?e=owner%40example.com');
  expect(leads[0].email1_sent_at).not.toBeNull();
  // Re-submitting the same email sends nothing twice.
  await handleLeadsPublic(post({email:'owner@example.com',source:'sales'}),env);
  expect(sent).toHaveLength(1);
 });

 it('a failed send never fails the capture and the cron retry lands it',async()=>{
  const {db,leads}=fakeDb();
  const failing=mailer(true);
  const envFail={AGENT_DB:db,MAYOR_EMAIL:failing.impl,MAYOR_EMAIL_FROM:'mayor@mehyar.us'};
  const res=await handleLeadsPublic(post({email:'retry@example.com',source:'sales'}),envFail);
  expect(res!.status).toBe(200);
  expect(leads[0].email1_sent_at).toBeNull();
  expect(leads[0].email1_attempts).toBe(1);
  const good=mailer();
  const result=await deliverPendingLeadEmails({AGENT_DB:db,MAYOR_EMAIL:good.impl,MAYOR_EMAIL_FROM:'mayor@mehyar.us'});
  expect(result).toEqual({attempted:1,sent:1});
  expect(leads[0].email1_sent_at).not.toBeNull();
 });

 it('the monthly loop fires on schedule with the §4 ask, and only when due',async()=>{
  const {db,leads}=fakeDb();
  const good=mailer();
  const env={AGENT_DB:db,MAYOR_EMAIL:good.impl,MAYOR_EMAIL_FROM:'mayor@mehyar.us'};
  await handleLeadsPublic(post({email:'loop@example.com',source:'sales'}),env);
  expect(good.sent).toHaveLength(1); // Email 1 only — the loop is not due
  const t0=leads[0].email1_sent_at!;
  expect(await deliverLoopEmails(env,t0+LOOP_INTERVAL_MS-1000)).toEqual({attempted:0,sent:0});
  const due=await deliverLoopEmails(env,t0+LOOP_INTERVAL_MS+1000);
  expect(due).toEqual({attempted:1,sent:1});
  expect(good.sent).toHaveLength(2);
  expect(good.sent[1].subject).toBe('Your monthly missed-call count');
  expect(good.sent[1].text).toContain("claim a founding seat before the 25 are gone: $79.20/mo for life (list $99/mo), at mayor.mehyar.us/sales.");
  expect(good.sent[1].text).toContain('/api/leads/unsubscribe?e=loop%40example.com');
  expect(leads[0].loop_last_sent_at).toBe(t0+LOOP_INTERVAL_MS+1000);
  // Not due again until the next month passes.
  expect(await deliverLoopEmails(env,t0+LOOP_INTERVAL_MS+2000)).toEqual({attempted:0,sent:0});
 });

 it('unsubscribe marks the lead and the retry pass skips it',async()=>{
  const {db,leads}=fakeDb();
  const {impl}=mailer(true);
  const env={AGENT_DB:db,MAYOR_EMAIL:impl,MAYOR_EMAIL_FROM:'mayor@mehyar.us'};
  await handleLeadsPublic(post({email:'bye@example.com',source:'sales'}),env);
  const page=await handleLeadsPublic(new Request('https://mayor.mehyar.us/api/leads/unsubscribe?e=bye%40example.com'),env);
  expect(await page!.text()).toContain('Unsubscribe?');
  const done=await handleLeadsPublic(post({email:'bye@example.com'},'/api/leads/unsubscribe'),env);
  expect(await done!.text()).toContain('unsubscribed');
  expect(leads[0].unsubscribed_at).not.toBeNull();
  const good=mailer();
  const result=await deliverPendingLeadEmails({AGENT_DB:db,MAYOR_EMAIL:good.impl,MAYOR_EMAIL_FROM:'mayor@mehyar.us'});
  expect(result.attempted).toBe(0);
  expect(good.sent).toHaveLength(0);
 });
});
