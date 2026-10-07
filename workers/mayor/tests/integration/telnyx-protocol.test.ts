import {describe,it,expect,vi} from 'vitest';
import {telnyxAuthorizeUrl,telnyxTokenExchange,type TelnyxOAuthConfig} from '../../src/auth/telnyx-protocol';
const config:TelnyxOAuthConfig={clientId:'mayor',clientSecret:'secret',redirectUri:'https://mayor.mehyar.us/api/auth/callback/telnyx',scopes:['numbers.read','voice.read']};
const now=1800000000000,verifier='a'.repeat(64),state='b'.repeat(64);
const token={access_token:'access-secret',refresh_token:'refresh-secret',token_type:'Bearer',expires_in:3600,scope:'numbers.read voice.read'};
const info={active:true,client_id:'mayor',scope:'numbers.read voice.read',exp:now/1000+1800};
function transport(t:unknown=token,i:unknown=info){return vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(t)).mockResolvedValueOnce(Response.json(i));}
describe('Telnyx consent protocol',()=>{
 it('uses S256, a fixed callback and no secret or verifier in the consent URL',async()=>{
  const url=new URL(await telnyxAuthorizeUrl(config,state,verifier));
  expect(url.origin).toBe('https://api.telnyx.com');
  expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  expect(url.searchParams.get('code_challenge')).toHaveLength(43);
  expect(url.searchParams.get('state')).toBe(state);
  expect(url.href).not.toContain(verifier);expect(url.href).not.toContain('secret');
  await expect(telnyxAuthorizeUrl({...config,redirectUri:'https://evil.test'} as any,state,verifier)).rejects.toThrow();
 });
 it('verifies client and permissions, bounds lifetime, and prevents redirects',async()=>{
  const fetcher=transport(),result=await telnyxTokenExchange(config,{code:'code-secret',verifier},fetcher,now);
  expect(result.expiresAt).toBe(info.exp*1000);expect(result.refreshToken).toBe('refresh-secret');
  expect(fetcher).toHaveBeenCalledTimes(2);
  for(const call of fetcher.mock.calls)expect(call[1]?.redirect).toBe('manual');
  const body=fetcher.mock.calls[0][1]?.body as URLSearchParams;
  expect(body.get('code_verifier')).toBe(verifier);expect(body.has('client_secret')).toBe(false);
 });
 it.each([{...info,active:false},{...info,client_id:'another-app'},{...info,scope:''},{...info,exp:now/1000},{}])('rejects unverifiable grants without leaking secrets: %j',async invalid=>{
  await expect(telnyxTokenExchange(config,{code:'code-secret',verifier},transport(token,invalid),now)).rejects.toThrow(/^telnyx_authorization_failed$/);
 });
 it('preserves an omitted refresh token only during refresh and accepts rotation',async()=>{
  const noRefresh={...token,refresh_token:undefined};
  await expect(telnyxTokenExchange(config,{code:'code-secret',verifier},transport(noRefresh),now)).rejects.toThrow();
  expect((await telnyxTokenExchange(config,{refreshToken:'old-refresh'},transport(noRefresh),now)).refreshToken).toBe('old-refresh');
  expect((await telnyxTokenExchange(config,{refreshToken:'old-refresh'},transport(),now)).refreshToken).toBe('refresh-secret');
 });
 it.each([302,400,429,500])('never retries or exposes an HTTP %s body',async status=>{
  const fetcher=vi.fn<typeof fetch>().mockResolvedValue(new Response('secret-provider-error',{status}));
  await expect(telnyxTokenExchange(config,{code:'code-secret',verifier},fetcher,now)).rejects.toThrow(/^telnyx_authorization_failed$/);
  expect(fetcher).toHaveBeenCalledTimes(1);
 });
 it('redacts network failures and rejects oversized successful bodies',async()=>{
  await expect(telnyxTokenExchange(config,{refreshToken:'old-refresh'},vi.fn<typeof fetch>().mockRejectedValue(new Error('secret')),now)).rejects.toThrow(/^telnyx_authorization_failed$/);
  await expect(telnyxTokenExchange(config,{refreshToken:'old-refresh'},transport({...token,extra:'x'.repeat(70000)}),now)).rejects.toThrow(/^telnyx_authorization_failed$/);
 });
});
