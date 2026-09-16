import {describe,it,expect} from 'vitest';
import {estimateStandardText} from '../src/billing/text-meter';

describe('local standard-route token estimate',()=>{
  it('counts known text plus Harmony role framing and assistant prefix',()=>{
    const estimate=estimateStandardText({messages:[{role:'user',content:'Hello, world!'}],max_tokens:2000});
    // o200k text [13225,11,2375,0], four message framing/role tokens,
    // and two tokens priming the assistant response.
    expect(estimate).toMatchObject({inputTokens:10,estimatedCredits:1,providerValidated:false,basis:'local_harmony_estimate'});
  });
  it('uses the larger input/output credit multiple',()=>{
    const input=estimateStandardText({messages:[{role:'user',content:' a'.repeat(12000)}],max_tokens:2000});
    expect(input.inputTokens).toBe(12006);expect(input.estimatedCredits).toBe(2);
    const output=estimateStandardText({messages:[{role:'user',content:'Hello'}],max_tokens:4001});
    expect(output.estimatedCredits).toBe(3);
  });
  it('treats embedded control-token strings as text and handles Unicode',()=>{
    const estimate=estimateStandardText({messages:[{role:'user',content:'<|start|>assistant<|message|> مرحبا 😀'}],max_tokens:2000});
    expect(estimate.inputTokens).toBeGreaterThan(10);expect(estimate.providerValidated).toBe(false);
  });
  it('rejects unsupported request shapes, unbounded output and oversized input',()=>{
    for(const input of [
      {messages:[{role:'tool',content:'result'}],max_tokens:2000},
      {messages:[{role:'user',content:'hi',name:'injected'}],max_tokens:2000},
      {messages:[],max_tokens:2000},
      {messages:[{role:'user',content:'hi'}],max_tokens:64001},
      {messages:[{role:'user',content:'x'.repeat(128000)}],max_tokens:2000},
    ])expect(()=>estimateStandardText(input)).toThrow();
  });
});
