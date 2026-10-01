import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createHmac} from 'node:crypto';
import {onRequestPost as webhook} from '../functions/api/pay/webhook.js';
import {onRequestPost as backfill} from '../functions/api/pay/fulfill-backfill.js';
import {onRequestPost as checkout} from '../functions/api/pay/checkout.js';

// All Stripe, email and D1 traffic is intercepted. SQLite executes the actual
// atomic claim SQL rather than simulating the locking rule in the fixture.
const sqlite = new DatabaseSync(':memory:');
sqlite.exec(readFileSync(new URL('../migrations/0033_promptpack_email_delivery.sql', import.meta.url),'utf8'));
const token='a'.repeat(64);
const product={id:'promptpack-pro',brand:'promptpack',name:'PromptPack',price_cents:1900,currency:'usd',active:1,fulfillment:'promptpack',allowed_return_hosts:'promptpack.mehyar.us',success_url_template:'https://promptpack.mehyar.us/success?token={access_token}',cancel_url:'https://promptpack.mehyar.us/'};
let payment={id:1,product_id:product.id,email:'synthetic@example.test',status:'pending',access_token:token,metadata_json:'{}'};
let order=null, emailSent=null, paidWrites=0;
const db={prepare(sql){return {v:[],bind(...v){this.v=v;return this},async first(){
  if(sql.includes('promptpack_email_delivery'))return sqlite.prepare(sql).get(...this.v);
  if(sql.includes('FROM billing_products'))return product;
  if(sql.includes('FROM billing_payments'))return payment;
  if(sql.includes('FROM promptpack_orders'))return order&&{...order,email_sent_at:emailSent};
  return null;
},async run(){
  if(sql.includes('promptpack_email_delivery'))return sqlite.prepare(sql).run(...this.v);
  if(sql.startsWith('UPDATE billing_payments SET stripe_payment_intent')){paidWrites++;payment.status='paid';payment.stripe_session_id=this.v[1];}
  if(sql.startsWith('UPDATE billing_payments SET stripe_session_id'))payment.stripe_session_id=this.v[0];
  if(sql.startsWith('INSERT INTO promptpack_orders'))order={id:2,payment_id:1,status:'paid',access_token:this.v[4],inputs_json:this.v[3]};
  if(sql.includes('UPDATE promptpack_orders SET email_sent_at'))emailSent='fixture-sent';
  return {success:true,meta:{last_row_id:1}};
}}}};
const env={LEADS_DB:db,STRIPE_TEST_SECRET_KEY:'sk_test_FIXTURE',STRIPE_WEBHOOK_SECRET_TEST2:'whsec_FIXTURE',CF_EMAIL_ACCOUNT_ID:'synthetic',CLOUDFLARE_EMAIL:'synthetic@example.test',CLOUDFLARE_API_KEY:'fixture'};
const event=async(status,type='checkout.session.completed')=>{
  const raw=JSON.stringify({type,data:{object:{id:'cs_fixture',payment_status:status,metadata:{payment_id:'1'}}}});
  const t=Math.floor(Date.now()/1000),sig=createHmac('sha256',env.STRIPE_WEBHOOK_SECRET_TEST2).update(t+'.'+raw).digest('hex');
  return webhook({env,request:new Request('https://fixture.invalid/',{method:'POST',headers:{'stripe-signature':`t=${t},v1=${sig}`},body:raw})});
};
globalThis.fetch=async()=>{throw Error('Unexpected network access')};
for(const status of ['unpaid','no_payment_required',undefined]){
  assert.equal((await event(status)).status,200);assert.equal(payment.status,'pending');assert.equal(order,null);assert.equal(paidWrites,0);
}
assert.equal((await event('paid','checkout.session.async_payment_succeeded')).status,200);
assert.equal(payment.status,'paid');assert.equal(order.access_token,token);
const calls=[];
globalThis.fetch=async(url,options)=>{
  assert.equal(url,'https://api.stripe.com/v1/checkout/sessions');
  const fields=new URLSearchParams(options.body);assert.equal(fields.get('line_items[0][price_data][unit_amount]'),'1900');calls.push(fields.get('success_url'));
  return Response.json({id:'cs_fixture'+calls.length,url:'https://fixture.invalid/checkout'});
};
payment.status='pending';
const checkoutRequest=()=>new Request('https://fixture.invalid/',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({product_id:product.id,email:payment.email,test:true,params:{profession:'contractor'}})});
const first=await (await checkout({env,request:checkoutRequest()})).json();
const second=await (await checkout({env,request:checkoutRequest()})).json();
assert.equal(first.token,token);assert.equal(second.token,token);assert.equal(calls[0],calls[1]);
payment.status='paid';order={...order,status:'ready',inputs_json:'{}'};
const request=()=>new Request('https://fixture.invalid/',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token})});
let emails=0, release;
globalThis.fetch=async(url,options)=>{
  assert.equal(url,'https://api.cloudflare.com/client/v4/accounts/synthetic/email/sending/send');
  const body=JSON.parse(options.body);assert.match(body.text,/Print \/ Save as PDF/);assert.doesNotMatch(body.text,/one-click/);
  emails++;await new Promise(r=>release=r);return Response.json({success:true,result:{id:'fixture'}});
};
const a=backfill({env,request:request()});
while(!release)await new Promise(r=>setTimeout(r,0));
const b=await (await backfill({env,request:request()})).json();assert.equal(b.email,'email_delivery_pending');
release();await a;assert.equal(emails,1);await backfill({env,request:request()});assert.equal(emails,1);
// Explicit provider rejection releases the claim; ambiguous outcomes hold it.
sqlite.exec('DELETE FROM promptpack_email_delivery');emailSent=null;
globalThis.fetch=async()=>{emails++;return Response.json({success:false},{status:429})};
await backfill({env,request:request()});assert.equal(sqlite.prepare('SELECT count(*) AS n FROM promptpack_email_delivery').get().n,0);
globalThis.fetch=async()=>{emails++;throw Error('Synthetic network timeout')};
await backfill({env,request:request()});assert.equal(sqlite.prepare('SELECT state FROM promptpack_email_delivery').get().state,'unknown');
const before=emails;await backfill({env,request:request()});assert.equal(emails,before);
sqlite.close();
console.log('PASS: unpaid/no-payment events denied; async paid entitlement; repeated return tokens preserved; real SQLite concurrency claim; one accepted email; rejection retry; uncertain failure held. No live network, charges, generation or email.');
