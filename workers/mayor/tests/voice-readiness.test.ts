import {describe,it,expect} from 'vitest';
import {voiceReadiness,voiceReadinessResponse} from '../src/voice-readiness';
import {voiceUnavailableNotice} from '../web/voice-call';
import type {Env} from '../src/env';

const binding=()=>({} as unknown as Env['AI']);
type ReadinessEnv=Pick<Env,'AI'|'AI_GATEWAY_ACCOUNT_ID'|'AI_GATEWAY_TOKEN'>;
const envWith=(overrides:Partial<ReadinessEnv>)=>overrides as ReadinessEnv;

describe('voiceReadiness (pure)',()=>{
 it('reports unavailable with a plain-language reason when nothing is configured',()=>{
  expect(voiceReadiness({})).toEqual({available:false,reason:'voice service is not configured',transport:'none'});
 });
 it('prefers the gateway when gateway credentials are present',()=>{
  expect(voiceReadiness({AI_GATEWAY_TOKEN:'tok',AI_GATEWAY_ACCOUNT_ID:'acct',AI:binding()}))
   .toEqual({available:true,reason:null,transport:'gateway'});
 });
 it('ignores blank gateway credentials and falls back to the direct binding',()=>{
  expect(voiceReadiness({AI_GATEWAY_TOKEN:'  ',AI_GATEWAY_ACCOUNT_ID:'acct',AI:binding()}))
   .toEqual({available:true,reason:null,transport:'direct'});
 });
 it('reports direct when only the Workers AI binding is present',()=>{
  expect(voiceReadiness({AI:binding()})).toEqual({available:true,reason:null,transport:'direct'});
 });
 it('stays unavailable when the token is present but the account id is missing',()=>{
  expect(voiceReadiness({AI_GATEWAY_TOKEN:'tok'})).toEqual({available:false,reason:'voice service is not configured',transport:'none'});
 });
});

// The route in src/index.ts delegates to voiceReadinessResponse for
// GET /api/voice/readiness (index.ts itself pulls the `agents` package, which
// node cannot load — the wiring is one line, verified by tsc + review).
describe('voiceReadinessResponse (GET /api/voice/readiness body)',()=>{
 it('returns 200 public JSON with no-store when nothing is configured',()=>{
  const res=voiceReadinessResponse(envWith({}));
  expect(res.status).toBe(200);
  expect(res.headers.get('cache-control')).toBe('no-store');
  return res.json().then(body=>expect(body).toEqual({available:false,reason:'voice service is not configured',transport:'none'}));
 });
 it('is CORS-readable and carries no secrets',async()=>{
  const res=voiceReadinessResponse(envWith({AI_GATEWAY_TOKEN:'tok',AI_GATEWAY_ACCOUNT_ID:'acct',AI:binding()}));
  expect(res.headers.get('access-control-allow-origin')).toBe('*');
  const text=await res.text();
  expect(text).not.toContain('tok');
  expect(text).not.toContain('acct');
  expect(JSON.parse(text)).toEqual({available:true,reason:null,transport:'gateway'});
 });
 it('reports direct when the Workers AI binding is present',async()=>{
  const res=voiceReadinessResponse(envWith({AI:binding()}));
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({available:true,reason:null,transport:'direct'});
 });
});

describe('voiceUnavailableNotice (client notice branch)',()=>{
 it('builds the exact degraded-state notice',()=>{
  expect(voiceUnavailableNotice('voice service is not configured'))
   .toBe("Voice isn't available right now — voice service is not configured. Chat works normally.");
 });
 it('falls back to a default reason for blank input',()=>{
  expect(voiceUnavailableNotice('   '))
   .toBe("Voice isn't available right now — voice service is not configured. Chat works normally.");
 });
 it('trims the reason',()=>{
  expect(voiceUnavailableNotice('  the voice service is down for maintenance  '))
   .toBe("Voice isn't available right now — the voice service is down for maintenance. Chat works normally.");
 });
});
