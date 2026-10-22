import {describe,expect,it} from 'vitest';
import {analyticsConsentAsserted,emitEngineEvent,emitEngineEventOnce,pendingPurchaseDirectives,recordEngineEvent,ENGINE_EVENT_PREFIX} from '../src/engine-events';
import {FOUNDING_PRICE_CENTS,PRO_PRICE_CENTS} from '../src/billing/plans';

interface AuditRow{id:string;tenant_id:string;actor_id:string;event:string;resource_id:string;created_at:string}

class FakeStatement{
 constructor(private db:FakeDb,private sql:string,private binds:unknown[]){}
 async first<T>():Promise<T|null>{
  const [a,b,c]=this.binds as [string,string,string];
  if(this.sql.includes('FROM mayor_audit')&&this.sql.includes('resource_id')){
   return (this.db.audit.find(r=>r.tenant_id===a&&r.event===b&&r.resource_id===c)??null) as T|null;
  }
  if(this.sql.includes('mayor_billing_paid_periods')){
   return (this.db.paidPeriod?{price_id:this.db.paidPeriod}:null) as T|null;
  }
  if(this.sql.includes('FROM mayor_billing_credit_checkouts')){
   return (this.db.creditCheckout?{pack_id:this.db.creditCheckout}:null) as T|null;
  }
  return null;
 }
 async all<T>():Promise<{results:T[]}>{
  if(this.sql.includes('FROM mayor_audit')){
   const [tenant,event]=this.binds as [string,string];
   const rows=this.db.audit.filter(r=>r.tenant_id===tenant&&r.event===event)
    .map(r=>({id:r.id,resource_id:r.resource_id,created_at:r.created_at}));
   return {results:rows as T[]};
  }
  return {results:[]};
 }
 async run(){
  this.db.execute(this.sql,this.binds);
  return {success:true,meta:{}};
 }
}

class FakeDb{
 audit:AuditRow[]=[];
 paidPeriod:string|null=null;
 creditCheckout:string|null=null;
 prepare(sql:string){return {bind:(...binds:unknown[])=>new FakeStatement(this,sql,binds)};}
 execute(sql:string,binds:unknown[]){
  if(sql.startsWith('INSERT INTO mayor_audit')&&sql.includes('SELECT')){
   const [id,tenant,actor,event,resource,at,tenantQ,eventQ,resourceQ]=binds as string[];
   if(!this.audit.some(r=>r.tenant_id===tenantQ&&r.event===eventQ&&r.resource_id===resourceQ)){
    this.audit.push({id,tenant_id:tenant,actor_id:actor,event,resource_id:resource,created_at:at});
   }
   return;
  }
  if(sql.startsWith('INSERT INTO mayor_audit')){
   const [id,tenant,actor,event,resource,at]=binds as string[];
   this.audit.push({id,tenant_id:tenant,actor_id:actor,event,resource_id:resource,created_at:at});
  }
 }
 batch(statements:FakeStatement[]){return Promise.all(statements.map(s=>s.run()));}
}

const FOUNDING_PRICE_ID='price_FoundingTest123';
const env=(db:FakeDb)=>({AGENT_DB:db,MAYOR_STRIPE_FOUNDING_PRICE_ID:FOUNDING_PRICE_ID} as never);
const TENANT='a'.repeat(32);

describe('engine events (Slice 0, §1.7)',()=>{
 it('records the operational event in the tenant ledger',async()=>{
  const db=new FakeDb();
  const id=await recordEngineEvent(env(db),{tenantId:TENANT,actorId:'user-1',type:'sign_up',resourceId:TENANT});
  expect(id).toBeTruthy();
  expect(db.audit).toHaveLength(1);
  expect(db.audit[0]).toMatchObject({tenant_id:TENANT,event:ENGINE_EVENT_PREFIX+'sign_up',resource_id:TENANT});
 });

 it('consent split: without a granted consent record the analytics copy does not exist',async()=>{
  const db=new FakeDb();
  const directives=await emitEngineEvent(env(db),{tenantId:TENANT,actorId:'user-1',type:'begin_checkout',resourceId:'checkout-1',consentGranted:false,valueCents:PRO_PRICE_CENTS,itemRef:'pro',itemName:'Mayor Pro'});
  expect(db.audit).toHaveLength(1); // operational event still recorded
  expect(directives).toEqual([]);   // and no analytics copy anywhere
 });

 it('with consent, the directive carries the exact charged value',async()=>{
  const db=new FakeDb();
  const directives=await emitEngineEvent(env(db),{tenantId:TENANT,actorId:'user-1',type:'begin_checkout',resourceId:'checkout-1',consentGranted:true,valueCents:FOUNDING_PRICE_CENTS,itemRef:'founding',itemName:'Mayor Pro — Founding'});
  expect(directives).toHaveLength(1);
  expect(directives[0].name).toBe('begin_checkout');
  expect(directives[0].params.value).toBe(79.2);
  expect(directives[0].params.currency).toBe('USD');
  expect(JSON.parse(directives[0].params.items as string)).toEqual([{item_id:'founding',item_name:'Mayor Pro — Founding',price:79.2,quantity:1}]);
 });

 it('emit-once: a replayed checkout return records and offers nothing twice',async()=>{
  const db=new FakeDb();
  const first=await emitEngineEventOnce(env(db),{tenantId:TENANT,actorId:'user-1',type:'begin_checkout',resourceId:'checkout-9',consentGranted:true,valueCents:9900,itemRef:'pro'});
  const second=await emitEngineEventOnce(env(db),{tenantId:TENANT,actorId:'user-1',type:'begin_checkout',resourceId:'checkout-9',consentGranted:true,valueCents:9900,itemRef:'pro'});
  expect(first).toHaveLength(1);
  expect(second).toEqual([]);
  expect(db.audit.filter(r=>r.event===ENGINE_EVENT_PREFIX+'begin_checkout')).toHaveLength(1);
 });

 it('pending purchase directives re-derive value from the recorded price — founding',async()=>{
  const db=new FakeDb();
  db.paidPeriod=FOUNDING_PRICE_ID;
  db.audit.push({id:'e1',tenant_id:TENANT,actor_id:'system',event:ENGINE_EVENT_PREFIX+'purchase_completed',resource_id:'in_123',created_at:new Date().toISOString()});
  const pending=await pendingPurchaseDirectives(env(db),TENANT);
  expect(pending).toHaveLength(1);
  expect(pending[0].name).toBe('purchase');
  expect(pending[0].params.value).toBe(79.2);
  expect(pending[0].params.transaction_id).toBe('in_123');
 });

 it('pending purchase directives resolve credit packs by checkout id',async()=>{
  const db=new FakeDb();
  db.creditCheckout='medium';
  db.audit.push({id:'e2',tenant_id:TENANT,actor_id:'system',event:ENGINE_EVENT_PREFIX+'purchase_completed',resource_id:'checkout-row-1',created_at:new Date().toISOString()});
  const pending=await pendingPurchaseDirectives(env(db),TENANT);
  expect(pending).toHaveLength(1);
  expect(pending[0].params.value).toBe(8);
  expect(JSON.parse(pending[0].params.items as string)[0].item_id).toBe('pack:medium');
 });

 it('consent assertion reads only the dedicated header, exactly',()=>{
  expect(analyticsConsentAsserted(new Request('https://x.test/',{headers:{'x-mayor-analytics-consent':'granted'}}))).toBe(true);
  expect(analyticsConsentAsserted(new Request('https://x.test/',{headers:{'x-mayor-analytics-consent':'denied'}}))).toBe(false);
  expect(analyticsConsentAsserted(new Request('https://x.test/'))).toBe(false);
 });
});
