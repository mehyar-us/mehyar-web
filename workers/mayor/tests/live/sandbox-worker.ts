// Local-only entrypoint for real Stripe sandbox verification. Never deploy.
import worker,{MayorVoice,MayorPhone} from '../../src';
import {createAuth} from '../../src/auth';
import type {Env} from '../../src/env';
import {sandboxRestores} from './sandbox-restores';
export {MayorVoice,MayorPhone};
// Bypass a browser's immutable asset entry cached during a Vite emptyOutDir rebuild.
// This is only a local verification shell; the production worker is unchanged.
const ASSET_VERIFICATION='20261003-sandbox-assets-v1';
export default {
 async fetch(request:Request,env:Env,ctx:ExecutionContext){
  const url=new URL(request.url);
  if(!['127.0.0.1','localhost'].includes(url.hostname))return new Response('Local verification only',{status:403});
  if(url.pathname.startsWith('/__sandbox/restore/')){
   if(env.MAYOR_STRIPE_MODE!=='test'||env.APP_ORIGIN!=='http://127.0.0.1:5195')return new Response('Sandbox only',{status:403});
   const cookie=sandboxRestores[url.pathname.slice('/__sandbox/restore/'.length)];
   if(!cookie||!/^mehyar-agent\.session_token=/.test(cookie)||/[\r\n]/.test(cookie))return new Response('Unknown disposable test account',{status:404});
   return new Response(null,{status:302,headers:{location:'/?billing=success','set-cookie':cookie+'; Path=/; HttpOnly; SameSite=Lax','cache-control':'no-store'}});
  }
  if(url.pathname==='/__sandbox/stripe-health'){
   try{const response=await fetch('https://api.stripe.com/v1/account',{headers:{authorization:'Bearer '+env.MAYOR_STRIPE_SECRET_KEY,'stripe-version':'2026-09-30.endive'},redirect:'manual',signal:AbortSignal.timeout(15000)});return Response.json({status:response.status});}
   catch(error){return Response.json({error:error instanceof Error?error.name:'Error',message:error instanceof Error?error.message.replace(/(?:sk|rk)_(?:test|live)_\S+/g,'[redacted]'):'unavailable'});}
  }
  if(url.pathname==='/__sandbox/start'){
   const auth=await createAuth(env).$context;
   const user=await auth.internalAdapter.createUser({email:`mayor-sandbox-${crypto.randomUUID()}@example.test`,name:'Sandbox owner',emailVerified:true});
   const session=await auth.internalAdapter.createSession(user.id);
   const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.BETTER_AUTH_SECRET!),{name:'HMAC',hash:'SHA-256'},false,['sign']);
   const signature=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(session.token));
   const cookie=`mehyar-agent.session_token=${encodeURIComponent(`${session.token}.${btoa(String.fromCharCode(...new Uint8Array(signature)))}`)}`;
   const response=await worker.fetch(new Request(env.APP_ORIGIN+'/api/businesses',{method:'POST',headers:{cookie,origin:env.APP_ORIGIN,'content-type':'application/json'},body:JSON.stringify({name:'Mayor sandbox verification'})}),env,ctx);
   if(!response.ok)return response;
   return new Response(null,{status:302,headers:{location:'/', 'set-cookie':cookie+'; Path=/; HttpOnly; SameSite=Lax'}});
  }
  const response=await worker.fetch(request,env,ctx);
  if(url.pathname==='/'&&request.method==='GET'&&response.status===200&&response.headers.get('content-type')?.includes('text/html')){
   const html=(await response.text()).replace(/(src|href)="(\/assets\/[^"?]+\.(?:js|css))"/g,`$1="$2?sandbox-assets=${ASSET_VERIFICATION}"`);
   const headers=new Headers(response.headers);headers.set('cache-control','no-store');headers.delete('content-length');headers.delete('etag');headers.delete('last-modified');
   return new Response(html,{status:response.status,statusText:response.statusText,headers});
  }
  return response;
 }
};
