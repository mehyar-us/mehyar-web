// Remote-preview-only synthetic diagnostic. No customer audio, credentials or D1.
import {WorkersAIFluxSTT} from '@cloudflare/voice';
const pause=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
export default {async fetch(request:Request,env:{AI:Ai}){
 const url=new URL(request.url),mode=url.searchParams.get('mode');
 if(request.method!=='POST'||url.pathname!=='/run'||!['immediate','delayed','silence'].includes(mode??''))
  return new Response('POST /run?mode=immediate, delayed or silence',{status:400});
 const generated=await (env.AI.run as any)('@cf/deepgram/aura-1',{
  text:'We are open Monday through Friday from nine until five.',speaker:'asteria',encoding:'linear16',sample_rate:16000,container:'none',
 },{returnRawResponse:true,signal:AbortSignal.timeout(15000)}) as Response;
 if(!generated.ok)return new Response('Fixture generation failed',{status:502});
 const pcm=await generated.arrayBuffer();
 if(!pcm.byteLength||pcm.byteLength>640000||pcm.byteLength%2)return new Response('Invalid fixture',{status:502});
 const started=Date.now();let close:unknown=null,providerError:unknown=null,fatal=false,transcript='',frames=0;
 const inspectedAI={run:async(...args:any[])=>{
  const response=await (env.AI.run as any)(...args);
  response.webSocket?.addEventListener('close',(event:CloseEvent)=>{
   close={code:event.code,wasClean:event.wasClean,atMs:Date.now()-started};
  });
  response.webSocket?.addEventListener('message',(event:MessageEvent)=>{
   if(typeof event.data!=='string')return;
   try{const value=JSON.parse(event.data);if(value.type==='Error')providerError={type:'Error',code:typeof value.code==='string'?value.code.slice(0,80):null};}catch{}
  });
  return response;
 }} as unknown as Ai;
 const session=new WorkersAIFluxSTT(inspectedAI,{eotThreshold:0.7,eotTimeoutMs:1500,keyterms:['Mehyar','The Mayor']}).createSession({
  onUtterance:text=>{transcript=text;},onFatalError:()=>{fatal=true;},
 });
 let timer:ReturnType<typeof setTimeout>|null=null;
 try{
  await Promise.race([session.waitUntilReady!(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Readiness timeout')),10000);})]);
  clearTimeout(timer);const readyMs=Date.now()-started;
  const delayUntil=Date.now()+(mode==='immediate'?0:12000);
  while(Date.now()<delayUntil&&!fatal){if(mode==='silence'){session.feed(new ArrayBuffer(1280));frames++;}await pause(40);}
  const feedStarted=Date.now();
  for(let offset=0;offset<pcm.byteLength&&!fatal;offset+=1280){
   session.feed(pcm.slice(offset,Math.min(offset+1280,pcm.byteLength)));frames++;
   await pause(Math.max(0,feedStarted+(offset+1280)/32-Date.now()));
  }
  const deadline=Date.now()+5000;
  while(!transcript&&!fatal&&Date.now()<deadline){session.feed(new ArrayBuffer(1280));frames++;await pause(40);}
  return Response.json({mode,readyMs,totalMs:Date.now()-started,frames,transcript,fatal,close,providerError,
   limitation:'Synthetic provider startup only; does not establish browser microphone readiness or acoustic latency.'});
 }catch{return Response.json({mode,error:'Startup failed',fatal,close,providerError},{status:502});}
 finally{clearTimeout(timer);session.close();}
}};
