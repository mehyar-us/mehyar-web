import type {TelnyxCallGate} from './telnyx-keypad-gate';
import type {Env} from './env';
import {TelnyxVoiceBridge} from './telnyx-voice-bridge';
import {requireTelnyxStreamAccess} from './telnyx-stream-access';
import {watchVoiceAccess} from './voice-access';

/** Internal transport wiring. The caller consumes the single-use stream grant
 * and accepts both sockets first. The agent must independently authorize its
 * caller principal; this bridge never grants appointment permissions. */
export async function attachTelnyxStream(env:Env,admissionId:string,provider:WebSocket,agent:WebSocket,gate?:TelnyxCallGate,onClosed:()=>void=()=>{}){
 let binding;
 try{binding=await requireTelnyxStreamAccess(env,admissionId);}catch(error){
  for(const socket of [provider,agent])try{socket.close(1008,'Call unavailable');}catch{}
  throw error;
 }
 agent.binaryType='arraybuffer';
 let stop=()=>{};
 const providerMessage=(event:MessageEvent)=>bridge.fromProvider(event.data);
 const agentMessage=(event:MessageEvent)=>bridge.fromAgent(event.data);
 const ended=()=>bridge.close();
 const bridge=new TelnyxVoiceBridge(binding,provider,agent,()=>{
  stop();onClosed();
  provider.removeEventListener('message',providerMessage);
  agent.removeEventListener('message',agentMessage);
  for(const socket of [provider,agent]){
   socket.removeEventListener('close',ended);socket.removeEventListener('error',ended);
  }
 },gate);
 provider.addEventListener('message',providerMessage);
 agent.addEventListener('message',agentMessage);
 for(const socket of [provider,agent]){socket.addEventListener('close',ended);socket.addEventListener('error',ended);}
 // Bounded checks close idle sockets after hangup, disconnect, permission loss,
 // command failure or maximum call duration. No overlapping DB reads.
 stop=watchVoiceAccess(()=>requireTelnyxStreamAccess(env,admissionId),ended,1000);
 return bridge;
}
