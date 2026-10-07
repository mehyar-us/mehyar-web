import type {Env} from '../env';
import {consumeTelnyxConsent} from './phone-oauth-state';
import {telnyxTokenExchange} from './telnyx-protocol';
import {telnyxOAuthConfig} from './telnyx-vault';
import {connectTelnyxOAuth} from '../telnyx-connections';

export async function finishTelnyxConsent(request:Request,env:Env,session:{user:{id:string};session:{id:string}}|null,transport:typeof fetch=fetch){
 const destination=new URL('/',env.APP_ORIGIN);
 try{
  const config=telnyxOAuthConfig(env);
  const state=await consumeTelnyxConsent(request,env,session,config);
  const tokens=await telnyxTokenExchange(config,{code:state.code,verifier:state.verifier},transport);
  await connectTelnyxOAuth(env,state.actor,state.connectionRevision,tokens,config,transport);
  destination.searchParams.set('connected','telnyx');
 }catch{destination.searchParams.set('auth_error','telnyx_connection');}
 return new Response(null,{status:302,headers:{location:destination.href,'cache-control':'no-store','referrer-policy':'no-referrer'}});
}
