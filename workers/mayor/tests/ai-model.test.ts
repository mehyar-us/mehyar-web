import {it,expect} from 'vitest';
import {generateText,streamText,tool} from 'ai';
import {z} from 'zod';
import {normalizeWorkersAIStream,mayorModel} from '../src/ai-model';
import type {Env} from '../src/env';
const encode=(events:unknown[])=>events.map(event=>`data: ${JSON.stringify(event)}\n\n`).join('')+'data: [DONE]\n\n';
function stream(text:string,split=17){const bytes=new TextEncoder().encode(text);return new ReadableStream<Uint8Array>({start(controller){for(let offset=0;offset<bytes.length;offset+=split)controller.enqueue(bytes.slice(offset,offset+split));controller.close();}});}
it('normalizes duplicated envelopes without deleting genuine repeated text or native-only chunks',async()=>{
 const events=[{response:'Hello',choices:[{delta:{content:'Hello'}}]},{response:'Hello',choices:[{delta:{content:'Hello'}}]},{response:' café'},{tool_calls:[{arguments:'{"name":"'}],choices:[{delta:{tool_calls:[{index:0,function:{arguments:'{"name":"'}}]}}]}];
 const output=await new Response(normalizeWorkersAIStream(stream(encode(events).replaceAll('\n','\r\n'),1))).text();
 const parsed=output.split('\n\n').filter(event=>event.startsWith('data: {')).map(event=>JSON.parse(event.slice(6)));
 expect(parsed[0].response).toBeUndefined();expect(parsed[1].choices[0].delta.content).toBe('Hello');expect(parsed[2].response).toBe(' café');expect(parsed[3].tool_calls).toBeUndefined();expect(parsed[3].choices[0].delta.tool_calls).toHaveLength(1);expect(output).toContain('data: [DONE]');
});
it('executes exactly one valid tool from the mixed Workers AI wire format',async()=>{
 const parts=['{"name": "','Remote',' Probe',' Business"}'];
 const events=[{tool_calls:[{name:'proposeProfile'}],choices:[{delta:{tool_calls:[{id:'call-1',index:0,type:'function',function:{name:'proposeProfile'}}]}}]},
  ...parts.map(arguments_=>({tool_calls:[{arguments:arguments_}],choices:[{delta:{tool_calls:[{index:0,function:{arguments:arguments_}}]}}]})),
  {choices:[{delta:{},finish_reason:'stop'}],usage:{prompt_tokens:20,completion_tokens:20,total_tokens:40}}];
 const ai={run:async()=>stream(encode(events))} as unknown as Env['AI'];
 const calls:string[]=[];
 const result=streamText({model:mayorModel({AI:ai}),prompt:'Propose Remote Probe Business',tools:{proposeProfile:tool({inputSchema:z.object({name:z.string()}),execute:async({name})=>{calls.push(name);return {status:'awaiting_confirmation'};}})}});
 for await(const part of result.fullStream){expect(part.type).not.toBe('tool-error');expect(part.type).not.toBe('error');}
 expect(calls).toEqual(['Remote Probe Business']);
});
it('rejects malformed and oversized SSE instead of forwarding unbounded model data',async()=>{
 await expect(new Response(normalizeWorkersAIStream(stream('data: not-json\n\n'))).text()).rejects.toThrow('Invalid model');
 await expect(new Response(normalizeWorkersAIStream(stream('data: '+ 'a'.repeat(262145),65536))).text()).rejects.toThrow('too large');
});
it('unwraps the AI Gateway REST envelope on non-streaming generateText and skips the gateway cache',async()=>{
 // Regression: gatewayRun used to return the full REST envelope
 // {result,success,errors,messages}, so workers-ai-provider's processText
 // (which reads output.response) extracted "" and the assistant turn 502'd with
 // an empty-reply error.
 const envelope={result:{response:'Build the new landing page.'},success:true,errors:[],messages:[]};
 const seenRequests:{url:string;headers:Record<string,string>}[]=[];
 const realFetch=globalThis.fetch;
 globalThis.fetch=(async(input:any,init?:any)=>{
  seenRequests.push({url:String(input),headers:Object.fromEntries(new Headers(init?.headers as HeadersInit).entries())});
  return new Response(JSON.stringify(envelope),{status:200,headers:{'content-type':'application/json'}});
 }) as typeof fetch;
 try{
  const ai={run:async()=>{throw new Error('direct binding must not be reached on the gateway path');}} as unknown as Env['AI'];
  const env={AI:ai,AI_GATEWAY_ACCOUNT_ID:'acct-1',AI_GATEWAY_ID:'mayor-businesses',AI_GATEWAY_TOKEN:'tok'} as Env;
  const result=await generateText({model:mayorModel(env),prompt:'Should we launch?'});
  expect(result.text).toBe('Build the new landing page.');
  expect(seenRequests).toHaveLength(1);
  expect(seenRequests[0].url).toContain('gateway.ai.cloudflare.com/v1/acct-1/mayor-businesses/workers-ai');
  expect(seenRequests[0].headers['cf-aig-skip-cache']).toBe('true');
 }finally{
  globalThis.fetch=realFetch;
 }
});
it('remaps reasoning_content to content on non-streaming generateText (qwen3 quirk)',async()=>{
 // Regression (captured live 2026-10-08): @cf/qwen/qwen3-30b-a3b-fp8 returns
 // HTTP 200 with the generated text in choices[0].message.reasoning_content
 // (mirrored in .reasoning) while choices[0].message.content and the
 // top-level response are null. workers-ai-provider's processText reads only
 // content/response, so generateText produced "" and the assistant turn 502'd
 // with an empty-reply error. The binding wrapper must repair the shape first.
 const quirk={choices:[{message:{role:'assistant',content:null,reasoning:'Build the new landing page.',reasoning_content:'Build the new landing page.'},finish_reason:'stop',index:0}],response:null,usage:{}};
 const ai={run:async()=>quirk} as unknown as Env['AI'];
 const result=await generateText({model:mayorModel({AI:ai}),prompt:'Should we launch?'});
 expect(result.text).toBe('Build the new landing page.');
});
it('remapReasoningContent leaves healthy outputs and streams untouched',async()=>{
 const {remapReasoningContent}=await import('../src/ai-model');
 // Healthy: real content present -> untouched (same reference).
 const healthy={choices:[{message:{content:'Real answer',reasoning_content:'thinking'}}]};
 expect(remapReasoningContent(healthy)).toBe(healthy);
 expect((healthy as any).choices[0].message.content).toBe('Real answer');
 // Empty-string content + reasoning -> repaired.
 const empty={choices:[{message:{content:'',reasoning_content:'Repaired'}}]};
 remapReasoningContent(empty);
 expect((empty as any).choices[0].message.content).toBe('Repaired');
 // No reasoning text -> untouched.
 const bare={choices:[{message:{content:null,reasoning_content:''}}]};
 remapReasoningContent(bare);
 expect((bare as any).choices[0].message.content).toBeNull();
 // Non-objects pass through.
 expect(remapReasoningContent(null)).toBeNull();
 expect(remapReasoningContent('text')).toBe('text');
});
