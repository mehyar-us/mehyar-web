import {describe,expect,it,vi} from 'vitest';
import {readAuditStream} from '../src/audit-stream';

const model='@cf/deepseek-ai/deepseek-v4-pro-0813';
const encoder=new TextEncoder();
const chunk=(delta:Record<string,unknown>={},finish_reason:string|null=null,extra:Record<string,unknown>={})=>({id:'chatcmpl-real',model,choices:[{index:0,delta,finish_reason}],...extra});
const event=(value:unknown,eol='\n')=>`data: ${typeof value==='string'?value:JSON.stringify(value)}${eol}${eol}`;
const valid=(content='{"name":"Café 🚲"}')=>event(chunk({role:'assistant',content}))+event(chunk({},'stop'))+event('[DONE]');
function stream(bytes:Uint8Array[],cancel=vi.fn()){
 return new ReadableStream<Uint8Array>({start(controller){for(const part of bytes)controller.enqueue(part);controller.close();},cancel});
}
const parse=(text:string)=>readAuditStream(stream([encoder.encode(text)]),model,new AbortController().signal);

describe('audit SSE completion',()=>{
 it('assembles actual visible content across single-byte UTF8, CRLF and SSE boundaries',async()=>{
  const text=': keepalive\r\n\r\n'+event(chunk({role:'assistant',reasoning_content:'PRIVATE REASONING'}),'\r\n')+event(chunk({content:'{"name":"Café 🚲"}'}),'\r\n')+event(chunk({},'stop'),'\r\n')+event('[DONE]','\r\n');
  const bytes=encoder.encode(text);
  const result=await readAuditStream(stream(Array.from(bytes,value=>Uint8Array.of(value))),model,new AbortController().signal);
  expect(result).toEqual({id:'chatcmpl-real',model,choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content:'{"name":"Café 🚲"}'}}]});
  expect(JSON.stringify(result)).not.toContain('PRIVATE');
 });
 it('supports multiple data lines and a usage trailer while dropping unapproved metadata',async()=>{
  const first=JSON.stringify(chunk({content:'{}'})).replace(',"choices"',',\n"choices"');
  const multiline=first.split('\n').map(line=>`data: ${line}`).join('\n')+'\n\n';
  const usage={prompt_tokens:12,completion_tokens:20,total_tokens:32,completion_tokens_details:{reasoning_tokens:15,secret:'discard'},prompt_tokens_details:{cached_tokens:2},metadata:'discard'};
  const result=await parse(multiline+event(chunk({},'stop'))+event({id:'chatcmpl-real',model,choices:[],usage})+event('[DONE]'));
  expect(result).toMatchObject({usage:{prompt_tokens:12,completion_tokens:20,total_tokens:32,completion_tokens_details:{reasoning_tokens:15},prompt_tokens_details:{cached_tokens:2}}});
  expect(JSON.stringify(result)).not.toContain('discard');
 });
 it.each(['length','content_filter'])('preserves settled %s for the core to reject, without converting it to STOP',async finish=>{
  expect(await parse(event(chunk({content:'partial'},finish))+event('[DONE]'))).toMatchObject({choices:[{finish_reason:finish,message:{content:'partial'}}]});
 });
 it.each(['stop','length'])('accepts the native empty-response usage trailer only after actual %s',async finish=>{
  expect(await parse(event(chunk({content:finish==='stop'?'{}':''},finish))+event({usage:{prompt_tokens:12,completion_tokens:32,total_tokens:44},response:''})+event('[DONE]'))).toMatchObject({usage:{prompt_tokens:12,completion_tokens:32,total_tokens:44},choices:[{finish_reason:finish}]});
 });
 it.each([
  ['before terminal',event({usage:{total_tokens:3},response:''})+valid()],
  ['nonempty response after terminal',event(chunk({content:'{}'},'stop'))+event({usage:{total_tokens:3},response:'extra'})+event('[DONE]')],
  ['foreign identity in trailer',event(chunk({content:'{}'},'stop'))+event({usage:{total_tokens:3},response:'',id:'other'})+event('[DONE]')],
  ['trailer without usage',event(chunk({content:'{}'},'stop'))+event({response:''})+event('[DONE]')]
 ])('rejects native trailer %s',async(_,text)=>{
  await expect(parse(text)).rejects.toThrow('audit_stream_invalid');
 });
 it('accepts the exact core visible-content bound',async()=>{
  expect(await parse(valid('x'.repeat(160000)))).toMatchObject({choices:[{message:{content:'x'.repeat(160000)}}]});
 });
 it.each([
  ['changed ID',event(chunk({content:'{}'}))+event(chunk({},'stop',{id:'other'}))+event('[DONE]')],
  ['wrong model',event(chunk({content:'{}'},'stop',{model:'other'}))+event('[DONE]')],
  ['missing identity',event({...chunk({content:'{}'},'stop'),id:undefined})+event('[DONE]')],
  ['foreign choice',event({...chunk({content:'{}'},'stop'),choices:[{index:1,delta:{content:'{}'},finish_reason:'stop'}]})+event('[DONE]')],
  ['duplicate choice zero',event({...chunk(),choices:[chunk().choices[0],chunk().choices[0]]})+event('[DONE]')],
  ['array delta',event({...chunk(),choices:[{index:0,delta:[],finish_reason:'stop'}]})+event('[DONE]')],
  ['provider error',event({error:{message:'DO NOT EXPOSE'}})],
  ['error event','event: error\ndata: {}\n\n'],
  ['refusal',event(chunk({refusal:'DO NOT EXPOSE'},'stop'))+event('[DONE]')],
  ['tool call',event(chunk({tool_calls:[]},'tool_calls'))+event('[DONE]')],
  ['function call',event(chunk({function_call:{}},'stop'))+event('[DONE]')],
  ['nonassistant role',event(chunk({role:'user',content:'{}'},'stop'))+event('[DONE]')],
  ['nonstring content',event(chunk({content:{}},'stop'))+event('[DONE]')],
  ['unknown finish',event(chunk({content:'{}'},'error'))+event('[DONE]')],
  ['content after stop',event(chunk({content:'{}'},'stop'))+event(chunk({content:'extra'}))+event('[DONE]')],
  ['duplicate finish',event(chunk({content:'{}'},'stop'))+event(chunk({},'stop'))+event('[DONE]')],
  ['event after DONE',valid()+event(chunk({content:'extra'}))],
  ['no STOP',event(chunk({content:'{}'}))+event('[DONE]')],
  ['no DONE',event(chunk({content:'{}'},'stop'))],
  ['partial final event',event(chunk({content:'{}'},'stop'))+'data: [DONE]'],
  ['malformed JSON','data: {broken}\n\n'],
  ['content too large',valid('x'.repeat(160001))],
  ['event too large','data: '+ 'x'.repeat(1000001)],
  ['coerced usage',event(chunk({content:'{}'},'stop',{usage:{total_tokens:'3'}}))+event('[DONE]')],
  ['negative usage',event(chunk({content:'{}'},'stop',{usage:{completion_tokens:-1}}))+event('[DONE]')]
 ])('rejects %s without exposing provider error content',async(_,text)=>{
  await expect(parse(text)).rejects.toThrow('audit_stream_invalid');
 });
 it('rejects malformed or unfinished UTF8 rather than silently replacing it',async()=>{
  await expect(readAuditStream(stream([Uint8Array.of(0xc3)]),model,new AbortController().signal)).rejects.toThrow();
 });
 it('cancels a returned stream when the signal was already aborted',async()=>{
  const cancel=vi.fn(),controller=new AbortController();controller.abort();
  const source=new ReadableStream<Uint8Array>({cancel});
  await expect(readAuditStream(source,model,controller.signal)).rejects.toMatchObject({name:'AbortError'});
  expect(cancel).toHaveBeenCalledOnce();expect(source.locked).toBe(false);
 });
 it('cancels a stalled read promptly even when underlying cancellation never settles',async()=>{
  const cancel=vi.fn(()=>new Promise<void>(()=>{})),controller=new AbortController();
  const source=new ReadableStream<Uint8Array>({cancel});
  const reading=readAuditStream(source,model,controller.signal);
  controller.abort();
  await expect(reading).rejects.toMatchObject({name:'AbortError'});
  expect(cancel).toHaveBeenCalledOnce();expect(source.locked).toBe(false);
 });
 it('does not release a completion when cancellation follows STOP before DONE',async()=>{
  let feed!:ReadableStreamDefaultController<Uint8Array>;
  const cancel=vi.fn(),controller=new AbortController();
  const source=new ReadableStream<Uint8Array>({start(value){feed=value;},cancel});
  feed.enqueue(encoder.encode(event(chunk({content:'{}'},'stop'))));
  const reading=readAuditStream(source,model,controller.signal);
  await Promise.resolve();controller.abort();
  await expect(reading).rejects.toMatchObject({name:'AbortError'});expect(cancel).toHaveBeenCalledOnce();
 });
 it('preserves a transport read failure and releases the reader',async()=>{
  const failure=new Error('local transport spy');
  const source=new ReadableStream<Uint8Array>({start(controller){controller.error(failure);}});
  await expect(readAuditStream(source,model,new AbortController().signal)).rejects.toBe(failure);
  expect(source.locked).toBe(false);
 });
});
