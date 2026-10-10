import assert from 'node:assert/strict';
const origin=new URL(process.argv[2]??'https://mayor.mehyar.us').origin;
const checks=[['/',200],['/?connected=telnyx',200],['/terms',200],['/manifest.webmanifest',200],['/mayor-avatar.png',200],['/api/health',200],['/api/phone-guide?mode=new',200],['/api/phone-guide?mode=existing',200],['/api/businesses',401],['/agents/mayor-voice/unauthorized',401],['/api/auth/get-access-token',404]];
checks.push(['/business-audit',200],['/business-audit/report',200],['/api/business-audit/status',404],['/api/business-audit/report',404]);
checks.push(['/sales',200],['/robots.txt',200],['/sitemap.xml',200],['/favicon.ico',200]);
for(const slug of ['salon','restaurant','plumbing-hvac','dental','auto-repair','pet-grooming','med-spa'])checks.push([`/sales/${slug}`,200]);
checks.push(['/sales/saloon',404],['/definitely-not-a-page-xyz',404]);
for(const resource of ['customers','tasks','overview','billing','routines','harness'])checks.push([`/api/businesses/${'0'.repeat(32)}/${resource}`,401]);
for(const action of ['checkout','credit-checkout','portal','sync','audit-orders'])checks.push([`/api/businesses/${'0'.repeat(32)}/billing/${action}`,401,'POST']);
for(const action of ['routines','routines/run','routines/brief/read'])checks.push([`/api/businesses/${'0'.repeat(32)}/${action}`,401,'POST']);
for(const action of ['goals','skills','config','identity','prepare','confirm','run','tasks/prepare','tasks/confirm','report/read'])checks.push([`/api/businesses/${'0'.repeat(32)}/harness/${action}`,401,'POST']);
checks.push([`/api/businesses/${'0'.repeat(32)}/calendars/guide`,401,'POST']);
for(const resource of ['appointments','bookings','scheduling-policy','phone-connections','conversation'])checks.push([`/api/businesses/${'0'.repeat(32)}/${resource}`,401]);
checks.push([`/api/businesses/${'0'.repeat(32)}/phone-connections/telnyx/numbers`,401]);
checks.push([`/api/businesses/${'0'.repeat(32)}/phone-connections/telnyx/authorize`,401,'POST']);
checks.push([`/api/businesses/${'0'.repeat(32)}/phone-connections/telnyx/test-setup`,401,'POST']);
checks.push(['/api/auth/callback/telnyx',302]);
checks.push(['/api/phone/twilio/stream/00000000-0000-0000-0000-000000000000',503]);
checks.push([`/api/phone/twilio/verify/${'0'.repeat(32)}/00000000-0000-0000-0000-000000000000/send/00000000-0000-0000-0000-000000000000`,503,'POST']);
checks.push([`/api/businesses/${'0'.repeat(32)}/gmail`,401]);
checks.push([`/api/businesses/${'0'.repeat(32)}/gmail/unread`,401,'POST']);
checks.push([`/api/phone/telnyx/incoming/${'0'.repeat(32)}`,503,'POST']);
checks.push([`/api/phone/telnyx/stream/00000000-0000-0000-0000-000000000000/${'0'.repeat(64)}`,503]);
let failed=false;
checks.push([`/api/businesses/${'0'.repeat(32)}/email-preferences`,401]);
checks.push([`/api/businesses/${'0'.repeat(32)}/email-preferences`,401,'POST']);
checks.push([`/api/businesses/${'0'.repeat(32)}/recurring-check`,401]);
checks.push([`/api/businesses/${'0'.repeat(32)}/recurring-check/pause`,401,'POST']);
checks.push([`/api/businesses/${'0'.repeat(32)}/notifications`,401]);
checks.push([`/api/businesses/${'0'.repeat(32)}/notifications/refresh`,401,'POST']);
checks.push([`/api/businesses/${'0'.repeat(32)}/notifications/00000000-0000-4000-8000-000000000000/read`,401,'POST']);
for(const [path,expected,method='GET'] of checks){
  try{
    const response=await fetch(origin+path,{method,redirect:'manual',signal:AbortSignal.timeout(15000)});
    assert.equal(response.status,expected,`${path} status`);
    if(path==='/api/auth/callback/telnyx'){
      const destination=new URL(response.headers.get('location'));
      assert.equal(destination.origin,origin);assert.equal(destination.pathname,'/');
      assert.equal(destination.searchParams.get('auth_error'),'telnyx_connection');
      assert.equal(destination.searchParams.has('connected'),false);
      assert.equal(response.headers.get('cache-control'),'no-store');
      assert.equal(response.headers.get('referrer-policy'),'no-referrer');
    }
    if(path==='/'||path==='/?connected=telnyx'||path==='/terms'||path.startsWith('/business-audit'))assert.match(response.headers.get('cache-control')??'',/no-store/,'Entry documents must not be stored');
    if(path==='/business-audit/report')assert.match(response.headers.get('x-robots-tag')??'',/noindex/,'Private report route must not be indexed');
    if(path==='/business-audit'){
      const html=await response.text();assert.match(html,/\$330/);assert.match(html,/automatically|generates and reviews/i);
      for(const resource of [...html.matchAll(/(?:src|href)="(\/assets\/[^\"]+\.(?:js|css))"/g)].map(match=>match[1])){
        const asset=await fetch(origin+resource,{redirect:'error',signal:AbortSignal.timeout(15000)});
        assert.equal(asset.status,200);assert.match(asset.headers.get('content-type')??'',resource.endsWith('.js')?/(?:javascript|ecmascript)/:/text\/css/);
      }
    }
    if(path==='/api/health')assert.equal((await response.json()).service,'The Mayor');
    if(path==='/manifest.webmanifest'){
      const manifest=await response.json();
      assert.equal(manifest.display,'standalone');assert.equal(manifest.scope,'/');
      for(const size of [192,512]){
        const icon=manifest.icons.find(icon=>icon.sizes===`${size}x${size}`&&icon.type==='image/png');
        assert.ok(icon,`Missing ${size}px install icon`);assert.ok(icon.purpose.includes('maskable'));
        const image=await fetch(new URL(icon.src,origin),{signal:AbortSignal.timeout(15000)});
        assert.equal(image.status,200);assert.match(image.headers.get('content-type'),/image\/png/);
        const png=Buffer.from(await image.arrayBuffer());
        assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
        assert.equal(png.readUInt32BE(16),size);assert.equal(png.readUInt32BE(20),size);
      }
    }
    if(path==='/'){
      const html=await response.text();assert.match(html,/The Mayor/);
      const scripts=[...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>/g)].map(match=>match[1]);
      const styles=[...html.matchAll(/<link\b[^>]*\bhref="([^"]+\.css(?:\?[^\"]*)?)"[^>]*>/g)].map(match=>match[1]);
      assert.ok(scripts.length,'Missing application JavaScript');assert.ok(styles.length,'Missing application stylesheet');
      for(const [resource,kind] of [...scripts.map(src=>[src,'script']),...styles.map(src=>[src,'style']),['/sw.js','script'],['/microphone-worklet.js','script']]){
        const url=new URL(resource,origin);assert.equal(url.origin,origin,'Application assets must be same-origin');
        const asset=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(15000)});
        assert.equal(asset.status,200,`${url.pathname} status`);
        assert.match(asset.headers.get('content-type')??'',kind==='script'?/(?:javascript|ecmascript)/:/text\/css/,`${url.pathname} content type`);
        const body=await asset.text();assert.ok(body.trim().length>0,`${url.pathname} empty`);
        assert.doesNotMatch(body.trimStart(),/^<!doctype html|^<html/i,`${url.pathname} returned HTML fallback`);
        if(resource==='/sw.js')assert.match(asset.headers.get('cache-control')??'',/no-cache|no-store/);
      }
      console.log(`PASS application assets (${scripts.length} script, ${styles.length} stylesheet, service worker, microphone worklet)`);
    }
    if(path.startsWith('/api/phone-guide')){const guide=await response.json();assert.equal(guide.connectionVerified,false);assert.equal(guide.purchaseAuthorized,false);assert.equal(guide.providers.length,2);}
    console.log(`PASS ${path} ${expected}`);
  }catch(error){failed=true;console.error(`FAIL ${path}: ${error.message}`);}
}
if(failed)process.exitCode=1;
