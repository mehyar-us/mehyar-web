import type {Transcriber,TranscriberSession,TranscriberSessionOptions} from '@cloudflare/voice';

/** Open STT on the first PCM frame, not while browser audio permission is pending. */
export function audioStartTranscriber(provider:Transcriber):Transcriber {
 return {createSession(options:TranscriberSessionOptions={}){
  let inner:TranscriberSession|undefined,closed=false,connecting=false,ready=false;
  let chunks:ArrayBuffer[]=[],bytes=0;
  let resolve!:()=>void,reject!:(error:Error)=>void;
  const readiness=new Promise<void>((yes,no)=>{resolve=yes;reject=no;});
  // Cleanup may precede the SDK's waitUntilReady call.
  void readiness.catch(()=>{});
  let timer:ReturnType<typeof setTimeout>|null=null;
  const cleanup=()=>{clearTimeout(timer);chunks=[];bytes=0;try{inner?.close();}catch{}};
  const fail=()=>{
   if(closed)return;closed=true;
   const error=new Error('Speech recognition audio startup failed');
   cleanup();reject(error);options.onFatalError?.(error);
  };
  timer=setTimeout(fail,25000);
  const begin=async()=>{
   connecting=true;clearTimeout(timer);timer=setTimeout(fail,5000);
   try{
    inner=provider.createSession({
     language:options.language,
     onInterim:text=>{if(!closed)options.onInterim?.(text);},
     onSpeechStart:text=>{if(!closed)options.onSpeechStart?.(text);},
     onUtterance:text=>{if(!closed)options.onUtterance?.(text);},
     onFatalError:fail,
    });
    // A provider is allowed to fail synchronously during createSession.
    if(closed){inner.close();return;}
    await inner.waitUntilReady?.();
    if(closed)return;
    for(const chunk of chunks){if(closed)return;inner.feed(chunk);}
    if(closed)return;
    chunks=[];bytes=0;ready=true;clearTimeout(timer);resolve();
   }catch{fail();}
  };
  return {
   waitUntilReady:()=>readiness,
   feed(chunk){
    if(closed||chunk.byteLength===0)return;
    // PCM16 frames; cap each frame and total startup audio to five seconds.
    if(chunk.byteLength%2||chunk.byteLength>160000){fail();return;}
    if(ready){try{inner!.feed(chunk);}catch{fail();}return;}
    if(bytes+chunk.byteLength>160000||chunks.length>=512){fail();return;}
    chunks.push(chunk.slice(0));bytes+=chunk.byteLength;
    if(!connecting)void begin();
   },
   updateAgentContext(text){if(!closed&&ready){try{inner?.updateAgentContext?.(text);}catch{fail();}}},
   close(){if(closed)return;closed=true;cleanup();reject(new Error('Speech recognition startup cancelled'));},
  };
 }};
}
