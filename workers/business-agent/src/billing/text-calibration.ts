import {z} from 'zod';
import {HttpError} from '../http';
import {estimateStandardText} from './text-meter';
import {parseTextUsageReceipt} from './text-receipt';

// Scoped, expiring development calibration; see docs/implementation/ai-binding-probe.md.
// Returned provider usage must still match before any larger reservation settles.
const PROFILE={id:'workers-ai-gpt-oss-dev-2026-09-16-v1',gateway:'mehyar-business-agent-dev',
  validFrom:Date.parse('2026-09-16T21:37:47Z'),expiresAt:Date.parse('2026-10-16T21:37:47Z'),inputOverhead:57};
const supported=z.object({messages:z.tuple([
  z.object({role:z.literal('system'),content:z.string()}).strict(),
  z.object({role:z.literal('user'),content:z.string()}).strict(),
]),max_tokens:z.number().int().min(1).max(2000)}).strict();
export function calibratedTextReservation(input:unknown,gateway:string|undefined,now=Date.now()){
  const request=supported.safeParse(input);
  if(!request.success||gateway!==PROFILE.gateway||!Number.isFinite(now)||now<PROFILE.validFrom||now>=PROFILE.expiresAt)
    throw new HttpError(503,'text_calibration_unavailable','This request needs current model calibration before larger-work billing.');
  if(request.data.messages.reduce((sum,m)=>sum+new TextEncoder().encode(m.content).length,0)>64000)
    throw new HttpError(422,'text_calibration_size','This request exceeds the calibrated workload bound.');
  const estimate=estimateStandardText(request.data),inputTokens=estimate.inputTokens+PROFILE.inputOverhead;
  return {profile:PROFILE.id,inputTokens,outputTokenLimit:request.data.max_tokens,
    credits:Math.max(1,Math.ceil(inputTokens/12000),Math.ceil(request.data.max_tokens/2000)),expiresAt:PROFILE.expiresAt};
}
export function verifyCalibratedTextReceipt(input:unknown,gateway:string|undefined,response:unknown,now=Date.now()){
  const reservation=calibratedTextReservation(input,gateway,now),receipt=parseTextUsageReceipt(response);
  if(receipt.state!=='reported'||receipt.inputTokens!==reservation.inputTokens||receipt.outputTokens>reservation.outputTokenLimit)
    throw new HttpError(502,'text_calibration_mismatch','Provider usage did not match the reserved analysis. Service review is required.');
  return reservation;
}
