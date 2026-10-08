export function createTextChat(send:(text:string,requestId:string,signal:AbortSignal)=>Promise<{reply:string;stopped?:boolean;events?:unknown[]}>,changed:(busy:boolean,message:string)=>void){
 let controller:AbortController|undefined;
 return {
  get busy(){return !!controller;},
  cancel(){controller?.abort();},
  async submit(text:string){
   if(controller||!text.trim())return null;
   const active=new AbortController();controller=active;changed(true,'The Mayor is working on your message…');
   const timer=setTimeout(()=>active.abort(),30000);
   try{
    const result=await send(text,crypto.randomUUID(),active.signal);
    if(active.signal.aborted)throw new Error('Stopped waiting');
    if(!result.reply?.trim())throw new Error('No reply was returned. Your draft is still here.');
    controller=undefined;changed(false,'Reply received.');return result;
   }catch(error){
    controller=undefined;
    changed(false,active.signal.aborted?'Stopped waiting. Your message may have been processed. Refresh the conversation before repeating a change.':error instanceof Error?error.message:'Could not send. Your draft is still here.');return null;
   }finally{clearTimeout(timer);if(controller===active)controller=undefined;}
  },
 };
}
