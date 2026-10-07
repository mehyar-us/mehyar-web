import {createWorkersAI} from 'workers-ai-provider';
import type {Env} from './env';

/** Workers AI can emit native and OpenAI-compatible deltas in the same SSE
 * event. workers-ai-provider 4.0.0 consumes both, duplicating text/tool JSON.
 * Prefer the compatible representation only where that delta is present.
 */
export function normalizeWorkersAIStream(stream:ReadableStream<Uint8Array>){
 const decoder=new TextDecoder(),encoder=new TextEncoder();let buffer='';
 const emit=(event:string,controller:TransformStreamDefaultController<Uint8Array>)=>{
  const lines=event.replace(/\r\n/g,'\n').split('\n');
  const data=lines.filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');
  if(!data||data==='[DONE]'){controller.enqueue(encoder.encode(event+'\n\n'));return;}
  let chunk:any;try{chunk=JSON.parse(data);}catch{throw new Error('Invalid model stream event.');}
  const delta=chunk?.choices?.[0]?.delta;
  if(delta&&typeof delta==='object'){
   if(typeof delta.content==='string')delete chunk.response;
   if(Array.isArray(delta.tool_calls))delete chunk.tool_calls;
  }
  const other=lines.filter(line=>!line.startsWith('data:'));
  controller.enqueue(encoder.encode([...other,`data: ${JSON.stringify(chunk)}`,'',''].join('\n')));
 };
 return stream.pipeThrough(new TransformStream<Uint8Array,Uint8Array>({
  transform(chunk,controller){
   buffer+=decoder.decode(chunk,{stream:true});
   let boundary:RegExpExecArray|null;
   while((boundary=/\r?\n\r?\n/.exec(buffer))){if(boundary.index>262144)throw new Error('Model stream event too large.');emit(buffer.slice(0,boundary.index),controller);buffer=buffer.slice(boundary.index+boundary[0].length);}
   if(buffer.length>262144)throw new Error('Model stream event too large.');
  },
  flush(controller){buffer+=decoder.decode();if(buffer.trim())emit(buffer,controller);}
 }));
}

import {gatewayRun} from './ai-gateway';

export function mayorModel(env:Pick<Env,'AI'|'AI_GATEWAY_ACCOUNT_ID'|'AI_GATEWAY_ID'|'AI_GATEWAY_TOKEN'>){
 // All model traffic goes through the shared AI Gateway (caching, fallbacks,
 // per-tenant rate limits, unified observability). The gateway client falls
 // back to the direct Workers AI binding on network/5xx errors only.
 const run=gatewayRun(env as Env);
 const binding={run:(async(model:string,input:unknown,options?:{stream?:boolean;signal?:AbortSignal})=>{
  const output=await run(model,input,options);
  // The gateway returns raw SSE; the direct-binding fallback inside gatewayRun
  // returns raw output too — normalize once here for the streaming case.
  return output instanceof ReadableStream?normalizeWorkersAIStream(output):output;
 }) as Env['AI']['run']};
 return createWorkersAI({binding:binding as Env['AI']})('@cf/qwen/qwen3-30b-a3b-fp8',{chat_template_kwargs:{enable_thinking:false}});
}
