import type {TelnyxCallGate} from './telnyx-keypad-gate';
import {TelnyxMediaSession,type TelnyxMediaBinding} from './telnyx-media';

type Socket={readonly readyState:number;send(data:string|ArrayBuffer):void;close(code?:number,reason?:string):void};
/** Both sockets must already be authenticated and accepted by the route. The
 * agent socket must use binaryType=arraybuffer. No account data is sent as marks.
 * Caller owns socket listeners and must call close on either close/error event. */
export class TelnyxVoiceBridge{
 private protocol:TelnyxMediaSession;
 private started=false;
 private agentStarted=false;
 private configured=false;
 private ready=false;
 private ended=false;
 private gated=false;
 private pending:ArrayBuffer[]=[];
 private pendingBytes=0;
 private timer:ReturnType<typeof setTimeout>;
 private prompt?:{name:string;resolve:()=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>};
 constructor(binding:TelnyxMediaBinding,private provider:Socket,private agent:Socket,private onClosed:()=>void=()=>{},private gate?:TelnyxCallGate){
  this.protocol=new TelnyxMediaSession(binding);
  this.timer=setTimeout(()=>this.close(),10000);
 }
 fromProvider(raw:unknown){
  if(this.ended)return;
  try{
   const event=this.protocol.receive(raw);
   if(event.kind==='start'){
    this.started=true;
    if(this.gate){clearTimeout(this.timer);this.gate.start(()=>this.startAgent());}else this.startAgent();
   }else if(event.kind==='mark'){
    if(this.prompt?.name===event.name){const pending=this.prompt;this.prompt=undefined;clearTimeout(pending.timer);pending.resolve();}
   }else if(event.kind==='dtmf'){
    if(!this.agentStarted)this.gate?.digit(event.digit);
   }else if(event.kind==='audio'){
    if(!this.agentStarted)return;
    if(this.ready)this.send(this.agent,event.pcm);
    else{
     this.pendingBytes+=event.pcm.byteLength;
     if(this.pendingBytes>32000)throw new Error('startup_audio_overflow');
     this.pending.push(event.pcm);
    }
   }else if(event.kind==='stop')this.close();
   // DTMF never becomes model text or an identity claim. A separate verified
   // caller flow must handle it before the customer voice agent is admitted.
  }catch{this.close();}
 }
 fromAgent(raw:unknown){
  if(this.ended||!this.agentStarted)return;
  try{
   if(raw instanceof ArrayBuffer){
    if(!this.started||!this.configured||!this.ready||raw.byteLength%2||raw.byteLength>320000)throw new Error('invalid_agent_audio');
    if(this.gated)return;
    // 20 ms chunks preserve sample order and bound individual provider frames.
    for(let offset=0;offset<raw.byteLength;offset+=640)this.send(this.provider,this.protocol.audio(raw.slice(offset,offset+640)));
    return;
   }
   if(typeof raw!=='string'||raw.length>65536)throw new Error('invalid_agent_frame');
   const message=JSON.parse(raw);
   if(!message||typeof message!=='object')throw new Error('invalid_agent_frame');
   if(message.type==='audio_config'){
    if(!this.started||message.format!=='pcm16'||message.sampleRate!==16000)throw new Error('unsupported_agent_audio');
    this.configured=true;
   }else if(message.type==='playback_interrupt'){
    if(this.started){this.gated=true;this.send(this.provider,this.protocol.clear());}
   }else if(message.type==='error')this.close();
   else if(message.type==='status'){
    if(message.status==='idle'){if(this.ready)this.close();return;}
    if(['listening','thinking','speaking'].includes(message.status)){
     if(!this.started||!this.configured)throw new Error('agent_not_configured');
     this.ready=true;this.gated=false;clearTimeout(this.timer);
     for(const audio of this.pending)this.send(this.agent,audio);
     this.pending=[];this.pendingBytes=0;
    }
   }
   // Transcripts, diagnostics, tool output and internal errors stay internal.
  }catch{this.close();}
 }
 /** Static verification prompts only, before AI startup. A matching provider
  * mark is required; duration estimates are not treated as playback completion. */
 playPrompt(pcm:ArrayBuffer):Promise<void>{
  if(this.ended||!this.started||this.agentStarted||this.prompt||pcm.byteLength===0||pcm.byteLength%2||pcm.byteLength>960000)return Promise.reject(new Error('prompt_unavailable'));
  return new Promise<void>((resolve,reject)=>{
   const name=crypto.randomUUID();
   this.prompt={name,resolve,reject,timer:setTimeout(()=>this.close(),45000)};
   try{
    for(let offset=0;offset<pcm.byteLength;offset+=640)this.send(this.provider,this.protocol.audio(pcm.slice(offset,offset+640)));
    this.send(this.provider,JSON.stringify({event:'mark',mark:{name}}));
   }catch{this.close();}
  });
 }
 private startAgent(){
  if(this.ended||this.agentStarted)return;this.agentStarted=true;clearTimeout(this.timer);
  this.timer=setTimeout(()=>this.close(),10000);
  try{this.send(this.agent,JSON.stringify({type:'start_call'}));}catch{this.close();}
 }
 private send(socket:Socket,data:string|ArrayBuffer){if(socket.readyState!==1)throw new Error('socket_closed');socket.send(data);}
 close(){
  if(this.ended)return;this.ended=true;clearTimeout(this.timer);this.pending=[];this.pendingBytes=0;
  if(this.prompt){const pending=this.prompt;this.prompt=undefined;clearTimeout(pending.timer);pending.reject(new Error('prompt_interrupted'));}
  try{this.gate?.close();this.onClosed();}catch{/* Cleanup must not prevent socket closure. */}
  try{if(this.started)this.send(this.provider,this.protocol.clear());}catch{/* Stream may already be stopped. */}
  try{if(this.agentStarted)this.send(this.agent,JSON.stringify({type:'end_call'}));}catch{/* Peer may already be closed. */}
  for(const socket of [this.provider,this.agent])try{socket.close(1000,'Call ended');}catch{/* Idempotent cleanup. */}
 }
}
