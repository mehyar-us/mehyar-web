import {createLocalJWKSet,jwtVerify} from 'jose';
import {z} from 'zod';
import {digest,readJson} from '../http';
import {providerConfigured,scopesForSelection,grantedCapabilities,type AuthEnv} from './capabilities';
import {requireConnectorManager,storeProviderGrant} from './vault';
import {zohoEndpoints} from './zoho-region';

type Session={user:{id:string};session:{id:string}}|null;
const inputSchema=z.object({tenantId:z.string().min(1).max(128),capabilities:z.array(z.enum(['calendar_read','calendar_manage'])).min(1).max(2)}).strict();
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'cache-control':'no-store'}});
const random=()=>crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','');
async function bounded(response:Response){
 if(!response.ok){await response.body?.cancel();throw new Error('zoho_request_failed');}
 return readJson(new Request('https://internal.invalid',{method:'POST',headers:{'content-type':'application/json'},body:response.body}),65536) as Promise<Record<string,any>>;
}
type State={user_id:string;session_id:string;tenant_id:string;verifier:string;nonce:string;selected:string;expires_at:number};
export async function startZoho(request:Request,env:AuthEnv,session:Session){
 if(request.headers.get('origin')!==new URL(env.APP_ORIGIN).origin)return json({error:'invalid_origin'},403);
 if(!session)return json({error:'authentication_required'},401);
 if(!providerConfigured(env,'zoho'))return json({error:'provider_not_configured'},503);
 const input=inputSchema.parse(await readJson(request,4096));
 await requireConnectorManager(env,input.tenantId,session.user.id);
 const scopes=scopesForSelection(env,'zoho',input.capabilities);
 const state=random(),verifier=random(),nonce=random(),now=Date.now();
 const challenge=btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
 await env.AGENT_DB.prepare('DELETE FROM mayor_zoho_oauth_states WHERE expires_at<?').bind(now).run();
 const count=await env.AGENT_DB.prepare('SELECT count(*) AS n FROM mayor_zoho_oauth_states WHERE user_id=?').bind(session.user.id).first<{n:number}>();
 if((count?.n??0)>=5)return json({error:'authorization_in_progress'},429);
 await env.AGENT_DB.prepare('INSERT INTO mayor_zoho_oauth_states(state_hash,user_id,session_id,tenant_id,verifier,nonce,selected,expires_at) VALUES(?,?,?,?,?,?,?,?)')
  .bind(await digest(state),session.user.id,session.session.id,input.tenantId,verifier,nonce,JSON.stringify(input.capabilities),now+600000).run();
 const url=new URL(zohoEndpoints('us').accounts+'/oauth/v2/auth');
 url.search=new URLSearchParams({client_id:env.ZOHO_CLIENT_ID!,response_type:'code',redirect_uri:new URL('/api/auth/callback/zoho',env.APP_ORIGIN).href,
  scope:['openid','email',...scopes].join(','),access_type:'offline',prompt:'consent',state,nonce,code_challenge:challenge,code_challenge_method:'S256'}).toString();
 return json({url:url.href});
}
/** Zoho is a business connector; Google remains the platform identity. */
export async function finishZoho(request:Request,env:AuthEnv,session:Session,transport:typeof fetch=fetch){
 const destination=new URL('/',env.APP_ORIGIN);
 let stage='session';
 try{
  if(!session||!providerConfigured(env,'zoho'))throw new Error('session_required');
  const params=new URL(request.url).searchParams,state=params.get('state');
  if(!state||! /^[a-f0-9]{64}$/.test(state))throw new Error('invalid_state');
  const saved=await env.AGENT_DB.prepare('DELETE FROM mayor_zoho_oauth_states WHERE state_hash=? AND user_id=? AND session_id=? RETURNING *')
   .bind(await digest(state),session.user.id,session.session.id).first<State>();
  if(!saved||saved.expires_at<Date.now()||params.has('error'))throw new Error('authorization_not_completed');
  await requireConnectorManager(env,saved.tenant_id,session.user.id);
  const endpoints=zohoEndpoints(params.get('location')??'us');
  const server=params.get('accounts-server');if(server&&server!==endpoints.accounts)throw new Error('invalid_accounts_server');
  const code=params.get('code');if(!code||code.length>4096)throw new Error('invalid_code');
  const selected=z.array(z.string()).max(2).parse(JSON.parse(saved.selected));
  scopesForSelection(env,'zoho',selected);
  stage='token';
  const body=new URLSearchParams({grant_type:'authorization_code',client_id:env.ZOHO_CLIENT_ID!,client_secret:env.ZOHO_CLIENT_SECRET!,code,
   code_verifier:saved.verifier,redirect_uri:new URL('/api/auth/callback/zoho',env.APP_ORIGIN).href});
  const response=await bounded(await transport(endpoints.accounts+'/oauth/v2/token',{method:'POST',body,redirect:'manual',signal:AbortSignal.timeout(15000)}));
  const tokens=z.object({access_token:z.string().min(1).max(16384).regex(/^\S+$/),refresh_token:z.string().min(1).max(16384).regex(/^\S+$/),id_token:z.string().max(32768),expires_in:z.number().int().min(61).max(86400),token_type:z.string().refine(v=>v.toLowerCase()==='bearer'),scope:z.string().optional()}).parse(response);
  stage='identity';
  const keys=await bounded(await transport(endpoints.accounts+'/oauth/v2/keys',{redirect:'manual',signal:AbortSignal.timeout(10000)}));
  const keySet=createLocalJWKSet(keys as any);
  const {payload}=await jwtVerify(tokens.id_token,(header,token)=>keySet({...header,kid:header.kid??(typeof header.key_id==='string'?header.key_id:undefined)},token),{issuer:[endpoints.accounts,new URL(endpoints.accounts).hostname],audience:env.ZOHO_CLIENT_ID!,algorithms:['RS256','RS384'],maxTokenAge:'10m'});
  if(payload.nonce!==saved.nonce||typeof payload.sub!=='string'||!payload.sub||payload.email_verified!==true||!z.email().safeParse(payload.email).success)throw new Error('unverified_identity');
  let scope=tokens.scope;
  stage='permissions';
  if(scope===undefined){
   const info=await bounded(await transport(endpoints.accounts+'/oauth/v2/introspect',{method:'POST',redirect:'manual',signal:AbortSignal.timeout(10000),
    headers:{authorization:'Basic '+btoa(env.ZOHO_CLIENT_ID!+':'+env.ZOHO_CLIENT_SECRET!)},body:new URLSearchParams({token:tokens.access_token,token_type_hint:'access_token'})}));
   if(info.active!==true||info.client_id!==env.ZOHO_CLIENT_ID||typeof info.scope!=='string')throw new Error('unverified_scopes');
   scope=info.scope;
  }
  const grantedScopes=scope.split(/[\s,]+/).filter(Boolean);
  if(!grantedScopes.length||grantedScopes.length>100)throw new Error('unverified_scopes');
  if(grantedCapabilities('zoho',grantedScopes,selected).length!==selected.length)throw new Error('required_permission_not_granted');
  await requireConnectorManager(env,saved.tenant_id,session.user.id);
  stage='storage';
  await storeProviderGrant(env,{userId:session.user.id,tenantId:saved.tenant_id,provider:'zoho',accountId:endpoints.region+':'+payload.sub},
   {accountEmail:payload.email as string,accessToken:tokens.access_token,refreshToken:tokens.refresh_token,accessTokenExpiresAt:new Date(Date.now()+tokens.expires_in*1000).toISOString(),grantedScopes,zohoRegion:endpoints.region},selected);
  destination.searchParams.set('connected','zoho');
 }catch{destination.searchParams.set('auth_error','zoho_'+stage);}
 return new Response(null,{status:302,headers:{location:destination.href,'cache-control':'no-store','referrer-policy':'no-referrer'}});
}
