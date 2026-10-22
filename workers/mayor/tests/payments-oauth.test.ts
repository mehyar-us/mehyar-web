import {describe,it,expect} from 'vitest';
import type {Env} from '../src/env';
import {digest} from '../src/http';
import {
 paymentOAuthConfig,paymentOAuthConfigs,buildPaymentAuthorizeUrl,
 startPaymentConnect,consumePaymentOAuthState,exchangePaymentCode,
 finishPaymentConnect,paymentConnectionsStatus,disconnectPaymentConnection,openPaymentToken,
} from '../src/payments-oauth';

/** P6 payments one-click. Ground truth: NO Stripe Connect or Square OAuth
 * app credentials exist in this repo/prod, so with today's config every
 * surface must say "not available yet" and name the exact env vars still
 * needed — no authorize URL, no dead button, no fake client ID. With
 * (fixture) config present, the full flow must hold its invariants:
 * state binds tenant+user+session and is single-use, the callback tenant
 * comes only from the state row, tokens are sealed to that binding and
 * never appear in any status payload. */

const KEY='AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
const T1='a'.repeat(32),T2='b'.repeat(32),U1='user-1',U2='user-2';
const SESSION='session-1';

const baseEnv=(over:Record<string,unknown>={})=>({
 APP_ORIGIN:'https://mayor.mehyar.us',TOKEN_ENCRYPTION_KEY:KEY,
 ENVIRONMENT:'test',...over,
}) as unknown as Env;

const configuredEnv=()=>baseEnv({
 STRIPE_CONNECT_CLIENT_ID:'ca_fixture123',STRIPE_CONNECT_SECRET_KEY:'sk_fixture_platform',
 SQUARE_CLIENT_ID:'sq_fixture_app',SQUARE_CLIENT_SECRET:'sq_fixture_secret',
});

interface StateRow{provider:string;tenant_id:string;user_id:string;session_hash:string;expires_at:number}
interface ConnRow{id:string;tenant_id:string;user_id:string;provider:string;account_id:string;ciphertext:string;status:string;scopes:string;updated_at:string}

function fakeDb(roles:Record<string,string>){
 const states=new Map<string,StateRow>();
 const connections:ConnRow[]=[];
 const db={
  prepare(sql:string){
   let bound:unknown[]=[];
   const stmt={
    bind(...args:unknown[]){bound=args;return stmt;},
    async first(){
     if(sql.includes('FROM agent_memberships')){
      const role=roles[`${bound[0]}:${bound[1]}`];
      return role?{tenant_id:bound[0],user_id:bound[1],role,status:'active',expires_at:null}:null;
     }
     if(sql.includes('DELETE FROM mayor_payment_oauth_states')){
      const [hash,user,sessionHash]=bound as [string,string,string];
      const row=states.get(hash);
      if(!row||row.user_id!==user||row.session_hash!==sessionHash)return null;
      states.delete(hash);
      return {provider:row.provider,tenant_id:row.tenant_id,user_id:row.user_id,expires_at:row.expires_at};
     }
     if(sql.includes('FROM mayor_payment_connections'))
      return connections.find(c=>c.tenant_id===bound[0]&&c.user_id===bound[1]&&c.provider===bound[2])??null;
     return null;
    },
    async all(){
     if(sql.includes('FROM mayor_payment_connections'))
      return {results:connections.filter(c=>c.tenant_id===bound[0]&&c.user_id===bound[1]&&c.status==='connected'&&c.ciphertext!=='')};
     return {results:[]};
    },
    async run(){
     if(sql.startsWith('DELETE FROM mayor_payment_oauth_states'))return {meta:{changes:0}};
     if(sql.includes('INSERT INTO mayor_payment_oauth_states')){
      const [hash,provider,tenant,user,sessionHash,expiresAt]=bound as [string,string,string,string,string,number];
      const role=roles[`${tenant}:${user}`];
      if(!role||!['owner','manager'].includes(role))return {meta:{changes:0}};
      states.set(hash,{provider,tenant_id:tenant,user_id:user,session_hash:sessionHash,expires_at:expiresAt});
      return {meta:{changes:1}};
     }
     if(sql.includes('INSERT INTO mayor_payment_connections')){
      const [id,tenant,user,provider,account,ciphertext,scopes,now]=bound as [string,string,string,string,string,string,string,string];
      const existing=connections.find(c=>c.tenant_id===tenant&&c.user_id===user&&c.provider===provider);
      if(existing)Object.assign(existing,{account_id:account,ciphertext,status:'connected',scopes,updated_at:now});
      else connections.push({id,tenant_id:tenant,user_id:user,provider,account_id:account,ciphertext,status:'connected',scopes,updated_at:now});
      return {meta:{changes:1}};
     }
     if(sql.includes('UPDATE mayor_payment_connections')){
      const [now,tenant,user,provider]=bound as [string,string,string,string];
      const row=connections.find(c=>c.tenant_id===tenant&&c.user_id===user&&c.provider===provider);
      if(row){row.status='disconnected';row.ciphertext='';row.updated_at=now;return {meta:{changes:1}};}
      return {meta:{changes:0}};
     }
     return {meta:{changes:0}};
    },
   };
   return stmt;
  },
 } as unknown as Env['AGENT_DB'];
 return {db,states,connections};
}

const roles={[`${T1}:${U1}`]:'owner',[`${T2}:${U1}`]:'owner',[`${T2}:${U2}`]:'owner',[`${T1}:staff-1`]:'staff'};
const session={user:{id:U1},session:{id:SESSION}};

const stripeExchange=(async(url:RequestInfo|URL,init?:RequestInit)=>{
 const target=String(url);
 if(target==='https://connect.stripe.com/oauth/token'){
  const body=new URLSearchParams(String(init?.body));
  expect(body.get('client_secret')).toBe('sk_fixture_platform'); // server-side only
  expect(body.get('code')).toBe('ac_fixture_code');
  return Response.json({access_token:'stripe-access-token',refresh_token:'stripe-refresh-token',stripe_user_id:'acct_fixture123',scope:'read_only'});
 }
 throw new Error('unexpected '+target);
}) as typeof fetch;

describe('config gate (today\u2019s real config: no payment OAuth apps)',()=>{
 it('names the exact missing env vars for both providers',()=>{
  const [stripe,square]=paymentOAuthConfigs(baseEnv());
  expect(stripe.configured).toBe(false);
  expect(stripe.missing).toEqual(['STRIPE_CONNECT_CLIENT_ID','STRIPE_CONNECT_SECRET_KEY']);
  expect(square.configured).toBe(false);
  expect(square.missing).toEqual(['SQUARE_CLIENT_ID','SQUARE_CLIENT_SECRET']);
  expect(stripe.message).toMatch(/not available yet/i);
 });
 it('also requires token custody',()=>{
  const config=paymentOAuthConfig(baseEnv({STRIPE_CONNECT_CLIENT_ID:'ca_x',STRIPE_CONNECT_SECRET_KEY:'sk_x',TOKEN_ENCRYPTION_KEY:undefined}),'stripe');
  expect(config.configured).toBe(false);
  expect(config.missing).toContain('TOKEN_ENCRYPTION_KEY');
 });
 it('builds no authorize URL while unconfigured — never a fake client id',()=>{
  expect(buildPaymentAuthorizeUrl(baseEnv(),'stripe','state')).toBeNull();
  expect(buildPaymentAuthorizeUrl(baseEnv(),'square','state')).toBeNull();
 });
 it('start refuses with the honest 503 while unconfigured',async()=>{
  const {db}=fakeDb(roles);
  const env={...baseEnv(),AGENT_DB:db} as Env;
  await expect(startPaymentConnect(env,{tenantId:T1,userId:U1},SESSION,'stripe'))
   .rejects.toMatchObject({status:503,code:'payment_connect_not_configured'});
 });
 it('status reports not_available (not "not_connected") while unconfigured',async()=>{
  const {db}=fakeDb(roles);
  const env={...baseEnv(),AGENT_DB:db} as Env;
  const status=await paymentConnectionsStatus(env,{tenantId:T1,userId:U1});
  expect(status.map(s=>s.status)).toEqual(['not_available','not_available']);
  // Env var NAMES are the honest blocker list; secret VALUES never appear.
  expect(JSON.stringify(status)).not.toMatch(/sk_live|sk_test|sq0atp|fixture/i);
 });
});

describe('configured flow (fixture app credentials)',()=>{
 it('builds real authorize URLs with read-only scopes and the registered redirect',()=>{
  const stripe=new URL(buildPaymentAuthorizeUrl(configuredEnv(),'stripe','state123')!);
  expect(stripe.origin+stripe.pathname).toBe('https://connect.stripe.com/oauth/authorize');
  expect(stripe.searchParams.get('client_id')).toBe('ca_fixture123');
  expect(stripe.searchParams.get('scope')).toBe('read_only');
  expect(stripe.searchParams.get('redirect_uri')).toBe('https://mayor.mehyar.us/api/payments/oauth/callback/stripe');
  expect(stripe.searchParams.get('state')).toBe('state123');
  expect(stripe.href).not.toContain('sk_fixture');
  const square=new URL(buildPaymentAuthorizeUrl(configuredEnv(),'square','state123')!);
  expect(square.origin).toBe('https://connect.squareup.com');
  expect(square.searchParams.get('scope')).toContain('PAYMENTS_READ');
  expect(square.searchParams.get('client_secret' as never)).toBeNull();
  expect(square.href).not.toContain('sq_fixture_secret');
 });
 it('square sandbox host follows SQUARE_ENVIRONMENT',()=>{
  const url=new URL(buildPaymentAuthorizeUrl(baseEnv({SQUARE_CLIENT_ID:'sq',SQUARE_CLIENT_SECRET:'sec',SQUARE_ENVIRONMENT:'sandbox'}),'square','s')!);
  expect(url.origin).toBe('https://connect.squareupsandbox.com');
 });
 it('full stripe flow: state → callback → sealed connection → status without secrets',async()=>{
  const fixture=fakeDb(roles);
  const env={...configuredEnv(),AGENT_DB:fixture.db} as Env;
  const actor={tenantId:T1,userId:U1};
  const {url}=await startPaymentConnect(env,actor,SESSION,'stripe');
  const state=new URL(url).searchParams.get('state')!;
  expect(state).toMatch(/^[a-f0-9]{64}$/);
  // The stored row holds only the digest — the raw state is nowhere in D1.
  expect([...fixture.states.keys()]).toEqual([await digest(state)]);
  const request=new Request(`https://mayor.mehyar.us/api/payments/oauth/callback/stripe?code=ac_fixture_code&state=${state}`);
  const result=await finishPaymentConnect(request,env,session,stripeExchange);
  expect(result).toEqual({provider:'stripe',tenantId:T1,status:'connected'});
  const status=await paymentConnectionsStatus(env,actor);
  const stripe=status.find(s=>s.provider==='stripe')!;
  expect(stripe.status).toBe('connected');
  expect(stripe.accountId).toBe('acct_fixture123');
  expect(stripe.scopes).toEqual(['read_only']);
  expect(JSON.stringify(status)).not.toContain('stripe-access-token');
  expect(JSON.stringify(status)).not.toContain('stripe-refresh-token');
  // Sealed token opens only under its exact (tenant,user,provider,account) binding.
  const row=fixture.connections[0];
  const opened=await openPaymentToken(env,actor,'stripe','acct_fixture123',row.ciphertext);
  expect(opened.accessToken).toBe('stripe-access-token');
  await expect(openPaymentToken(env,{tenantId:T2,userId:U1},'stripe','acct_fixture123',row.ciphertext))
   .rejects.toMatchObject({code:'payment_credential_invalid'});
  // Disconnect is local + honest about provider revocation.
  const off=await disconnectPaymentConnection(env,actor,'stripe');
  expect(off).toEqual({provider:'stripe',status:'disconnected',providerRevoked:false});
  expect((await paymentConnectionsStatus(env,actor)).find(s=>s.provider==='stripe')?.status).toBe('not_connected');
 });
 it('tenant binding: a callback can never attach tenant A\u2019s flow to tenant B',async()=>{
  const fixture=fakeDb(roles);
  const env={...configuredEnv(),AGENT_DB:fixture.db} as Env;
  // U1 owns BOTH tenants; the flow was started for T1 only.
  const {url}=await startPaymentConnect(env,{tenantId:T1,userId:U1},SESSION,'stripe');
  const state=new URL(url).searchParams.get('state')!;
  const consumed=await consumePaymentOAuthState(env,{state,userId:U1,sessionId:SESSION});
  expect(consumed.actor.tenantId).toBe(T1); // from the state row, never from caller input
  // Tenant B has no connection as a result, and the state is single-use.
  expect(fixture.connections).toHaveLength(0);
  await expect(consumePaymentOAuthState(env,{state,userId:U1,sessionId:SESSION})).rejects.toMatchObject({code:'payment_authorization_expired'});
 });
 it('state binding: another user (or another session) cannot consume the state',async()=>{
  const fixture=fakeDb(roles);
  const env={...configuredEnv(),AGENT_DB:fixture.db} as Env;
  const {url}=await startPaymentConnect(env,{tenantId:T1,userId:U1},SESSION,'square');
  const state=new URL(url).searchParams.get('state')!;
  await expect(consumePaymentOAuthState(env,{state,userId:U2,sessionId:SESSION})).rejects.toMatchObject({code:'payment_authorization_expired'});
  await expect(consumePaymentOAuthState(env,{state,userId:U1,sessionId:'other-session'})).rejects.toMatchObject({code:'payment_authorization_expired'});
  // Failed attempts by strangers do not burn the legitimate state.
  const ok=await consumePaymentOAuthState(env,{state,userId:U1,sessionId:SESSION});
  expect(ok.provider).toBe('square');
  expect(ok.actor.tenantId).toBe(T1);
 });
 it('provider mismatch between callback path and state is refused',async()=>{
  const fixture=fakeDb(roles);
  const env={...configuredEnv(),AGENT_DB:fixture.db} as Env;
  const {url}=await startPaymentConnect(env,{tenantId:T1,userId:U1},SESSION,'stripe');
  const state=new URL(url).searchParams.get('state')!;
  const request=new Request(`https://mayor.mehyar.us/api/payments/oauth/callback/square?code=ac_fixture_code&state=${state}`);
  await expect(finishPaymentConnect(request,env,session,stripeExchange)).rejects.toMatchObject({code:'payment_authorization_expired'});
 });
 it('square exchange posts to the fixed Square token endpoint and stores the merchant id',async()=>{
  const env=configuredEnv();
  const seen:string[]=[];
  const transport=(async(url:RequestInfo|URL,init?:RequestInit)=>{
   seen.push(String(url));
   const body=JSON.parse(String(init?.body));
   expect(body.client_id).toBe('sq_fixture_app');
   expect(body.redirect_uri).toBe('https://mayor.mehyar.us/api/payments/oauth/callback/square');
   return Response.json({access_token:'sq-access-token',merchant_id:'M_fixture',expires_at:'2027-01-01T00:00:00Z'});
  }) as typeof fetch;
  const exchanged=await exchangePaymentCode(env,'square','sq-code',transport);
  expect(seen).toEqual(['https://connect.squareup.com/oauth2/token']);
  expect(exchanged.accountId).toBe('M_fixture');
  expect(exchanged.scopes).toContain('PAYMENTS_READ');
 });
 it('role gate: staff cannot start a connect or read payment status',async()=>{
  const fixture=fakeDb(roles);
  const env={...configuredEnv(),AGENT_DB:fixture.db} as Env;
  await expect(startPaymentConnect(env,{tenantId:T1,userId:'staff-1'},SESSION,'stripe')).rejects.toMatchObject({status:403});
  await expect(paymentConnectionsStatus(env,{tenantId:T1,userId:'staff-1'})).rejects.toMatchObject({status:403});
 });
});
