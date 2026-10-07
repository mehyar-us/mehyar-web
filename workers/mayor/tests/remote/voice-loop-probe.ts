// Isolated synthetic voice loop. Never attach production D1, secrets or DO bindings.
import {Agent,routeAgentRequest,type Connection} from 'agents';
import {withVoice,WorkersAIFluxSTT,WorkersAITTS,type VoiceTurnContext} from '@cloudflare/voice';
import {streamText} from 'ai';
import {mayorModel} from '../../src/ai-model';
import {audioStartTranscriber} from '../../src/audio-start-transcriber';
import {voiceGreeting} from '../../src/voice-greeting';
type ProbeEnv={AI:Ai;ProbeVoice:DurableObjectNamespace<ProbeVoice>;PROBE_KEY?:string};
const Base=withVoice(Agent,{historyLimit:4,maxMessageCount:10});
export class ProbeVoice extends Base<ProbeEnv>{
 transcriber=audioStartTranscriber(new WorkersAIFluxSTT(this.env.AI,{eotThreshold:0.7,eotTimeoutMs:1500,keyterms:['Mehyar','The Mayor']}));
 tts=new WorkersAITTS(this.env.AI);
 onMessage(){} // No generic Agent RPC surface.
 async onCallStart(connection:Connection){if(this.name.startsWith('greeting-'))await this.speak(connection,voiceGreeting);}
 async onTurn(transcript:string,context:VoiceTurnContext){
  return streamText({model:mayorModel(this.env.AI),abortSignal:context.signal,maxOutputTokens:100,temperature:0,
   system:'You are The Mayor, an AI business assistant. This is a synthetic onboarding test. In one short sentence, read back the business hours the user supplied and ask for confirmation. Do not claim to save anything. No tools or business actions are available.',
   messages:[...context.messages,{role:'user',content:transcript}],
  }).textStream;
 }
}
const fixture='We are open Monday through Friday from nine in the morning until five in the afternoon.';
const pause=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
export default {async fetch(request:Request,env:ProbeEnv){
 try{return await runProbe(request,env);}catch(error){return Response.json({error:(error as Error).message},{status:502});}
}};
async function runProbe(request:Request,env:ProbeEnv){
 if(request.method!=='POST'||new URL(request.url).pathname!=='/run')return Response.json({purpose:'POST /run for a fixed synthetic speech loop. No production data or browser microphone.'});
 if(!env.PROBE_KEY||request.headers.get('x-mayor-probe-key')!==env.PROBE_KEY)return new Response('Unauthorized',{status:401});
 const start=Date.now();
 const greetingOnly=new URL(request.url).searchParams.get('greeting')==='true';
 const generated=greetingOnly?new Response(new ArrayBuffer(1280)):await (env.AI.run as any)('@cf/deepgram/aura-1',{text:fixture,speaker:'asteria',encoding:'linear16',sample_rate:16000,container:'none'},{returnRawResponse:true,signal:AbortSignal.timeout(15000)}) as Response;
 if(!generated.ok)return new Response('Fixture synthesis failed',{status:502});
 const pcm=await generated.arrayBuffer();
 if(!pcm.byteLength||pcm.byteLength>640000||pcm.byteLength%2)return new Response('Invalid fixture',{status:502});
 const routed=await routeAgentRequest(new Request(`https://probe.invalid/agents/probe-voice/${greetingOnly?'greeting-':''}${crypto.randomUUID()}`,{headers:{upgrade:'websocket'}}),env,{routingRetry:false});
 const socket=routed?.webSocket;
 if(!socket)return new Response('Voice socket unavailable',{status:502});
 socket.binaryType='arraybuffer';socket.accept();
 let ready=false,configured=false,done=false,idleAcknowledged=false,error:string|null=null,userText='',reply='',format='',metrics:Record<string,unknown>|null=null;
 let feedStart=0,lastInputAt=0,firstAudioAt:number|null=null,firstTextAt:number|null=null,audioBytes=0;
 const audio:Uint8Array[]=[];
 socket.addEventListener('message',event=>{
  if(typeof event.data==='string'){
   const message=JSON.parse(event.data);
   if(message.type==='status'&&message.status==='idle')idleAcknowledged=true;
   if(message.type==='status'&&message.status==='listening')ready=true;
   if(message.type==='audio_config'){format=message.format;configured=true;}
   if(message.type==='transcript'&&message.role==='user')userText=message.text;
   if(message.type==='transcript_delta'){firstTextAt??=Date.now();reply+=message.text;}
   if(message.type==='transcript_end')reply=message.text;
   if(message.type==='turn_metrics'){metrics=message;done=true;}
   if(message.type==='error'){error=message.message;done=true;}
  }else if(event.data instanceof ArrayBuffer){
   firstAudioAt??=Date.now();audioBytes+=event.data.byteLength;
   if(audioBytes<=1000000)audio.push(new Uint8Array(event.data));else{error='Audio capture bound exceeded';done=true;}
   if(greetingOnly&&audioBytes&&reply===voiceGreeting)done=true;
  }
 });
 socket.addEventListener('close',()=>{if(!done){error='Voice socket closed early';done=true;}});
 const startupDelayMs=new URL(request.url).searchParams.get('delay')==='12000'?12000:0;
 const cancelRestart=new URL(request.url).searchParams.get('cancelRestart')==='true';
 let cancelledStartupVerified=false;
 const deadline=Date.now()+55000;
 try{
  socket.send(JSON.stringify({type:'start_call'}));
  // Like VoiceClient, send capture frames before the server's listening ack.
  while(!configured&&!done&&Date.now()<deadline)await pause(20);
  if(!configured)throw new Error(error??'Voice configuration timed out');
  if(cancelRestart){
   idleAcknowledged=false;socket.send(JSON.stringify({type:'end_call'}));
   const cancelDeadline=Date.now()+3000;
   while(!idleAcknowledged&&!done&&Date.now()<cancelDeadline)await pause(20);
   if(!idleAcknowledged||done)throw new Error(error??'Cancellation was not acknowledged');
   // Simulate late capture frames after cancellation. They must not start STT.
   socket.send(new ArrayBuffer(1280));await pause(1000);
   if(ready||done||userText||reply||audioBytes)throw new Error('Cancelled startup produced unexpected activity');
   cancelledStartupVerified=true;configured=false;idleAcknowledged=false;
   socket.send(JSON.stringify({type:'start_call'}));
   const restartDeadline=Date.now()+3000;
   while(!configured&&!done&&Date.now()<restartDeadline)await pause(20);
   if(!configured||done)throw new Error(error??'Restart was not configured');
  }
  await pause(startupDelayMs);
  feedStart=Date.now();
  for(let offset=0;offset<pcm.byteLength&&!done;offset+=1280){
   socket.send(pcm.slice(offset,Math.min(offset+1280,pcm.byteLength)));lastInputAt=Date.now();
   await pause(Math.max(0,feedStart+(offset+1280)/32-Date.now()));
  }
  while(!done&&Date.now()<deadline){socket.send(new ArrayBuffer(1280));await pause(40);}
  if(!done)error='Voice response timed out';
  const bytes=new Uint8Array(audioBytes);let offset=0;
  for(const chunk of audio){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
  return Response.json({fixture:greetingOnly?'Silent PCM frames; no spoken input':fixture,greetingOnly,transcript:userText,reply,format,audioBytes,audioBase64:btoa(binary),metrics,error,serverListening:ready,startupDelayMs,cancelledStartupVerified,
   fixtureDurationMs:pcm.byteLength/32,lastInputFrameToFirstTextMs:firstTextAt===null?null:firstTextAt-lastInputAt,
   lastInputFrameToFirstAudioMs:firstAudioAt===null?null:firstAudioAt-lastInputAt,totalMs:Date.now()-start,
   limitation:'Synthetic remote SDK speech loop with the production model/provider configuration. Excludes production authentication, business tools, browser capture, acoustic speech end, network to the user and audible playback.'
  },{status:error||!audioBytes||!reply?502:200});
 }catch(cause){return Response.json({error:(cause as Error).message},{status:502});}
 finally{try{socket.send(JSON.stringify({type:'end_call'}));socket.close();}catch{}}
}
