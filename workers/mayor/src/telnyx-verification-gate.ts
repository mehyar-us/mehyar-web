import type {Env} from './env';
import {TelnyxKeypadGate} from './telnyx-keypad-gate';
import {startTelnyxVerification,checkTelnyxVerification} from './telnyx-verification';
/** say must resolve on playback completion. Keep this controller outside the
 * AI socket; it alone interprets the caller's opt-in and verification digits. */
export function telnyxVerificationGate(env:Env,id:string,say:(text:string)=>Promise<void>,end:()=>void,transport:typeof fetch=fetch,name='The Mayor'){
 return new TelnyxKeypadGate({say,end,
  send:()=>startTelnyxVerification(env,id,true,transport),
  check:(nonce,code)=>checkTelnyxVerification(env,id,nonce,code,transport),
 },name);
}
