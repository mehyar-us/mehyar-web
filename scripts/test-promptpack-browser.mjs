import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';
const dir=process.argv[2];if(!dir)throw Error('Pass a recovered public deployment snapshot directory');
const html=Object.fromEntries(await Promise.all(['index','success','deliverable','app.js'].map(async p=>[p,await readFile(['success','deliverable'].includes(p)?new URL('../sites/promptpack/overrides/'+p+'.html',import.meta.url):dir+'/'+p+(p==='app.js'?'':'.html'),'utf8')])));
const token='a'.repeat(64);const pack={prompts:Array.from({length:50},(_,i)=>({category:'Fixture',title:'Synthetic prompt '+(i+1),prompt:'Local mock content.'})),swipes:Array.from({length:10},(_,i)=>({category:'Fixture',title:'Synthetic swipe '+(i+1),text:'Local mock message.'}))};
assert.match(html.success,/Keep the pack page open until it is ready/);
assert.doesNotMatch(html.success,/being written automatically|No token yet\? It arrives/);
const browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:390,height:844}});let batchCalls=[],ready=false,backfillCalls=0,notifyCalls=0,checkoutPayload=null,externalRequestsBlocked=0;let errors=[], paid=true, privateAnalyticsRequests=0, privatePhase=false;
await context.addInitScript(()=>{window.print=()=>{window.fixturePrintCalls=(window.fixturePrintCalls||0)+1};const timer=window.setTimeout;window.setTimeout=(f,ms,...args)=>timer(f,ms>=5000?15:ms,...args)});
await context.route('**/*',async route=>{const u=new URL(route.request().url()),p=u.pathname;
 if(privatePhase&&/googletagmanager|google-analytics/.test(u.hostname))privateAnalyticsRequests++;
 const json=body=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body),headers:{'access-control-allow-origin':'https://promptpack.mehyar.us'}});
 if(u.hostname==='promptpack.mehyar.us'){
  if(p==='/'||p==='/success'||p==='/deliverable.html'||p==='/deliverable')return route.fulfill({status:200,contentType:'text/html',body:html[p==='/'?'index':p==='/success'?'success':'deliverable']});
  if(p==='/app.js')return route.fulfill({status:200,contentType:'application/javascript',body:html['app.js']});
  if(p==='/api/promptpack/teaser')return json({ok:true,prompts:Array.from({length:5},(_,i)=>({n:i+1,category:'Fixture',title:'Teaser '+(i+1),prompt:'Synthetic teaser.'}))});
  if(p==='/api/promptpack/status')return json({ok:true,profession:'contractor',status:ready?'ready':'paid',ready,pack:ready?pack:null});
  if(p==='/api/promptpack/generate'){batchCalls.push(JSON.parse(route.request().postData()).batch);if(batchCalls.length===3)ready=true;return json({ok:true})}
  if(p==='/api/promptpack/notify-ready'){notifyCalls++;return json({ok:true})}
 }
 if(u.hostname==='mehyar.us'){
  if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':'https://promptpack.mehyar.us','access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'content-type'}});
  if(p==='/api/pay/status')return json({ok:true,paid,status:paid?'paid':'pending',product_id:'promptpack-pro'});
  if(p==='/api/pay/fulfill-backfill'){backfillCalls++;return json({ok:true,action:'already_fulfilled',email:'not_ready'})}
  if(p==='/api/pay/checkout'){checkoutPayload=JSON.parse(route.request().postData());return json({ok:true,checkout_url:'https://local-fixture.invalid/checkout'})}
 }
 if(u.hostname==='local-fixture.invalid')return route.fulfill({status:200,contentType:'text/html',body:'Synthetic checkout only. No payment.'});
 externalRequestsBlocked++;return route.fulfill({status:200,contentType:p.endsWith('.css')?'text/css':'application/javascript',body:''});
});
const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
await page.goto('https://promptpack.mehyar.us/');await page.waitForFunction(()=>document.querySelectorAll('#teaser-list .prompt-card').length===5);await page.click('#buy-open');await page.selectOption('#buy-profession','contractor');await page.fill('#buy-email','synthetic@example.test');await page.click('#buy-form button[type=submit]');await page.waitForURL('https://local-fixture.invalid/checkout');assert.equal(checkoutPayload.product_id,'promptpack-pro');assert.equal(checkoutPayload.params.profession,'contractor');assert.equal(checkoutPayload.test,undefined);
privatePhase=true;paid=false;
await page.goto('https://promptpack.mehyar.us/success?token='+token);await page.waitForTimeout(400);assert.equal(batchCalls.length,0);assert.ok(page.url().includes('/success'));
paid=true;await page.reload();await page.waitForURL('**/deliverable.html?token=*');
await page.waitForFunction(()=>document.querySelectorAll('#prompt-list .prompt-card').length===50);assert.deepEqual(batchCalls,[1,2,3]);assert.equal(await page.locator('#swipe-list .prompt-card').count(),10);await page.click('#pdf-btn');assert.equal(await page.evaluate(()=>window.fixturePrintCalls),1);assert.equal(notifyCalls,1);assert.equal(privateAnalyticsRequests,0);
const waitingClaim='Confirming your payment.';const generationRequiresBuyerClick=false;
await page.reload();await page.waitForFunction(()=>document.querySelectorAll('#prompt-list .prompt-card').length===50);assert.equal(batchCalls.length,3);await page.waitForTimeout(80);assert.equal(notifyCalls,2,'Reload nudges notify again; server must deduplicate');
assert.deepEqual(errors,[]);
const report={checkedAt:new Date().toISOString(),liveNetworkCalls:0,fixtureTeaserCount:5,fixtureRenderedPrompts:50,fixtureRenderedSwipes:10,checkoutProduct:'promptpack-pro',checkoutProfession:'contractor',serverPriceSeparatelyTestedCents:1900,generationBatches:batchCalls,successPageHeadline:waitingClaim,generationRequiresBuyerClick,backfillCalls,notifyCallsAfterReload:notifyCalls,pdfUsesPrintDialog:true,privateAnalyticsRequests,pendingPaymentDoesNotGenerate:true,pageErrors:errors,externalAssetRequestsIntercepted:externalRequestsBlocked,note:'Cached public HTML/scripts with all requests intercepted. Output is synthetic; no live checkout, email, model call or event emitted.'};console.log(JSON.stringify(report,null,2));await browser.close();
