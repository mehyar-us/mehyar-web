import {z} from 'zod';
import type {Actor,Env} from './env';
import {HttpError,digest,json,readJson,requireOrigin} from './http';
import {OPERATORS,requireMembership} from './permissions';

/** P6 — one-click payments connect (Stripe Connect / Square OAuth).
 *
 * WHAT A REAL ONE-CLICK CONNECT REQUIRES (investigated 2026-10-12):
 * - Stripe Connect OAuth: a Stripe *platform* app — STRIPE_CONNECT_CLIENT_ID
 *   (ca_…) + the platform secret key for the token exchange — a registered
 *   redirect URI `${APP_ORIGIN}/api/payments/oauth/callback/stripe`, and
 *   `scope=read_only`. The Mayor's OWN billing keys (MAYOR_STRIPE_*, frozen
 *   src/billing/) are a different thing and are never used here.
 * - Square OAuth: a Square app — SQUARE_CLIENT_ID + SQUARE_CLIENT_SECRET —
 *   a registered redirect URI `${APP_ORIGIN}/api/payments/oauth/callback/square`,
 *   and scopes MERCHANT_PROFILE_READ / ORDERS_READ / PAYMENTS_READ.
 * NONE of those app credentials exist in this repo or in the production
 * config (checked wrangler.production.jsonc + capabilities/env surfaces).
 * So this module builds everything that does not require inventing them —
 * config gate, authorize URLs, tenant+user+session-bound single-use state,
 * code exchange, AES-GCM token custody, status, disconnect — and while the
 * config is absent every surface reports an honest "not available yet"
 * with the exact env var names still needed. No client ID is ever
 * hardcoded, guessed, or faked.
 *
 * SECURITY INVARIANTS: state is a 256-bit random value stored only as a
 * SHA-256 digest, bound to (tenant, user, session) and consumed atomically
 * on first use; the tenant on a stored connection comes ONLY from that
 * state row — a callback carries no tenant input, so a flow started for
 * tenant A can never attach to tenant B. Tokens are sealed with AES-GCM
 * AAD bound to (tenant, user, provider, account) and are never logged,
 * returned to the client, or placed in a URL. Connect/disconnect are
 * owner/manager only (OPERATORS).
 */

export const PAYMENT_PROVIDERS=['stripe','square'] as const;
export type PaymentProvider=typeof PAYMENT_PROVIDERS[number];
export const paymentProviderSchema=z.enum(PAYMENT_PROVIDERS);

const STATE_TTL_MS=600_000;

export interface PaymentOAuthConfig{
 provider:PaymentProvider;
 configured:boolean;
 /** Exact env var names still required — names only, never values. */
 missing:string[];
 clientId:string|null;
 redirectUri:string;
 message:string;
}

function requiredEnv(env:Env,provider:PaymentProvider):Array<[name:string,value:string|undefined]>{
 const custody:Array<[string,string|undefined]>=[['TOKEN_ENCRYPTION_KEY',env.TOKEN_ENCRYPTION_KEY]];
 return provider==='stripe'
  ?[['STRIPE_CONNECT_CLIENT_ID',env.STRIPE_CONNECT_CLIENT_ID],['STRIPE_CONNECT_SECRET_KEY',env.STRIPE_CONNECT_SECRET_KEY],...custody]
  :[['SQUARE_CLIENT_ID',env.SQUARE_CLIENT_ID],['SQUARE_CLIENT_SECRET',env.SQUARE_CLIENT_SECRET],...custody];
}

export function paymentOAuthConfig(env:Env,provider:PaymentProvider):PaymentOAuthConfig{
 const entries=requiredEnv(env,provider);
 const missing=entries.filter(([,v])=>!v).map(([name])=>name);
 const clientId=entries[0][1]??null;
 const label=provider==='stripe'?'Stripe':'Square';
 return {
  provider,configured:missing.length===0,missing,
  clientId:missing.length===0?clientId:null,
  redirectUri:`${new URL(env.APP_ORIGIN).origin}/api/payments/oauth/callback/${provider}`,
  message:missing.length===0
   ?`${label} one-click connect is ready.`
   :`${label} one-click connect is not available yet: The Mayor does not have its own ${label} app set up (${missing.join(', ')} still needed). You can still add ${label} with an API key from the guide instead — nothing is connected until that app exists.`,
 };
}

export function paymentOAuthConfigs(env:Env):PaymentOAuthConfig[]{
 return PAYMENT_PROVIDERS.map(p=>paymentOAuthConfig(env,p));
}

function squareHost(env:Env):string{
 return env.SQUARE_ENVIRONMENT==='sandbox'?'connect.squareupsandbox.com':'connect.squareup.com';
}

/** Pure authorize-URL builder. Returns null when the provider app is not
 * configured — a dead or fake connect button is never produced. */
export function buildPaymentAuthorizeUrl(env:Env,provider:PaymentProvider,state:string):string|null{
 const config=paymentOAuthConfig(env,provider);
 if(!config.configured||!config.clientId)return null;
 if(provider==='stripe'){
  const url=new URL('https://connect.stripe.com/oauth/authorize');
  url.searchParams.set('response_type','code');
  url.searchParams.set('client_id',config.clientId);
  url.searchParams.set('scope','read_only');
  url.searchParams.set('redirect_uri',config.redirectUri);
  url.searchParams.set('state',state);
  return url.href;
 }
 const url=new URL(`https://${squareHost(env)}/oauth2/authorize`);
 url.searchParams.set('client_id',config.clientId);
 url.searchParams.set('scope','MERCHANT_PROFILE_READ ORDERS_READ PAYMENTS_READ');
 url.searchParams.set('session','false');
 url.searchParams.set('response_type','code');
 url.searchParams.set('redirect_uri',config.redirectUri);
 url.searchParams.set('state',state);
 return url.href;
}

/* ------------------------------ state ------------------------------ */

const randomState=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),n=>n.toString(16).padStart(2,'0')).join('');
const expired=()=>new HttpError(409,'payment_authorization_expired','This connection attempt expired or changed. Start again from The Mayor.');

interface SessionLike{user:{id:string};session:{id:string}}

/** Start a connect attempt for the CALLER's tenant only. The session/tenant
 * binding is recorded server-side; the browser receives just the URL. */
export async function startPaymentConnect(env:Env,actor:Actor,sessionId:string,provider:PaymentProvider):Promise<{url:string;expiresAt:string}>{
 await requireMembership(env,actor,OPERATORS);
 const config=paymentOAuthConfig(env,provider);
 if(!config.configured)
  throw new HttpError(503,'payment_connect_not_configured',config.message);
 const state=randomState();
 const url=buildPaymentAuthorizeUrl(env,provider,state);
 if(!url)throw new HttpError(503,'payment_connect_not_configured',config.message);
 const stateHash=await digest(state),sessionHash=await digest(sessionId);
 const expiresAt=Date.now()+STATE_TTL_MS;
 await env.AGENT_DB.prepare('DELETE FROM mayor_payment_oauth_states WHERE expires_at<=?').bind(Date.now()).run();
 const inserted=await env.AGENT_DB.prepare(`INSERT INTO mayor_payment_oauth_states(state_hash,provider,tenant_id,user_id,session_hash,expires_at)
  SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM agent_memberships m JOIN agent_tenants t ON t.id=m.tenant_id
   WHERE m.tenant_id=? AND m.user_id=? AND m.status='active' AND t.status='active' AND m.role IN ('owner','manager')
   AND (m.expires_at IS NULL OR m.expires_at>?))
  AND (SELECT count(*) FROM mayor_payment_oauth_states WHERE user_id=?)<5`)
  .bind(stateHash,provider,actor.tenantId,actor.userId,sessionHash,expiresAt,
   actor.tenantId,actor.userId,new Date().toISOString(),actor.userId).run();
 if(inserted.meta.changes!==1)throw expired();
 return {url,expiresAt:new Date(expiresAt).toISOString()};
}

interface StateRow{provider:PaymentProvider;tenant_id:string;user_id:string;expires_at:number}

/** Atomically consume a state value. Succeeds only for the same user +
 * session that started the flow, before expiry, exactly once. The tenant
 * is read from the consumed row and from nowhere else. */
export async function consumePaymentOAuthState(env:Env,input:{state:string;userId:string;sessionId:string}):Promise<{provider:PaymentProvider;actor:Actor}>{
 if(!/^[a-f0-9]{64}$/.test(input.state))throw expired();
 const row=await env.AGENT_DB.prepare('DELETE FROM mayor_payment_oauth_states WHERE state_hash=? AND user_id=? AND session_hash=? RETURNING provider,tenant_id,user_id,expires_at')
  .bind(await digest(input.state),input.userId,await digest(input.sessionId)).first<StateRow>();
 if(!row||row.expires_at<=Date.now())throw expired();
 const actor={tenantId:row.tenant_id,userId:row.user_id};
 await requireMembership(env,actor,OPERATORS);
 return {provider:row.provider,actor};
}

/* --------------------------- token custody --------------------------- */

const aad=(actor:Actor,provider:PaymentProvider,accountId:string)=>new TextEncoder().encode(JSON.stringify(['mayor-payment-connection',actor.tenantId,actor.userId,provider,accountId]));
const b64=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes));
const unb64=(text:string):Uint8Array<ArrayBuffer>=>{
 const raw=atob(text),bytes=new Uint8Array(raw.length);
 for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);
 return bytes;
};
async function vaultKey(env:Env):Promise<CryptoKey>{
 if(!env.TOKEN_ENCRYPTION_KEY)throw new HttpError(503,'payment_connect_not_configured','Secure token storage is not configured.');
 let bytes:Uint8Array<ArrayBuffer>;try{bytes=unb64(env.TOKEN_ENCRYPTION_KEY);}catch{throw new HttpError(503,'payment_connect_not_configured','Secure token storage is not configured.');}
 if(bytes.length!==32)throw new HttpError(503,'payment_connect_not_configured','Secure token storage is not configured.');
 return crypto.subtle.importKey('raw',bytes,'AES-GCM',false,['encrypt','decrypt']);
}
interface SealedToken{accessToken:string;refreshToken?:string;expiresAt?:string;scopes:string[]}
async function sealPaymentToken(env:Env,actor:Actor,provider:PaymentProvider,accountId:string,token:SealedToken):Promise<string>{
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad(actor,provider,accountId)},await vaultKey(env),new TextEncoder().encode(JSON.stringify(token)));
 return `v1.${b64(iv)}.${b64(new Uint8Array(ciphertext))}`;
}
/** Server-only decrypt (used by tests and future read paths). The AAD makes
 * a ciphertext copied to another tenant/user/provider/account row fail. */
export async function openPaymentToken(env:Env,actor:Actor,provider:PaymentProvider,accountId:string,ciphertext:string):Promise<SealedToken>{
 try{
  const [version,iv,data,extra]=ciphertext.split('.');
  if(version!=='v1'||!iv||!data||extra)throw new Error('envelope');
  const plaintext=await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(iv),additionalData:aad(actor,provider,accountId)},await vaultKey(env),unb64(data));
  return JSON.parse(new TextDecoder().decode(plaintext)) as SealedToken;
 }catch{throw new HttpError(409,'payment_credential_invalid','Reconnect this payment account to restore secure access.');}
}

/* --------------------------- code exchange --------------------------- */

export interface ExchangedPaymentToken extends SealedToken{accountId:string}

const stripeTokenSchema=z.object({access_token:z.string().min(1),refresh_token:z.string().optional(),
 stripe_user_id:z.string().min(1),scope:z.string().optional()}).passthrough();
const squareTokenSchema=z.object({access_token:z.string().min(1),refresh_token:z.string().optional(),
 merchant_id:z.string().min(1),expires_at:z.string().optional()}).passthrough();

/** Exchange an authorization code at the provider's FIXED token endpoint.
 * The client secret travels only in this server-side request body. */
export async function exchangePaymentCode(env:Env,provider:PaymentProvider,code:string,transport:typeof fetch=fetch):Promise<ExchangedPaymentToken>{
 const config=paymentOAuthConfig(env,provider);
 if(!config.configured||code.length>4096)throw new HttpError(503,'payment_connect_not_configured',config.message);
 let response:Response;
 if(provider==='stripe'){
  response=await transport('https://connect.stripe.com/oauth/token',{method:'POST',redirect:'manual',signal:AbortSignal.timeout(15000),
   headers:{'content-type':'application/x-www-form-urlencoded',accept:'application/json'},
   body:new URLSearchParams({grant_type:'authorization_code',code,client_secret:env.STRIPE_CONNECT_SECRET_KEY!})});
 }else{
  response=await transport(`https://${squareHost(env)}/oauth2/token`,{method:'POST',redirect:'manual',signal:AbortSignal.timeout(15000),
   headers:{'content-type':'application/json',accept:'application/json','Square-Version':'2025-01-23'},
   body:JSON.stringify({client_id:env.SQUARE_CLIENT_ID,client_secret:env.SQUARE_CLIENT_SECRET,code,grant_type:'authorization_code',redirect_uri:config.redirectUri})});
 }
 if(!response.ok){await response.body?.cancel();throw new HttpError(502,'payment_exchange_failed','The payment provider did not complete the connection. Start again from The Mayor.');}
 const body:unknown=await response.json().catch(()=>null);
 if(provider==='stripe'){
  const parsed=stripeTokenSchema.safeParse(body);
  if(!parsed.success)throw new HttpError(502,'payment_exchange_failed','The payment provider returned an unexpected response. Start again from The Mayor.');
  return {accountId:parsed.data.stripe_user_id,accessToken:parsed.data.access_token,refreshToken:parsed.data.refresh_token,
   scopes:(parsed.data.scope??'read_only').split(/[\s,]+/).filter(Boolean)};
 }
 const parsed=squareTokenSchema.safeParse(body);
 if(!parsed.success)throw new HttpError(502,'payment_exchange_failed','The payment provider returned an unexpected response. Start again from The Mayor.');
 return {accountId:parsed.data.merchant_id,accessToken:parsed.data.access_token,refreshToken:parsed.data.refresh_token,
  expiresAt:parsed.data.expires_at,scopes:['MERCHANT_PROFILE_READ','ORDERS_READ','PAYMENTS_READ']};
}

/* --------------------------- stored connections --------------------------- */

interface ConnectionRow{id:string;provider:PaymentProvider;account_id:string;status:string;scopes:string;updated_at:string}

async function storePaymentConnection(env:Env,actor:Actor,provider:PaymentProvider,exchanged:ExchangedPaymentToken):Promise<{id:string}>{
 await requireMembership(env,actor,OPERATORS);
 const ciphertext=await sealPaymentToken(env,actor,provider,exchanged.accountId,exchanged);
 const id=crypto.randomUUID(),now=new Date().toISOString();
 await env.AGENT_DB.prepare(`INSERT INTO mayor_payment_connections(id,tenant_id,user_id,provider,account_id,ciphertext,status,scopes,created_at,updated_at)
  VALUES(?,?,?,?,?,?, 'connected',?,?,?)
  ON CONFLICT(tenant_id,user_id,provider) DO UPDATE SET account_id=excluded.account_id,ciphertext=excluded.ciphertext,
   status='connected',scopes=excluded.scopes,updated_at=excluded.updated_at,revision=mayor_payment_connections.revision+1`)
  .bind(id,actor.tenantId,actor.userId,provider,exchanged.accountId,ciphertext,JSON.stringify(exchanged.scopes),now,now).run();
 const row=await env.AGENT_DB.prepare('SELECT id FROM mayor_payment_connections WHERE tenant_id=? AND user_id=? AND provider=?')
  .bind(actor.tenantId,actor.userId,provider).first<{id:string}>();
 return {id:row?.id??id};
}

export interface PaymentConnectionStatus{
 provider:PaymentProvider;
 configured:boolean;
 missing:string[];
 status:'connected'|'not_connected'|'not_available';
 accountId:string|null;
 scopes:string[];
 connectedAt:string|null;
 message:string;
}

/** Per-provider status for the Connections surface: config honesty first,
 * then real stored connections only. A stored row counts only while its
 * ciphertext is present and its status is 'connected'. */
export async function paymentConnectionsStatus(env:Env,actor:Actor):Promise<PaymentConnectionStatus[]>{
 await requireMembership(env,actor,OPERATORS);
 const rows=await env.AGENT_DB.prepare(`SELECT id,provider,account_id,status,scopes,updated_at FROM mayor_payment_connections
  WHERE tenant_id=? AND user_id=? AND status='connected' AND ciphertext!='' ORDER BY provider`)
  .bind(actor.tenantId,actor.userId).all();
 const results=(rows.results??[]) as unknown as ConnectionRow[];
 const byProvider=new Map(results.map(r=>[r.provider,r]));
 return PAYMENT_PROVIDERS.map(provider=>{
  const config=paymentOAuthConfig(env,provider);
  const row=byProvider.get(provider);
  let scopes:string[]=[];try{scopes=JSON.parse(row?.scopes??'[]');}catch{/* stored scopes are provider-issued; a bad row shows none */}
  return {
   provider,configured:config.configured,missing:config.missing,
   status:row?'connected':config.configured?'not_connected':'not_available',
   accountId:row?.account_id??null,
   scopes:row?scopes:[],
   connectedAt:row?.updated_at??null,
   message:row?`${provider==='stripe'?'Stripe':'Square'} is connected for this business.`
    :config.configured?`${provider==='stripe'?'Stripe':'Square'} is not connected yet.`
    :config.message,
  };
 });
}

export async function disconnectPaymentConnection(env:Env,actor:Actor,provider:PaymentProvider):Promise<{provider:PaymentProvider;status:'disconnected';providerRevoked:false}>{
 await requireMembership(env,actor,OPERATORS);
 await env.AGENT_DB.prepare(`UPDATE mayor_payment_connections SET status='disconnected',ciphertext='',updated_at=?,revision=revision+1
  WHERE tenant_id=? AND user_id=? AND provider=?`)
  .bind(new Date().toISOString(),actor.tenantId,actor.userId,provider).run();
 // Local disconnect only — the owner should also revoke The Mayor in the
 // provider's own dashboard; we never claim a provider-side revocation
 // we did not perform (same convention as revokeProviderGrant).
 return {provider,status:'disconnected',providerRevoked:false};
}

/* ------------------------------ HTTP layer ------------------------------ */

/** Callback: GET /api/payments/oauth/callback/<provider>. The session is
 * required and the state must match it; tenant comes from the state row. */
export async function finishPaymentConnect(request:Request,env:Env,session:SessionLike|null,transport:typeof fetch=fetch):Promise<{provider:PaymentProvider;tenantId:string;status:'connected'}>{
 if(!session)throw expired();
 const params=new URL(request.url).searchParams;
 if(params.has('error')||params.getAll('state').length!==1||params.getAll('code').length!==1)throw expired();
 const code=params.get('code')!;
 if(!code||code.length>4096||!/^[\x21-\x7e]+$/.test(code))throw expired();
 const {provider,actor}=await consumePaymentOAuthState(env,{state:params.get('state')!,userId:session.user.id,sessionId:session.session.id});
 const pathProvider=new URL(request.url).pathname.split('/').pop();
 if(pathProvider!==provider)throw expired();
 const exchanged=await exchangePaymentCode(env,provider,code,transport);
 await storePaymentConnection(env,actor,provider,exchanged);
 return {provider,tenantId:actor.tenantId,status:'connected'};
}

/** Business-scoped payments routes (authenticated + origin-checked by the
 * root router, same contract as handleConnectionsRequest). */
export async function handlePaymentsRequest(request:Request,env:Env,actor:Actor,sessionId:string):Promise<Response|null>{
 const match=new URL(request.url).pathname.match(/^\/api\/businesses\/([^/]+)\/payments(?:\/(.*))?$/);
 if(!match)return null;
 try{
  if(actor.tenantId!==match[1])throw new HttpError(404,'payment_connection_not_found','This payment connection is unavailable in your account and business.');
  await requireMembership(env,actor,OPERATORS);
  const action=match[2]??'';
  if(request.method==='GET'&&action==='')return json({payments:await paymentConnectionsStatus(env,actor)});
  if(request.method!=='POST')throw new HttpError(404,'payment_route_not_found','This payment action is unavailable.');
  requireOrigin(request,env.APP_ORIGIN);
  const start=action.match(/^(stripe|square)\/connect\/start$/);
  if(start){await readJson(request,512).catch(()=>({}));return json(await startPaymentConnect(env,actor,sessionId,start[1] as PaymentProvider));}
  const disconnect=action.match(/^(stripe|square)\/disconnect$/);
  if(disconnect){await readJson(request,512).catch(()=>({}));return json(await disconnectPaymentConnection(env,actor,disconnect[1] as PaymentProvider));}
  throw new HttpError(404,'payment_route_not_found','This payment action is unavailable.');
 }catch(error){
  if(error instanceof HttpError)return json({error:error.code,message:error.message},error.status);
  return json({error:'payment_request_failed',message:'The payment connection could not complete this request.'},400);
 }
}
