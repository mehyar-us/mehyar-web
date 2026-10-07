// Isolated remote provider check. No customer data, D1, auth secrets or phone calls.
import {WorkersAIFluxSTT} from '@cloudflare/voice';
const samples=[
 {text:'We are open Monday through Friday from nine in the morning until five in the afternoon.',terms:[/monday/i,/friday/i,/nine|9/i,/five|5/i]},
 {text:'Actually, change Tuesday. We open at ten in the morning on Tuesdays.',terms:[/tuesday/i,/ten|10/i]},
 {text:'Our appointments last thirty minutes, and we are in the New York time zone.',terms:[/thirty|30/i,/minutes/i,/new york/i]},
];
const pause=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
export default {async fetch(request:Request,env:{AI:Ai}){
 const url=new URL(request.url);
 if(request.method!=='POST'||url.pathname!=='/run')return Response.json({purpose:'Synthetic Aura-to-Flux speech check; POST /run?sample=0, 1 or 2. No production data.'});
 const index=Number(url.searchParams.get('sample')??'0'),sample=samples[index];
 if(!Number.isInteger(index)||!sample)return new Response('Unknown sample',{status:400});
 const begun=Date.now();
 const response=await (env.AI.run as any)('@cf/deepgram/aura-1',{
  text:sample.text,speaker:'asteria',encoding:'linear16',sample_rate:16000,container:'none',
 },{returnRawResponse:true,signal:AbortSignal.timeout(15000)}) as Response;
 if(!response.ok)return Response.json({stage:'fixture_generation',status:response.status},{status:502});
 const pcm=await response.arrayBuffer(),fixtureGenerationMs=Date.now()-begun;
 if(pcm.byteLength===0||pcm.byteLength>640000||pcm.byteLength%2)return new Response('Invalid fixture audio',{status:502});
 let sttUpgradeStatus:number|null=null,sttUpgradeError:string|null=null;
 const inspectedAI={run:async(...args:any[])=>{const result=await (env.AI.run as any)(...args);if(args[0]==='@cf/deepgram/flux'&&!result.webSocket){sttUpgradeStatus=result.status??null;sttUpgradeError=result instanceof Response?(await result.clone().text()).slice(0,1000):'No WebSocket response';}return result;}} as unknown as Ai;
 let transcript='',fatal:string|undefined,firstInterimAt:number|null=null,finalAt:number|null=null,feedStarted=0,lastAudioAt:number|null=null;
 const session=new WorkersAIFluxSTT(inspectedAI,{eotThreshold:0.7,eotTimeoutMs:1500,keyterms:['Mehyar','The Mayor']}).createSession({
  onInterim:()=>{firstInterimAt??=Date.now();},
  onUtterance:text=>{if(!transcript){transcript=text;finalAt=Date.now();}},
  onFatalError:error=>{fatal=error.message;},
 });
 let readinessTimer:ReturnType<typeof setTimeout>|null=null;
 try{
  const connectionStarted=Date.now();
  await Promise.race([session.waitUntilReady!(),new Promise((_,reject)=>{readinessTimer=setTimeout(()=>reject(new Error('STT readiness timeout')),10000);})]);
  clearTimeout(readinessTimer);
  const sttConnectMs=Date.now()-connectionStarted;feedStarted=Date.now();
  // 40ms frames at 16kHz mono PCM16, paced against a fixed clock to limit drift.
  for(let offset=0;offset<pcm.byteLength&&!fatal;offset+=1280){
   session.feed(pcm.slice(offset,Math.min(offset+1280,pcm.byteLength)));lastAudioAt=Date.now();
   await pause(Math.max(0,feedStarted+(offset+1280)/32-Date.now()));
  }
  const deadline=Date.now()+8000;
  while(!transcript&&!fatal&&Date.now()<deadline){session.feed(new ArrayBuffer(1280));await pause(40);}
  return Response.json({sample:index,expected:sample.text,transcript,requiredTermsRecognized:sample.terms.every(term=>term.test(transcript)),
   fixtureBytes:pcm.byteLength,fixtureDurationMs:pcm.byteLength/32,fixtureGenerationMs,sttConnectMs,
   firstInterimFromFeedMs:firstInterimAt===null?null:firstInterimAt-feedStarted,
   finalFromLastAudioFrameMs:finalAt===null||lastAudioAt===null?null:finalAt-lastAudioAt,
   totalMs:Date.now()-begun,sttUpgradeStatus,sttUpgradeError,error:fatal??(!transcript?'No finalized utterance within timeout':null),
   limitation:'Synthetic server-side provider check; excludes browser microphone, acoustic speech end, user network and audible playback. Not an end-to-end latency benchmark.'
  },{status:fatal||!transcript?502:200});
 }catch(error){return Response.json({sample:index,error:(error as Error).message,sttUpgradeStatus,sttUpgradeError,totalMs:Date.now()-begun},{status:502});}
 finally{clearTimeout(readinessTimer);session.close();}
}};
