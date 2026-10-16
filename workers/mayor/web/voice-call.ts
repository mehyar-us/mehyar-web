type Client={startCall():Promise<void>;endCall():void;readonly error:string|null};
const microphoneHelp='The microphone could not start. Check that a microphone is connected and allowed in your browser, then try again. You can also type below.';
// The SDK collapses missing devices and permission failures into this message.
// Do not claim the user denied permission when the cause is unavailable.
function startupMessage(message:string){
 return message==='Microphone access denied. Please allow microphone access and try again.'
  ? microphoneHelp
  : message;
}
/** Plain-language notice for the degraded voice state. Pure — no DOM — so the
 *  exact wording is unit-testable and shared by every voice start path. */
export function voiceUnavailableNotice(reason:string){
 const cause=reason&&reason.trim()?reason.trim():'voice service is not configured';
 return `Voice isn't available right now — ${cause}. Chat works normally.`;
}
/** Stall watchdog bounds. A turn spends a few seconds thinking and at most
 *  about a minute speaking (replies are token-capped); past these bounds with
 *  no status change and no transcript activity, the server side has stalled
 *  and the call is ended with an explanation instead of trapping the owner. */
const THINKING_STALL_MS=45000,SPEAKING_STALL_MS=90000;
const STUCK_MESSAGE='Voice got stuck, so I ended the call. Tap the mic to talk again — or just type below.';
/** Server listening status may precede local microphone permission/readiness. */
export function createVoiceCall(client:Client,changed:()=>void,failed:(message:string)=>void,prepare?:()=>Promise<void>){
 let starting=false,active=false,pending=false,localReady=false,serverReady=false,generation=0,timer:ReturnType<typeof setTimeout>|undefined;
 let remote='idle',stallTimer:ReturnType<typeof setTimeout>|undefined;
 const clearStall=()=>{clearTimeout(stallTimer);stallTimer=undefined;};
 const armStall=()=>{
  clearStall();
  if(!active)return;
  const limit=remote==='thinking'?THINKING_STALL_MS:remote==='speaking'?SPEAKING_STALL_MS:0;
  if(!limit)return;
  stallTimer=setTimeout(()=>{stallTimer=undefined;if(!active)return;stop();failed(STUCK_MESSAGE);},limit);
 };
 const reset=()=>{generation++;clearTimeout(timer);clearStall();remote='idle';starting=false;active=false;localReady=false;serverReady=false;changed();};
 const stop=()=>{reset();client.endCall();};
 const ready=()=>{if(starting&&localReady&&serverReady){starting=false;active=true;clearTimeout(timer);changed();armStall();}};
 return {
  get starting(){return starting;},get active(){return active;},reset,stop,
  /** A sign of life from the server (transcript or recognition activity):
   *  restarts the stall countdown for the current thinking/speaking state. */
  activity(){if(active&&(remote==='thinking'||remote==='speaking'))armStall();},
  status(status:string){
   if(status==='idle'){
    // A connection's initial idle snapshot may arrive after start_call.
    // Once acknowledged, idle means the server ended this call.
    if(active||(starting&&serverReady))stop();
    return;
   }
   remote=status;
   if(starting){serverReady=true;ready();}
   if(active)armStall();
  },
  error(message:string|null){
   if(!message)return;
   if(starting)stop();
   failed(startupMessage(message));
  },
  async start(){
   if(starting||active)return;
   // getUserMedia cannot be cancelled. Avoid overlapping SDK startups while
   // an earlier browser permission request is still settling after cancellation.
   if(pending){failed('Your browser is still finishing the previous microphone request. Dismiss its permission prompt or reload, then try again. You can type below.');return;}
   const attempt=++generation;starting=true;pending=true;changed();
   timer=setTimeout(()=>{if(attempt!==generation)return;stop();failed('Voice startup timed out. Check your microphone permission and connection, then try again or type a message.');},30000);
   try{
    if(prepare){await prepare();if(attempt!==generation)return;}
    await client.startCall();
    if(attempt!==generation)return;
    if(client.error)throw new Error(client.error);
    localReady=true;ready();
   }catch(error){
    if(attempt!==generation)return;
    const message=prepare&&error instanceof Error?error.message:client.error??microphoneHelp;
    stop();failed(startupMessage(message));
   }finally{pending=false;}
  },
 };
}
