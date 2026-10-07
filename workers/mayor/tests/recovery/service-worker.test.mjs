import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source=readFileSync(new URL('../../web/public/sw.js',import.meta.url),'utf8');
function worker(fetch){
 const handlers={};
 runInNewContext(source,{URL,Response,fetch,self:{location:{origin:'https://mayor.mehyar.us'},addEventListener:(type,handler)=>{handlers[type]=handler;}}});
 return request=>{let response;handlers.fetch({request,respondWith:value=>{response=value;}});return response;};
}
test('offline navigation gives a private, accessible recovery page without replaying actions',async()=>{
 let calls=0;const dispatch=worker(async()=>{calls++;throw new TypeError('network unavailable');});
 const response=await dispatch({url:'https://mayor.mehyar.us/',method:'GET',mode:'navigate'});
 assert.equal(response.status,503);assert.equal(response.headers.get('cache-control'),'no-store');
 assert.match(response.headers.get('content-security-policy'),/default-src 'none'/);
 const html=await response.text();assert.match(html,/lang="en"/);assert.match(html,/<main>/);assert.match(html,/check its status after reconnecting/);assert.doesNotMatch(html,/<script|<form|details are safe/);assert.equal(calls,1);
});
test('API, voice, non-navigation, cross-origin and write requests are never intercepted',()=>{
 const dispatch=worker(()=>{throw new Error('must not fetch');});
 for(const request of [
  {url:'https://mayor.mehyar.us/api/auth/callback/google',method:'GET',mode:'navigate'},
  {url:'https://mayor.mehyar.us/agents/mayor-voice/test',method:'GET',mode:'navigate'},
  {url:'https://mayor.mehyar.us/',method:'POST',mode:'navigate'},
  {url:'https://mayor.mehyar.us/',method:'GET',mode:'cors'},
  {url:'https://example.test/',method:'GET',mode:'navigate'},
 ])assert.equal(dispatch(request),undefined);
});
test('successful navigation and server error responses remain unchanged',async()=>{
 for(const status of [200,401,503]){
  const original=new Response('server response',{status});const dispatch=worker(async(request,options)=>{assert.equal(options.cache,'no-store');return original;});
  assert.equal(await dispatch({url:'https://mayor.mehyar.us/',method:'GET',mode:'navigate'}),original);
 }
});
