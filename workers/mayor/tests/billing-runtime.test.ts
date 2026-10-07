import {expect,it} from 'vitest';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {STRIPE_API_VERSION} from '../src/billing/stripe';

it('runs the actual StripeClient through native Workerd fetch and stops redirects',async()=>{
 const bundle=await build({stdin:{contents:`import {StripeClient} from './src/billing/stripe.ts';export default {async fetch(request){try{return Response.json(await new StripeClient('sk_test_runtime_fixture').request(new URL(request.url).pathname==='/redirect'?'/v1/redirect':'/v1/account'));}catch(error){return Response.json({code:error.code},{status:503});}}};`,resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'browser',target:'es2022'});
 const requests:Array<{url:string;version:string|null}>=[];
 const runtime=new Miniflare({workers:[{config:{name:'billing-runtime-test',type:'worker',compatibilityDate:'2026-09-22',manifest:{mainModule:'bundle.js',modulesRoot:process.cwd(),modules:{'bundle.js':{type:'esm',contents:bundle.outputFiles[0].text}}}},dev:{outboundService:{type:'fetcher',handler:async request=>{requests.push({url:request.url,version:request.headers.get('stripe-version')});expect(new URL(request.url).origin).toBe('https://api.stripe.com');if(new URL(request.url).pathname==='/v1/redirect')return Response.json({},{status:302,headers:{location:'https://foreign.example/credential-sink'}});return Response.json({id:'acct_native_fixture'});}}}}]});
 try{const success=await runtime.dispatchFetch('https://runtime.example/account');expect(success.status).toBe(200);expect(await success.json()).toEqual({id:'acct_native_fixture'});const denied=await runtime.dispatchFetch('https://runtime.example/redirect');expect(denied.status).toBe(503);expect(await denied.json()).toEqual({code:'stripe_request_failed'});expect(requests).toEqual([{url:'https://api.stripe.com/v1/account',version:STRIPE_API_VERSION},{url:'https://api.stripe.com/v1/redirect',version:STRIPE_API_VERSION}]);}finally{await runtime.dispose();}
},20000);
