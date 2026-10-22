import {describe,it,expect} from 'vitest';
import {handleLeadsPublic} from '../src/leads';

/* The /sales email capture (rot136): native form POST -> mayor_sales_leads.
 * The fake DB records inserts; the rate-limit statement returns a row so
 * the limiter passes, exactly like the real mayor_rate_limits upsert. */

function fakeDb(){
  const inserts:{sql:string,args:unknown[]}[]=[];
  const db={prepare:(sql:string)=>({bind:(...args:unknown[])=>({
    first:async()=>({count:1}),
    run:async()=>{inserts.push({sql,args});return {success:true};},
  })})};
  return {db:db as never,inserts};
}
function post(fields:Record<string,string>){
  return new Request('https://mayor.mehyar.us/api/leads',{method:'POST',body:new URLSearchParams(fields),headers:{'content-type':'application/x-www-form-urlencoded'}});
}
const leadRows=(inserts:{sql:string,args:unknown[]}[])=>inserts.filter(i=>i.sql.includes('mayor_sales_leads'));

describe('sales lead capture',()=>{
  it('stores a valid email (normalized) and answers with the thanks page',async()=>{
    const {db,inserts}=fakeDb();
    const res=await handleLeadsPublic(post({email:'  Owner@Example.com ',source:'sales'}),{AGENT_DB:db});
    expect(res!.status).toBe(200);
    expect(await res!.text()).toContain('on the list');
    const rows=leadRows(inserts);
    expect(rows).toHaveLength(1);
    expect(rows[0].args[1]).toBe('owner@example.com');
    expect(rows[0].args[2]).toBe('sales');
  });

  it('rejects an invalid email with the error page and stores nothing',async()=>{
    const {db,inserts}=fakeDb();
    const res=await handleLeadsPublic(post({email:'not-an-email',source:'sales'}),{AGENT_DB:db});
    expect(res!.status).toBe(400);
    expect(await res!.text()).toContain('doesn\u2019t look right');
    expect(leadRows(inserts)).toHaveLength(0);
  });

  it('honeypot submissions get the thanks page but are never stored',async()=>{
    const {db,inserts}=fakeDb();
    const res=await handleLeadsPublic(post({email:'bot@example.com',source:'sales',website:'http://spam.example'}),{AGENT_DB:db});
    expect(res!.status).toBe(200);
    expect(leadRows(inserts)).toHaveLength(0);
  });

  it('success copy states the timeframe; the loop source names the checklist (rot173)',async()=>{
    const {db}=fakeDb();
    const loop=await handleLeadsPublic(post({email:'loop@example.com',source:'sales-loop'}),{AGENT_DB:db});
    const loopText=await loop!.text();
    expect(loopText).toContain('Missed-Call Revenue Checklist');
    expect(loopText).toContain('within 30 days');
    const plain=await handleLeadsPublic(post({email:'plain@example.com',source:'sales'}),{AGENT_DB:db});
    const plainText=await plain!.text();
    expect(plainText).toContain('within 30 days');
    expect(plainText).not.toContain('Checklist');
  });

  it('ignores other paths and refuses GET',async()=>{
    const {db}=fakeDb();
    expect(await handleLeadsPublic(new Request('https://mayor.mehyar.us/api/other'),{AGENT_DB:db})).toBeNull();
    await expect(handleLeadsPublic(new Request('https://mayor.mehyar.us/api/leads'),{AGENT_DB:db})).rejects.toMatchObject({status:405});
  });
});
