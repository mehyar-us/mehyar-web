const MAX_CONTENT=160000;
const MAX_EVENT=1000000;
type ObjectValue=Record<string,unknown>;
const object=(value:unknown):value is ObjectValue=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const invalid=()=>new Error('audit_stream_invalid');
const aborted=()=>new DOMException('Audit stream aborted','AbortError');

/** Only documented numeric usage fields survive; provider metadata and reasoning do not. */
function safeUsage(value:unknown){
 if(!object(value))throw invalid();
 const result:ObjectValue={};
 const count=(source:ObjectValue,key:string,target:ObjectValue)=>{
  if(source[key]===undefined||source[key]===null)return;
  if(typeof source[key]!=='number'||!Number.isSafeInteger(source[key])||source[key]<0)throw invalid();
  target[key]=source[key];
 };
 for(const key of ['prompt_tokens','completion_tokens','total_tokens'])count(value,key,result);
 for(const [key,names] of [['prompt_tokens_details',['cached_tokens']],['completion_tokens_details',['reasoning_tokens','accepted_prediction_tokens','rejected_prediction_tokens']]] as const){
  if(value[key]===undefined||value[key]===null)continue;
  if(!object(value[key]))throw invalid();
  const details:ObjectValue={};
  for(const name of names)count(value[key],name,details);
  if(Object.keys(details).length)result[key]=details;
 }
 return result;
}

/** Drain one genuine SSE completion. Admission and JSON validation remain in the audit core. */
export async function readAuditStream(stream:ReadableStream<Uint8Array>,model:string,signal:AbortSignal):Promise<unknown>{
 const reader=stream.getReader();
 let cancellation:Promise<void>|undefined;
 const cancel=()=>{cancellation??=reader.cancel().catch(()=>{});};
 if(signal.aborted){cancel();reader.releaseLock();throw aborted();}
 let rejectAbort:(error:Error)=>void=()=>{};
 const abortPromise=new Promise<never>((_,reject)=>{rejectAbort=reject;});
 const onAbort=()=>{cancel();rejectAbort(aborted());};
 signal.addEventListener('abort',onAbort,{once:true});
 const decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:false});
 let buffer='',content='',id:string|undefined,finish:string|undefined,role:string|undefined,done=false;
 let usage:ObjectValue|undefined;
 let completed=false;
 const event=(value:string)=>{
  const lines=value.split(/\r\n|\n|\r/);
  if(lines.some(line=>line==='event:error'||line==='event: error'))throw invalid();
  const data=lines.filter(line=>line.startsWith('data:')).map(line=>line.slice(5).replace(/^ /,'')).join('\n');
  if(!data)return;
  if(done)throw invalid();
  if(data==='[DONE]'){
   if(!id||!finish)throw invalid();
   done=true;return;
  }
  let chunk:unknown;
  try{chunk=JSON.parse(data);}catch{throw invalid();}
  // Native frontier trailers may omit the completion tuple. Only the observed
  // empty-response usage shape is metadata, after an actual terminal choice.
  if(object(chunk)&&Object.keys(chunk).sort().join(',')==='response,usage'){
   if(!id||!finish||chunk.response!==''||!object(chunk.usage))throw invalid();
   usage=safeUsage(chunk.usage);return;
  }
  if(!object(chunk)||chunk.error!=null||chunk.errors!=null||chunk.refusal!=null||chunk.message!=null||
   typeof chunk.id!=='string'||!chunk.id||chunk.id.length>200||chunk.model!==model||!Array.isArray(chunk.choices)||chunk.choices.length>1)throw invalid();
  if(id!==undefined&&id!==chunk.id)throw invalid();
  id=chunk.id;
  if(chunk.usage!=null)usage=safeUsage(chunk.usage);
  if(chunk.choices.length===0){if(chunk.usage==null)throw invalid();return;}
  const choice:unknown=chunk.choices[0];
  if(!object(choice)||choice.index!==0||!object(choice.delta)||choice.message!=null||choice.refusal!=null)throw invalid();
  const delta=choice.delta;
  if(delta.tool_calls!=null||delta.function_call!=null||delta.refusal!=null)throw invalid();
  if(delta.role!=null){if(delta.role!=='assistant'||(role!==undefined&&role!==delta.role))throw invalid();role=delta.role;}
  if(delta.content!=null){
   if(typeof delta.content!=='string'||finish!==undefined)throw invalid();
   content+=delta.content;
   if(content.length>MAX_CONTENT)throw invalid();
  }
  // Reasoning fields are deliberately never retained or copied into the completion.
  if(choice.finish_reason!=null){
   if(finish!==undefined||!['stop','length','content_filter'].includes(choice.finish_reason as string))throw invalid();
   finish=choice.finish_reason as string;
  }
 };
 const consume=()=>{
  let boundary:RegExpExecArray|null;
  while((boundary=/\r\n\r\n|\n\n|\r\r/.exec(buffer))){
   if(boundary.index>MAX_EVENT)throw invalid();
   event(buffer.slice(0,boundary.index));
   buffer=buffer.slice(boundary.index+boundary[0].length);
  }
  if(buffer.length>MAX_EVENT)throw invalid();
 };
 try{
  for(;;){
   if(signal.aborted)throw aborted();
   const part=await Promise.race([reader.read(),abortPromise]);
   if(signal.aborted)throw aborted();
   if(part.done)break;
   if(!(part.value instanceof Uint8Array))throw invalid();
   buffer+=decoder.decode(part.value,{stream:true});consume();
  }
  buffer+=decoder.decode();consume();
  // SSE dispatch requires a blank line; an unfinished final event is truncation.
  if(buffer.trim()||!done||!id||!finish||signal.aborted)throw signal.aborted?aborted():invalid();
  completed=true;
  return {id,model,choices:[{index:0,finish_reason:finish,message:{role:role??'assistant',content}}],...(usage===undefined?{}:{usage})};
 }finally{
  signal.removeEventListener('abort',onAbort);
  if(!completed)cancel();
  reader.releaseLock();
 }
}
