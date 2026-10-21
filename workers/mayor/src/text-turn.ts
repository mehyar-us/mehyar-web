/** HTTP and socket conversations share the same authorized business tools. */
export async function collectTextTurn(source:Promise<string|AsyncIterable<string>>,signal:AbortSignal){
 const value=await source;let reply='';
 if(signal.aborted)throw new Error('Conversation timed out');
 if(typeof value==='string'){if(value.length>12000)throw new Error('Response too large');return value;}
 for await(const part of value){
  if(signal.aborted)throw new Error('Conversation timed out');
  reply+=part;if(reply.length>12000)throw new Error('Response too large');
 }
 if(signal.aborted)throw new Error('Conversation timed out');
 return reply;
}

/** Chat reenvision Slice 2 — streaming turn bounds. The whole-reply path
 * keeps its 25s wall in voice.ts; a STREAMING turn is bounded by silence,
 * not by total time: no chunk for idleMs fails the turn, and totalMs is
 * only a wedge guard. The idle bound sits above the harness's own
 * slowest gaps (the model stream's 30s idle deadline in
 * stream-deadline.ts resolves into a chunk or a fallback first, and the
 * slowest tool runs ~12s), so a healthy long turn never trips it.
 * Mutable so tests can compress time. */
export const textStreamLimits={idleMs:45000,totalMs:180000};

export class StreamIdleTimeout extends Error{
 constructor(){super('Conversation stream idle');this.name='StreamIdleTimeout';}
}

/** Consume a turn source exactly like collectTextTurn (same 12,000-char
 * cap, same abort semantics) while emitting each chunk as it arrives.
 * The accumulation is capped; emission stops at the cap. */
export async function streamTextTurn(source:Promise<string|AsyncIterable<string>>,signal:AbortSignal,emit:(text:string)=>void):Promise<string>{
 const value=await source;let reply='';
 if(signal.aborted)throw new Error('Conversation timed out');
 if(typeof value==='string'){if(value.length>12000)throw new Error('Response too large');if(value)emit(value);return value;}
 const iterator=value[Symbol.asyncIterator]();
 const started=Date.now();
 try{
  for(;;){
   if(signal.aborted)throw new Error('Conversation timed out');
   const remaining=textStreamLimits.totalMs-(Date.now()-started);
   if(remaining<=0)throw new StreamIdleTimeout();
   let timer:ReturnType<typeof setTimeout>|undefined;
   const idle=new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>reject(new StreamIdleTimeout()),Math.min(textStreamLimits.idleMs,remaining));});
   let step:IteratorResult<string>;
   try{step=await Promise.race([iterator.next(),idle]);}
   finally{if(timer!==undefined)clearTimeout(timer);}
   if(step.done)break;
   const part=step.value;
   reply+=part;
   if(reply.length>12000)throw new Error('Response too large');
   emit(part);
  }
 }finally{
  // Early exits (abort / idle / oversize) close the generator so the
  // confirmation stream disarms instead of dangling — with a bounded
  // grace: a generator suspended in a long await must not hold the
  // failure path (or the busy flag) hostage until it settles.
  try{await Promise.race([iterator.return?.(),new Promise(resolve=>setTimeout(resolve,250))]);}catch{/* the turn is already over */}
 }
 if(signal.aborted)throw new Error('Conversation timed out');
 return reply;
}
