export interface TextChatErrors{
 /**
  * Map an HTTP failure status to the honest status-line copy. Return undefined
  * to fall back to the error's own message. The caller knows which assistant
  * surface failed, so the copy names the right surface instead of lying
  * about what happened.
  */
 serviceDownCopy?:(status:number)=>string|undefined;
}

export function createTextChat(send:(text:string,requestId:string,signal:AbortSignal,imageIds?:string[])=>Promise<{reply:string;stopped?:boolean;events?:unknown[]}>,changed:(busy:boolean,message:string)=>void,errors?:TextChatErrors){
 let controller:AbortController|undefined;
 return {
  get busy(){return !!controller;},
  cancel(){controller?.abort();},
  async submit(text:string,imageIds?:string[]){
   if(controller||!text.trim())return null;
   const active=new AbortController();controller=active;changed(true,'The Mayor is working on your message…');
   const timer=setTimeout(()=>active.abort(),30000);
   try{
    const result=await send(text,crypto.randomUUID(),active.signal,imageIds);
    if(active.signal.aborted)throw new Error('Stopped waiting');
    if(!result.reply?.trim())throw new Error('No reply was returned. Your draft is still here.');
    controller=undefined;changed(false,'Reply received.');return result;
   }catch(error){
    controller=undefined;
    const status=(error as {status?:unknown}|null)?.status;
    let message:string;
    if(active.signal.aborted)message='Stopped waiting. Your message may have been processed. Refresh the conversation before repeating a change.';
    // 402 is the only path that may mention the Plan & usage allowance: the
    // server sends the exact allowance copy for it. Never imply quota on a
    // model/gateway failure (502).
    else if(status===402)message=error instanceof Error&&error.message?error.message:'Your shared business allowance is used up for this period. Check Plan & usage.';
    else if(typeof status==='number'){message=errors?.serviceDownCopy?.(status)??(error instanceof Error?error.message:'Could not send. Your draft is still here.');}
    else message=error instanceof Error?error.message:'Could not send. Your draft is still here.';
    changed(false,message);return null;
   }finally{clearTimeout(timer);if(controller===active)controller=undefined;}
  },
 };
}
