import {it,expect} from 'vitest';
import {streamText,tool} from 'ai';
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
 const result=streamText({model:mayorModel(ai),prompt:'Propose Remote Probe Business',tools:{proposeProfile:tool({inputSchema:z.object({name:z.string()}),execute:async({name})=>{calls.push(name);return {status:'awaiting_confirmation'};}})}});
 for await(const part of result.fullStream){expect(part.type).not.toBe('tool-error');expect(part.type).not.toBe('error');}
 expect(calls).toEqual(['Remote Probe Business']);
});
it('rejects malformed and oversized SSE instead of forwarding unbounded model data',async()=>{
 await expect(new Response(normalizeWorkersAIStream(stream('data: not-json\n\n'))).text()).rejects.toThrow('Invalid model');
 await expect(new Response(normalizeWorkersAIStream(stream('data: '+ 'a'.repeat(262145),65536))).text()).rejects.toThrow('too large');
});
