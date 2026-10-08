import {beforeEach,describe,it,expect,vi} from 'vitest';
import {COUNCIL_DISCLAIMER,COUNCIL_STOPPED_REPLY,COUNCIL_SYSTEM_PROMPT,councilInputSchema,handleCouncilRequest,wantsCouncilStop} from '../src/council';
import {HttpError} from '../src/http';
import type {Env} from '../src/env';

const perms=vi.hoisted(()=>({requireMembership:vi.fn(),CHAT_ROLES:['owner','manager','staff']}));
vi.mock('../src/permissions',()=>perms);
const usage=vi.hoisted(()=>({claimUsage:vi.fn()}));
vi.mock('../src/usage',()=>usage);
const fakeCouncilText='HOT ZERO: Build the thing.\n\nSACHAEL: Ship it Tuesday.\n\nTHE KING: Build it, ship it Tuesday.';
const models=vi.hoisted(()=>({mayorModel:vi.fn()}));
vi.mock('../src/ai-model',()=>models);

const actor={tenantId:'a'.repeat(32),userId:'user-1'};
const env={} as Env;
function postRequest(body:unknown,method='POST'){
 return new Request(`https://mayor.mehyar.us/api/businesses/${actor.tenantId}/council`,{method,headers:{'content-type':'application/json'},body:method==='POST'?JSON.stringify(body):undefined});
}

beforeEach(()=>{
 vi.clearAllMocks();
 perms.requireMembership.mockResolvedValue(undefined);
 usage.claimUsage.mockResolvedValue({allowed:true,replyAttemptCounted:true});
 models.mayorModel.mockReturnValue({
  specificationVersion:'v2',provider:'test',modelId:'council-test',supportedUrls:{},
  doGenerate:async()=>({
   content:[{type:'text',text:fakeCouncilText}],
   finishReason:'stop',
   usage:{inputTokens:10,outputTokens:10,inputTokenDetails:{},outputTokenDetails:{}},
   warnings:[],
  }),
 } as any);
});

describe('council input validation',()=>{
 it('accepts a well-formed question',()=>{
  const input=councilInputSchema.parse({requestId:crypto.randomUUID(),text:'Should I raise prices?'});
  expect(input.text).toBe('Should I raise prices?');
 });
 it('rejects empty text',()=>{expect(()=>councilInputSchema.parse({requestId:crypto.randomUUID(),text:'  '})).toThrow();});
 it('rejects text over 4000 chars',()=>{expect(()=>councilInputSchema.parse({requestId:crypto.randomUUID(),text:'x'.repeat(4001)})).toThrow();});
 it('rejects a bad request id',()=>{expect(()=>councilInputSchema.parse({requestId:'nope',text:'hi'})).toThrow();});
});

describe('council prompt contract',()=>{
 it('names all seven seats',()=>{
  for(const seat of ['HOT ZERO','THE MAYOR','SACHAEL','THE KONT','QAHIR','LIL M','THE KING'])expect(COUNCIL_SYSTEM_PROMPT).toContain(seat);
 });
 it('never labels the Kont "the Don" (only as a prohibition)',()=>{
  expect(COUNCIL_SYSTEM_PROMPT).toContain('Never call him "the Don"');
  expect(COUNCIL_SYSTEM_PROMPT).not.toMatch(/^THE DON:/m);
 });
 it('keeps Qahir silent by default and threat-gated',()=>{
  expect(COUNCIL_SYSTEM_PROMPT).toMatch(/SILENT/i);
  expect(COUNCIL_SYSTEM_PROMPT).toMatch(/threat-level/);
 });
 it('rules the King last and collapses on stop',()=>{
  expect(COUNCIL_SYSTEM_PROMPT).toMatch(/Always LAST/);
  expect(COUNCIL_SYSTEM_PROMPT).toMatch(/collapse immediately to one direct voice/);
 });
});

describe('handleCouncilRequest',()=>{
 it('returns the council reply with the AI disclaimer appended',async()=>{
  const response=await handleCouncilRequest(postRequest({requestId:crypto.randomUUID(),text:'Should I raise prices?'}),env,actor);
  expect(response.status).toBe(200);
  const body=await response.json() as {reply:string;events:unknown[]};
  expect(body.reply).toContain('HOT ZERO');
  expect(body.reply).toContain('THE KING');
  expect(body.reply.endsWith(COUNCIL_DISCLAIMER)).toBe(true);
  expect(perms.requireMembership).toHaveBeenCalled();
  expect(usage.claimUsage).toHaveBeenCalledWith(env,actor,'turn');
 });
 it('claims one reply attempt against the house quota',async()=>{
  await handleCouncilRequest(postRequest({requestId:crypto.randomUUID(),text:'Hi council'}),env,actor);
  expect(usage.claimUsage).toHaveBeenCalledTimes(1);
 });
 it('returns 402 with the quota message when the allowance is exhausted',async()=>{
  usage.claimUsage.mockResolvedValue({allowed:false,replyAttemptCounted:false,message:'Free allowance used up.',resetAt:'x',limit:100,kind:'turn',remaining:0});
  const response=await handleCouncilRequest(postRequest({requestId:crypto.randomUUID(),text:'Hi council'}),env,actor);
  expect(response.status).toBe(402);
  expect((await response.json() as {message:string}).message).toBe('Free allowance used up.');
  expect(models.mayorModel).not.toHaveBeenCalled();
 });
 it('rejects non-POST with 405',async()=>{
  await expect(handleCouncilRequest(postRequest(null,'GET'),env,actor)).rejects.toMatchObject({status:405});
  expect(usage.claimUsage).not.toHaveBeenCalled();
 });
 it('rejects invalid input before touching quota or the model',async()=>{
  await expect(handleCouncilRequest(postRequest({requestId:crypto.randomUUID(),text:''}),env,actor)).rejects.toThrow();
  expect(usage.claimUsage).not.toHaveBeenCalled();
  expect(models.mayorModel).not.toHaveBeenCalled();
 });
 it('denies without membership',async()=>{
  perms.requireMembership.mockRejectedValue(new HttpError(403,'forbidden','Nope.'));
  await expect(handleCouncilRequest(postRequest({requestId:crypto.randomUUID(),text:'Hi'}),env,actor)).rejects.toMatchObject({status:403});
 });
 it('throws 502 on empty model output instead of returning disclaimer-only',async()=>{
  models.mayorModel.mockReturnValue({
   specificationVersion:'v2',provider:'test',modelId:'council-test',supportedUrls:{},
   doGenerate:async()=>({
    content:[{type:'text',text:'   '}],
    finishReason:'stop',
    usage:{inputTokens:10,outputTokens:0,inputTokenDetails:{},outputTokenDetails:{}},
    warnings:[],
   }),
  } as any);
  await expect(handleCouncilRequest(postRequest({requestId:crypto.randomUUID(),text:'Should I raise prices?'}),env,actor)).rejects.toMatchObject({status:502,code:'council_empty'});
 });
 it('throws 502 when the model call fails instead of returning disclaimer-only',async()=>{
  models.mayorModel.mockReturnValue({
   specificationVersion:'v2',provider:'test',modelId:'council-test',supportedUrls:{},
   doGenerate:async()=>{throw new Error('gateway timeout');},
  } as any);
  await expect(handleCouncilRequest(postRequest({requestId:crypto.randomUUID(),text:'Hi'}),env,actor)).rejects.toMatchObject({status:502});
 });
 it('handles "stop" deterministically without calling the model',async()=>{
  for(const text of ['stop','Stop.','enough',"that's enough",'end the council','back to assistant']){
   const response=await handleCouncilRequest(postRequest({requestId:crypto.randomUUID(),text}),env,actor);
   expect(response.status).toBe(200);
   const body=await response.json() as {reply:string;stopped:boolean};
   expect(body.reply).toBe(COUNCIL_STOPPED_REPLY);
   expect(body.stopped).toBe(true);
  }
  expect(models.mayorModel).not.toHaveBeenCalled();
 });
});
describe('wantsCouncilStop',()=>{
 it('matches stop phrases',()=>{
  expect(wantsCouncilStop('stop')).toBe(true);
  expect(wantsCouncilStop('Stop.')).toBe(true);
  expect(wantsCouncilStop('ENOUGH')).toBe(true);
  expect(wantsCouncilStop('end the council')).toBe(true);
 });
 it('does not match ordinary questions',()=>{
  expect(wantsCouncilStop('Should I stop advertising?')).toBe(false);
  expect(wantsCouncilStop('stop the bleeding on ad spend')).toBe(false);
  expect(wantsCouncilStop('What is a stop-loss order?')).toBe(false);
 });
});
