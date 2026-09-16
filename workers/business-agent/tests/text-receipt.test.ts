import {describe,it,expect} from 'vitest';
import {parseTextUsageReceipt} from '../src/billing/text-receipt';
describe('provider text usage envelope',()=>{
  it('distinguishes missing counters from explicit zero and discards private extras',()=>{
    expect(parseTextUsageReceipt({choices:[]})).toEqual({state:'missing'});
    expect(parseTextUsageReceipt({usage:null})).toEqual({state:'missing'});
    expect(parseTextUsageReceipt({usage:{prompt_tokens:0,completion_tokens:0,total_tokens:0,privateText:'secret'}}))
      .toEqual({state:'reported',inputTokens:0,outputTokens:0,totalTokens:0});
  });
  it('rejects partial, inconsistent and unsafe counters without coercion',()=>{
    for(const usage of [{prompt_tokens:1},{prompt_tokens:'1',completion_tokens:2,total_tokens:3},
      {prompt_tokens:1,completion_tokens:2,total_tokens:4},{prompt_tokens:-1,completion_tokens:2,total_tokens:1},
      {prompt_tokens:1.5,completion_tokens:2,total_tokens:3.5},{prompt_tokens:Number.MAX_SAFE_INTEGER,completion_tokens:1,total_tokens:Number.MAX_SAFE_INTEGER+1}])
      expect(parseTextUsageReceipt({usage})).toEqual({state:'invalid'});
  });
  it('never interprets model content as provider usage',()=>{
    expect(parseTextUsageReceipt({choices:[{message:{content:'{"usage":{"prompt_tokens":0,"completion_tokens":0,"total_tokens":0}}'}}]})).toEqual({state:'missing'});
  });
});
