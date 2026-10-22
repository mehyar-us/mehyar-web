type Client={startCall():Promise<void>;endCall():void;readonly error:string|null};
const microphoneHelp='The microphone could not start. Check that a microphone is connected and allowed in your browser, then try again. You can also type below.';
// The SDK collapses missing devices and permission failures into this message.
// Do not claim the user denied permission when the cause is unavailable.
function startupMessage(message:string){
 return message==='Microphone access denied. Please allow microphone access and try again.'
  ? microphoneHelp
  : message;
}
/** Server listening status may precede local microphone permission/readiness. */
export function createVoiceCall(client:Client,changed:()=>void,failed:(message:string)=>void,prepare?:()=>Promise<void>){
 let starting=false,active=false,pending=false,localReady=false,serverReady=false,generation=0,timer:ReturnType<typeof setTimeout>|undefined;
 const reset=()=>{generation++;clearTimeout(timer);starting=false;active=false;localReady=false;serverReady=false;changed();};
 const stop=()=>{reset();client.endCall();};
 const ready=()=>{if(starting&&localReady&&serverReady){starting=false;active=true;clearTimeout(timer);changed();}};
 return {
  get starting(){return starting;},get active(){return active;},reset,stop,
  status(status:string){
   if(status==='idle'){
    // A connection's initial idle snapshot may arrive after start_call.
    // Once acknowledged, idle means the server ended this call.
    if(active||(starting&&serverReady))stop();
   }else if(starting){serverReady=true;ready();}
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
