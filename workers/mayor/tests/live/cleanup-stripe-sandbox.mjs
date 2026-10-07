/** Clean only this explicitly owned disposable sandbox run. Read-only unless --apply. */
import {readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=new URL('./',import.meta.url),objectsPath=new URL(process.argv.includes('--price-14')?'.sandbox-14-objects.json':'.sandbox-objects.json',root);
const objects=JSON.parse(await readFile(objectsPath,'utf8'));
const values=Object.fromEntries((await readFile(new URL('.dev.vars',root),'utf8')).split(/\r?\n/).filter(line=>line.includes('=')).map(line=>{const index=line.indexOf('=');return [line.slice(0,index),JSON.parse(line.slice(index+1))];}));
if(values.MAYOR_STRIPE_MODE!=='test'||!values.MAYOR_STRIPE_SECRET_KEY?.startsWith('sk_test_')||!/^\w{12}$/.test(objects.run??'')||values.MAYOR_STRIPE_ACCOUNT_ID!==objects.account)throw new Error('Owned sandbox configuration required.');
const apply=process.argv.includes('--apply'),id=value=>typeof value==='string'?value:value?.id;
const save=()=>writeFile(objectsPath,JSON.stringify(objects,null,2));
async function stripe(path,method='GET',data={},missing=false){
 if(!/^\/v1\/[A-Za-z0-9_/?=&%.[\]-]+$/.test(path)||path.includes('..'))throw new Error('Unsafe provider path.');
 const response=await fetch('https://api.stripe.com'+path,{method,headers:{authorization:`Bearer ${values.MAYOR_STRIPE_SECRET_KEY}`,'stripe-version':'2026-09-30.endive',...(method==='POST'?{'content-type':'application/x-www-form-urlencoded','idempotency-key':`mayor-pwa:sandbox-cleanup:${objects.run}:${path}`}:{})},...(method==='POST'?{body:new URLSearchParams(data).toString()}:{}),redirect:'manual',signal:AbortSignal.timeout(20000)});
 const body=await response.json();if(missing&&response.status===404)return null;
 if(!response.ok)throw new Error(`Stripe cleanup HTTP${response.status} ${body.error?.type??''} ${body.error?.code??''} ${body.error?.param??''}`);
 return body;
}
const account=await stripe('/v1/account');if(account.id!==objects.account)throw new Error('Sandbox account mismatch.');
const catalog=[];
for(const [kind,field,domain,amount,productField] of [['product','proProduct','mayor_pwa'],['price','proPrice',null,objects.proPriceCents??2900,'proProduct'],['product','auditProduct','mayor_business_audit'],['price','auditPrice',null,33000,'auditProduct'],['product','creditProduct','mayor_credit_pack'],['price','creditSmallPrice',null,400,'creditProduct'],['price','creditMediumPrice',null,800,'creditProduct'],['price','creditLargePrice',null,1200,'creditProduct'],['portal','portal']]){
 if(!objects[field])continue;
 const resource=kind==='portal'?'billing_portal/configurations':`${kind}s`,object=await stripe(`/v1/${resource}/${objects[field]}`);
 if(object.livemode!==false||object.metadata?.verification_run!==objects.run||(domain&&object.metadata?.domain!==domain)||(amount&&(object.unit_amount!==amount||object.currency!=='usd'||id(object.product)!==objects[productField])))throw new Error('Catalog scope mismatch.');
 catalog.push({kind,resource,id:object.id,active:object.active});
}
let plan=objects.cleanup?.plan;
if(!plan){
 if(objects.createdAt&&!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(objects.createdAt))throw new Error('Unsafe run timestamp.');
 const sql="SELECT c.tenant_id,c.stripe_customer_id,t.name,x.id AS checkout_id,x.stripe_session_id FROM mayor_billing_customers c JOIN agent_tenants t ON t.id=c.tenant_id LEFT JOIN mayor_billing_checkouts x ON x.tenant_id=c.tenant_id AND x.mode=c.mode WHERE c.mode='test'"+(objects.createdAt?` AND c.created_at>='${objects.createdAt}'`:'');
 const output=execFileSync(process.execPath,[fileURLToPath(new URL('../../node_modules/wrangler/bin/wrangler.js',root)),'d1','execute','AGENT_DB','--local','--config','tests/live/wrangler.sandbox.jsonc','--persist-to','tests/live/.state','--command',sql,'--json'],{cwd:fileURLToPath(new URL('../../',root)),stdio:'pipe'}).toString();
 const results=JSON.parse(output);if(!results.every(row=>row.success))throw new Error('Synthetic local ownership read failed.');
 const rows=results.flatMap(row=>row.results),customerScopes=new Map(),sessions=new Map();
 for(const row of rows){
  if(row.name!=='Mayor sandbox verification'||!/^cus_[A-Za-z0-9]+$/.test(row.stripe_customer_id)||!/^\w{32}$/.test(row.tenant_id))throw new Error('Local customer is outside disposable verification scope.');
  customerScopes.set(row.stripe_customer_id,{id:row.stripe_customer_id,domain:'mayor_pwa',tenantId:row.tenant_id});
  if(row.stripe_session_id)sessions.set(row.stripe_session_id,{sessionId:row.stripe_session_id,tenantId:row.tenant_id,checkoutId:row.checkout_id});
 }
 for(const probe of Object.values(objects.probes??{}))sessions.set(probe.sessionId,{...sessions.get(probe.sessionId),...probe});
 if(objects.renewal?.sessionId)sessions.set(objects.renewal.sessionId,{...sessions.get(objects.renewal.sessionId),...objects.renewal});
 const verifiedSessions=[];
 for(const scope of sessions.values()){
  if(!/^cs_test_[A-Za-z0-9]+$/.test(scope.sessionId))throw new Error('Sandbox session ID required.');
  const session=await stripe(`/v1/checkout/sessions/${scope.sessionId}?expand[]=line_items&expand[]=payment_intent`),domain=session.metadata?.mayor_billing_domain,customerId=id(session.customer),pro=domain==='mayor_pwa',credit=domain==='mayor_credit_pack',packId=session.metadata?.mayor_credit_pack,priceField=pro?'proPrice':credit?`credit${String(packId)[0]?.toUpperCase()+String(packId).slice(1)}Price`:'auditPrice';
  if(session.livemode!==false||!customerId||!['mayor_pwa','mayor_business_audit','mayor_credit_pack'].includes(domain)||credit&&!['small','medium','large'].includes(packId)||session.line_items?.has_more||session.line_items?.data?.length!==1||id(session.line_items.data[0].price)!==objects[priceField]||session.line_items.data[0].quantity!==1)throw new Error('Checkout ownership or catalog mismatch.');
  if(pro&&(session.metadata?.mayor_tenant_id!==scope.tenantId||session.client_reference_id!==scope.checkoutId))throw new Error('Synthetic Pro checkout mismatch.');
  if(credit&&(session.metadata?.mayor_tenant_id!==scope.tenantId||session.metadata?.mayor_credit_checkout_id!==scope.checkoutId||session.client_reference_id!==scope.checkoutId))throw new Error('Synthetic credit checkout mismatch.');
  if(!pro&&!credit&&(session.metadata?.mayor_audit_order_id!==scope.orderId||session.client_reference_id!==scope.orderId))throw new Error('Synthetic audit order mismatch.');
  if(!customerScopes.has(customerId))customerScopes.set(customerId,{id:customerId,domain,orderId:scope.orderId});
  verifiedSessions.push({id:session.id,customerId,domain,tenantId:scope.tenantId,orderId:scope.orderId,status:session.status,paymentStatus:session.payment_status,paymentIntentId:id(session.payment_intent),intentStatus:typeof session.payment_intent==='object'?session.payment_intent?.status:undefined,subscriptionId:id(session.subscription)});
 }
 const customers=[],subscriptions=[];
 for(const scope of customerScopes.values()){
  const customer=await stripe(`/v1/customers/${scope.id}`);if(customer.livemode!==false||customer.deleted)throw new Error('Owned customer missing before cleanup.');
  if(scope.domain==='mayor_pwa'&&(customer.metadata?.mayor_billing_domain!=='mayor_pwa'||customer.metadata?.mayor_tenant_id!==scope.tenantId||customer.metadata?.mayor_catalog_version!=='2026-10-03.1'))throw new Error('Synthetic customer metadata mismatch.');
  const hosted=await stripe(`/v1/checkout/sessions?customer=${scope.id}&limit=100`);if(hosted.has_more||hosted.data.some(session=>!verifiedSessions.some(verified=>verified.id===session.id)))throw new Error('Customer has an unowned Checkout.');
  const related=await stripe(`/v1/subscriptions?customer=${scope.id}&status=all&limit=100`);if(related.has_more)throw new Error('Unbounded customer subscriptions.');
  for(const subscription of related.data){
   const session=verifiedSessions.find(verified=>verified.subscriptionId===subscription.id);
   if(!session||subscription.livemode!==false||subscription.metadata?.mayor_billing_domain!=='mayor_pwa'||subscription.metadata?.mayor_tenant_id!==scope.tenantId||subscription.metadata?.mayor_checkout_id!==sessions.get(session.id)?.checkoutId||subscription.items?.has_more||subscription.items?.data?.length!==1||id(subscription.items.data[0].price)!==objects.proPrice)throw new Error('Customer has an unowned subscription.');
   subscriptions.push({id:subscription.id,customerId:scope.id,status:subscription.status});
  }
  customers.push({...scope,clockId:id(customer.test_clock)});
 }
 const clockId=objects.renewal?.clockId;
 if(clockId){const clock=await stripe(`/v1/test_helpers/test_clocks/${clockId}`);if(clock.livemode!==false||clock.name!==`Mayor renewal sandbox ${objects.run}`||customers.filter(customer=>customer.clockId===clockId).length!==1||!customers.some(customer=>customer.id===objects.renewal.customerId&&customer.clockId===clockId))throw new Error('Test Clock ownership mismatch.');}
 plan={validatedAt:new Date().toISOString(),accountId:account.id,run:objects.run,customers,subscriptions,sessions:verifiedSessions,clockId,catalog:catalog.map(({active,...entry})=>entry)};
 objects.cleanup={plan,actions:[]};await save();
}
if(plan.accountId!==account.id||plan.run!==objects.run||!Array.isArray(plan.customers)||!Array.isArray(plan.subscriptions)||!Array.isArray(plan.sessions))throw new Error('Saved cleanup plan mismatch.');
console.log(JSON.stringify({mode:'test',applied:apply,ownedCustomers:plan.customers.length,ownedSubscriptions:plan.subscriptions.length,ownedSessions:plan.sessions.length,ownedClocks:plan.clockId?1:0,ownedCatalogObjects:catalog.length,productionObjectsTouched:0}));
if(!apply)process.exit(0);
async function record(kind,objectId,result){objects.cleanup.actions.push({kind,id:objectId,result,at:new Date().toISOString()});await save();}
for(const scope of plan.sessions){const current=await stripe(`/v1/checkout/sessions/${scope.id}`);if(current.status==='open'&&current.payment_status==='unpaid'){const expired=await stripe(`/v1/checkout/sessions/${scope.id}/expire`,'POST');if(expired.status!=='expired')throw new Error('Checkout expiry failed.');await record('checkout',scope.id,'expired');}}
for(const scope of plan.subscriptions){const current=await stripe(`/v1/subscriptions/${scope.id}`,'GET',{},true);if(current&&current.status!=='canceled'){const canceled=await stripe(`/v1/subscriptions/${scope.id}`,'DELETE');if(canceled.status!=='canceled')throw new Error('Subscription cancellation failed.');await record('subscription',scope.id,'canceled');}}
if(plan.clockId){const current=await stripe(`/v1/test_helpers/test_clocks/${plan.clockId}`,'GET',{},true);if(current){const deleted=await stripe(`/v1/test_helpers/test_clocks/${plan.clockId}`,'DELETE');if(!deleted.deleted)throw new Error('Test Clock deletion failed.');await record('clock',plan.clockId,'deleted');}}
for(const scope of plan.customers){const current=await stripe(`/v1/customers/${scope.id}`,'GET',{},true);if(current&&!current.deleted){const deleted=await stripe(`/v1/customers/${scope.id}`,'DELETE');if(!deleted.deleted)throw new Error('Customer deletion failed.');await record('customer',scope.id,'deleted');}}
for(const entry of catalog){if(entry.active!==false){const archived=await stripe(`/v1/${entry.resource}/${entry.id}`,'POST',{active:'false'});if(archived.active!==false)throw new Error('Catalog archive failed.');await record(entry.kind,entry.id,'archived');}}
const checks={customersDeleted:0,subscriptionsCanceled:0,clockDeleted:0,catalogArchived:0};
for(const scope of plan.customers){const current=await stripe(`/v1/customers/${scope.id}`,'GET',{},true);if(current&&!current.deleted)throw new Error('Customer cleanup verification failed.');checks.customersDeleted++;}
for(const scope of plan.subscriptions){const current=await stripe(`/v1/subscriptions/${scope.id}`,'GET',{},true);if(current&&current.status!=='canceled')throw new Error('Subscription cleanup verification failed.');checks.subscriptionsCanceled++;}
if(plan.clockId){if(await stripe(`/v1/test_helpers/test_clocks/${plan.clockId}`,'GET',{},true))throw new Error('Test Clock cleanup verification failed.');checks.clockDeleted=1;}
for(const entry of catalog){if((await stripe(`/v1/${entry.resource}/${entry.id}`)).active!==false)throw new Error('Catalog cleanup verification failed.');checks.catalogArchived++;}
objects.cleanup.completedAt=new Date().toISOString();objects.cleanup.verification=checks;await save();
console.log(JSON.stringify({mode:'test',cleanupVerified:true,...checks,testTransactionHistoryRetained:true,productionObjectsTouched:0}));
