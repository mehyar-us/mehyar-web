/** Text chat engine (chat reenvision Slice 2): streaming turns with an
 * optimistic overlay, a mid-turn queue, and an IDLE deadline.
 *
 * What changed from the single-flight engine this replaces:
 *  - A message sent mid-turn QUEUES (pending bubble + cancel) instead of
 *    being silently dropped; it sends when the current turn ends.
 *  - The 30-second TOTAL abort wall is gone. The only client deadline is
 *    idle: no delta and no event for textChatLimits.idleMs means the
 *    stream is wedged, not slow.
 *  - Stop aborts the stream and PRESERVES the partial reply with a
 *    "Stopped" marker — it is not an error and never shows the ambiguity
 *    copy. That copy survives ONLY where the outcome is genuinely
 *    unknowable (the stream died, or the idle deadline fired, after the
 *    server accepted the message): AMBIGUOUS_TURN_COPY, used once, here.
 *  - Failures render IN FLOW (the failed item carries the line + Try
 *    again), not in the composer status line; the status line keeps the
 *    busy / "Reply received." signals it always carried.
 *  - The 402 allowance copy passes through verbatim, as before: 402 is
 *    the only path that may mention the Plan & usage allowance — a
 *    model/gateway failure (502) must never imply quota.
 */
export const AMBIGUOUS_TURN_COPY='Stopped waiting. Your message may have been processed. Refresh the conversation before repeating a change.';
export const textChatLimits={idleMs:45000};

export interface TextChatErrors{
 /**
  * Map an HTTP failure status to the honest failure copy. Return undefined
  * to fall back to the error's own message. The caller knows which assistant
  * surface failed, so the copy names the right surface instead of lying
  * about what happened.
  */
 serviceDownCopy?:(status:number)=>string|undefined;
 /** Live event sink: streaming event frames, and the whole-reply
  * fallback's events on completion, are delivered here in order. */
 onEvent?:(event:unknown)=>void;
 /** Fired whenever the renderable view changes (overlay rows, queue). */
 onView?:(view:TextChatView)=>void;
}

export interface StreamHooks{onDelta:(text:string)=>void;onEvent:(event:unknown)=>void}
export interface SendResult{reply:string;events?:unknown[]}
export type SendFn=(text:string,requestId:string,signal:AbortSignal,imageIds:string[]|undefined,stream:StreamHooks)=>Promise<SendResult>;

export interface ActiveTurn{requestId:string;text:string;imageIds?:string[];phase:'acting'|'streaming';partial:string}
export interface QueuedTurn{requestId:string;text:string;imageIds?:string[]}
export interface StoppedTurn{requestId:string;text:string;partial:string}
export interface FailedTurn{requestId:string;text:string;imageIds?:string[];partial:string;message:string;status?:number;ambiguous:boolean}
export interface TextChatView{busy:boolean;active?:ActiveTurn;stopped?:StoppedTurn;failed?:FailedTurn;queue:QueuedTurn[]}
export type TextTurnOutcome=
 |{status:'done';text:string;imageIds?:string[];result:SendResult}
 |{status:'stopped';text:string}
 |{status:'failed';text:string;failure:FailedTurn}
 |{status:'cancelled';text:string};

interface PendingEntry extends QueuedTurn{settle:(outcome:TextTurnOutcome)=>void}

export function createTextChat(send:SendFn,changed:(busy:boolean,message:string)=>void,errors?:TextChatErrors){
 let active:ActiveTurn|undefined;
 let activeEntry:PendingEntry|undefined;
 let activeController:AbortController|undefined;
 let stopped:StoppedTurn|undefined;
 let failed:FailedTurn|undefined;
 let queue:PendingEntry[]=[];
 let stopping=false;
 let idleTimer:ReturnType<typeof setTimeout>|undefined;
 // Incremented by reset(): a turn that finishes after a reset (access
 // ended, new chat) must not resurrect overlay state or re-settle.
 let generation=0;

 const view=():TextChatView=>({busy:!!active,active,stopped,failed,queue:queue.map(({requestId,text,imageIds})=>({requestId,text,imageIds}))});
 const emit=()=>errors?.onView?.(view());
 const clearIdle=()=>{if(idleTimer!==undefined){clearTimeout(idleTimer);idleTimer=undefined;}};

 function describeFailure(error:unknown,idleFired:boolean,entry:PendingEntry,partial:string):FailedTurn{
  const status=(error as {status?:unknown}|null)?.status;
  const flagged=(error as {ambiguous?:unknown}|null)?.ambiguous;
  let message:string;let ambiguous=false;
  if(idleFired||flagged===true){message=AMBIGUOUS_TURN_COPY;ambiguous=true;}
  // 402 is the only path that may mention the Plan & usage allowance: the
  // server sends the exact allowance copy for it. Never imply quota on a
  // model/gateway failure (502).
  else if(status===402)message=error instanceof Error&&error.message?error.message:'Your shared business allowance is used up for this period. Check Plan & usage.';
  else if(typeof status==='number')message=errors?.serviceDownCopy?.(status)??(error instanceof Error?error.message:'Could not send. Your draft is still here.');
  else if((error as {localCopy?:unknown}|null)?.localCopy===true&&error instanceof Error)message=error.message;
  // Anything else (a transport loss the adapter did not classify, a raw
  // fetch rejection) is genuinely unknowable from here: the server may
  // have processed the message, so the honest copy is the ambiguous one.
  else {message=AMBIGUOUS_TURN_COPY;ambiguous=true;}
  return {requestId:entry.requestId,text:entry.text,imageIds:entry.imageIds,partial,message,status:typeof status==='number'?status:undefined,ambiguous};
 }

 function drain(){
  if(active||failed)return;
  const next=queue.shift();
  if(next)run(next);
 }

 function run(entry:PendingEntry){
  const gen=generation;
  activeEntry=entry;
  active={requestId:entry.requestId,text:entry.text,imageIds:entry.imageIds,phase:'acting',partial:''};
  stopping=false;
  changed(true,'The Mayor is working on your message…');emit();
  const controller=new AbortController();activeController=controller;
  let idleFired=false;
  const armIdle=()=>{clearIdle();idleTimer=setTimeout(()=>{idleFired=true;controller.abort();},textChatLimits.idleMs);};
  armIdle();
  const hooks:StreamHooks={
   onDelta:text=>{if(gen!==generation||!active)return;active.partial+=text;active.phase='streaming';armIdle();emit();},
   onEvent:event=>{if(gen!==generation)return;armIdle();errors?.onEvent?.(event);},
  };
  void (async()=>{
   try{
    const result=await send(entry.text,entry.requestId,controller.signal,entry.imageIds,hooks);
    clearIdle();
    if(gen!==generation)return;
    if(!result.reply?.trim()&&!active?.partial)throw Object.assign(new Error('No reply was returned. Your draft is still here.'),{localCopy:true});
    // Whole-reply fallback: its events arrive with the result and are
    // delivered now, in order — the streaming path already delivered
    // its own live through the hooks.
    for(const event of result.events??[])errors?.onEvent?.(event);
    active=undefined;activeEntry=undefined;activeController=undefined;
    changed(false,'Reply received.');emit();
    entry.settle({status:'done',text:entry.text,imageIds:entry.imageIds,result});
    drain();
   }catch(error){
    clearIdle();
    if(gen!==generation)return;
    const partial=active?.partial??'';
    active=undefined;activeEntry=undefined;activeController=undefined;
    if(stopping){
     stopped={requestId:entry.requestId,text:entry.text,partial};
     changed(false,'Stopped.');emit();
     entry.settle({status:'stopped',text:entry.text});
     drain();
     return;
    }
    const failure=describeFailure(error,idleFired,entry,partial);
    failed=failure;
    changed(false,'');emit();
    entry.settle({status:'failed',text:entry.text,failure});
    // The queue PAUSES behind a failure: Try again or dismissing the
    // failed item is what releases it, so a down service never turns
    // one failure into a stack of them.
   }
  })();
 }

 return {
  get busy(){return !!active;},
  get pending(){return !!active||!!failed||queue.length>0;},
  snapshot:view,
  submit(text:string,imageIds?:string[]):Promise<TextTurnOutcome>|null{
   if(!text.trim())return null;
   stopped=undefined;
   let settle!:(outcome:TextTurnOutcome)=>void;
   const outcome=new Promise<TextTurnOutcome>(resolve=>{settle=resolve;});
   const entry:PendingEntry={requestId:crypto.randomUUID(),text,imageIds,settle};
   if(active||failed){queue.push(entry);emit();}
   else run(entry);
   return outcome;
  },
  /** Stop waiting: aborts the ACTIVE turn's stream. The partial reply
   * is preserved as a stopped item; queued messages then drain. */
  cancel(){
   if(!active)return;
   stopping=true;activeController?.abort();
  },
  cancelQueued(requestId:string){
   const index=queue.findIndex(entry=>entry.requestId===requestId);
   if(index<0)return;
   const [entry]=queue.splice(index,1);
   entry.settle({status:'cancelled',text:entry.text});
   emit();
  },
  /** Re-send the failed turn with the SAME requestId: if the original
   * actually completed server-side, the stored receipt answers instead
   * of running a second turn. */
  retryFailed():Promise<TextTurnOutcome>|null{
   if(!failed||active)return null;
   const current=failed;failed=undefined;
   let settle!:(outcome:TextTurnOutcome)=>void;
   const outcome=new Promise<TextTurnOutcome>(resolve=>{settle=resolve;});
   run({requestId:current.requestId,text:current.text,imageIds:current.imageIds,settle});
   return outcome;
  },
  dismissFailed(){
   if(!failed)return;
   failed=undefined;emit();
   drain();
  },
  /** Access ended / session torn down: drop every overlay and settle
   * every waiter as cancelled. Late completions are generation-guarded. */
  reset(){
   generation++;
   clearIdle();
   activeController?.abort();
   const wasEntry=activeEntry;
   active=undefined;activeEntry=undefined;activeController=undefined;
   stopped=undefined;failed=undefined;
   const queued=queue;queue=[];
   emit();
   if(wasEntry)wasEntry.settle({status:'cancelled',text:wasEntry.text});
   for(const entry of queued)entry.settle({status:'cancelled',text:entry.text});
  },
 };
}

/** Slice 2 client transport: read an NDJSON frame stream. Frames are
 * {type:'delta',text} | {type:'event',event} | {type:'done',reply} |
 * {type:'error',status,message}. A stream that ends WITHOUT a terminal
 * frame — after the server accepted the message — is the genuinely
 * ambiguous case and throws an error flagged `ambiguous`. */
export async function readNdjsonTurn(body:ReadableStream<Uint8Array>,hooks:StreamHooks):Promise<SendResult>{
 const reader=body.getReader();
 const decoder=new TextDecoder();
 let buffer='';
 let reply='';
 let sawDone=false;
 const handleLine=(line:string)=>{
  const trimmed=line.trim();
  if(!trimmed)return;
  const frame=JSON.parse(trimmed) as {type?:string;text?:string;event?:unknown;reply?:string;status?:number;message?:string};
  if(frame.type==='delta'){const text=frame.text??'';reply+=text;hooks.onDelta(text);}
  else if(frame.type==='event')hooks.onEvent(frame.event);
  else if(frame.type==='done'){sawDone=true;if(typeof frame.reply==='string')reply=frame.reply;}
  else if(frame.type==='error'){const err=new Error(frame.message??'Could not send. Your draft is still here.') as Error&{status?:number};err.status=frame.status;throw err;}
 };
 for(;;){
  const {done,value}=await reader.read();
  if(done)break;
  buffer+=decoder.decode(value,{stream:true});
  let index=buffer.indexOf('\n');
  while(index>=0){
   const line=buffer.slice(0,index);buffer=buffer.slice(index+1);
   handleLine(line);
   index=buffer.indexOf('\n');
  }
 }
 buffer+=decoder.decode();
 if(buffer.trim())handleLine(buffer);
 if(!sawDone)throw Object.assign(new Error('The reply stream ended early.'),{ambiguous:true});
 return {reply};
}
