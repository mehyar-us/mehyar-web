import {z} from 'zod';
import {readJson} from '../http';

// Confirmed against Telnyx's live authorization-server metadata. Registration
// starts read-only; writes are explicitly configured only for enabled features.
export const TELNYX_PHONE_SCOPES=['numbers.read','voice.read','numbers.write','voice.write','verify.read','verify.write'] as const;

// Internal protocol only. Callers must bind/consume state against the current
// session and tenant before exchanging a code, then store tokens encrypted.
const opaque=z.string().min(1).max(16384).regex(/^[\x21-\x7e]+$/);
const configSchema=z.object({clientId:opaque,clientSecret:opaque,
 redirectUri:z.literal('https://mayor.mehyar.us/api/auth/callback/telnyx'),
 scopes:z.array(z.enum(TELNYX_PHONE_SCOPES)).min(2).max(6).refine(scopes=>scopes.includes('numbers.read')&&scopes.includes('voice.read')&&new Set(scopes).size===scopes.length)});
export type TelnyxOAuthConfig=z.infer<typeof configSchema>;
export type TelnyxOAuthTokens={accessToken:string;refreshToken:string;expiresAt:number;scopes:string[]};
export function validateTelnyxOAuthConfig(config:unknown):TelnyxOAuthConfig{return configSchema.parse(config);}
const verifierSchema=z.string().min(43).max(128).regex(/^[A-Za-z0-9._~-]+$/);
const stateSchema=z.string().min(43).max(128).regex(/^[A-Za-z0-9_-]+$/);
const failure=()=>new Error('telnyx_authorization_failed');
const base='https://api.telnyx.com/v2/oauth';

export async function telnyxAuthorizeUrl(config:TelnyxOAuthConfig,state:string,verifier:string){
 const c=configSchema.parse(config);stateSchema.parse(state);verifierSchema.parse(verifier);
 const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier)));
 const challenge=btoa(String.fromCharCode(...hash)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
 const url=new URL(base+'/authorize');
 url.search=new URLSearchParams({client_id:c.clientId,redirect_uri:c.redirectUri,response_type:'code',scope:[...new Set(c.scopes)].join(' '),state,code_challenge:challenge,code_challenge_method:'S256'}).toString();
 return url.href;
}

async function post(config:TelnyxOAuthConfig,path:'token'|'introspect',body:URLSearchParams,transport:typeof fetch){
 const encode=(s:string)=>new URLSearchParams({v:s}).toString().slice(2);
 const response=await transport(base+'/'+path,{method:'POST',redirect:'manual',signal:AbortSignal.timeout(12000),
  headers:{authorization:'Basic '+btoa(encode(config.clientId)+':'+encode(config.clientSecret)),accept:'application/json','content-type':'application/x-www-form-urlencoded'},body});
 if(!response.ok){await response.body?.cancel();throw failure();}
 if(!response.headers.get('content-type')?.toLowerCase().startsWith('application/json')){await response.body?.cancel();throw failure();}
 return readJson(new Request('https://internal.invalid',{method:'POST',headers:{'content-type':'application/json'},body:response.body}),65536);
}

/** Never retries exchanges: a timed-out code or rotating refresh may be consumed. */
export async function telnyxTokenExchange(config:TelnyxOAuthConfig,
 grant:{code:string;verifier:string}|{refreshToken:string},transport:typeof fetch=fetch,now=Date.now()):Promise<TelnyxOAuthTokens>{
 try{
  const c=configSchema.parse(config);
  const body='code' in grant?new URLSearchParams({grant_type:'authorization_code',code:opaque.parse(grant.code),code_verifier:verifierSchema.parse(grant.verifier),redirect_uri:c.redirectUri})
   :new URLSearchParams({grant_type:'refresh_token',refresh_token:opaque.parse(grant.refreshToken)});
  const tokens=z.object({access_token:opaque,refresh_token:opaque.optional(),token_type:z.string().refine(v=>v.toLowerCase()==='bearer'),expires_in:z.number().int().min(61).max(2592000),scope:z.string().max(8192).optional()}).parse(await post(c,'token',body,transport));
  // Introspection also binds the returned token to our registered client. Do not
  // trust a missing scope field or infer permissions from the requested scopes.
  const info=z.object({active:z.literal(true),client_id:z.literal(c.clientId),scope:z.string().max(8192),exp:z.number().int().positive()}).parse(await post(c,'introspect',new URLSearchParams({token:tokens.access_token}),transport));
  const scopes=[...new Set(info.scope.split(/\s+/).filter(Boolean))];
  if(!c.scopes.every(s=>scopes.includes(s)))throw failure();
  if(tokens.scope!==undefined&&!c.scopes.every(s=>tokens.scope!.split(/\s+/).includes(s)))throw failure();
  const expiresAt=Math.min(now+tokens.expires_in*1000,info.exp*1000);
  if(expiresAt<=now+60000)throw failure();
  const refreshToken=tokens.refresh_token??('refreshToken' in grant?grant.refreshToken:undefined);
  if(!refreshToken)throw failure();
  return {accessToken:tokens.access_token,refreshToken,expiresAt,scopes};
 }catch{throw failure();} // No provider bodies, codes, tokens or exception details escape.
}
