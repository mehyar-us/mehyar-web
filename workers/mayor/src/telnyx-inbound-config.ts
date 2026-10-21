import {z} from 'zod';
/** Server-controlled inbound-call settings, shared by API-key and OAuth envelopes.
 * Mode 'test' (or absent — envelopes sealed before live mode existed) admits only
 * the designated testCaller. Mode 'live' admits any caller to the tenant's selected
 * number. Every other check (webhook signature, connection revision, provider-side
 * binding, recording consent) applies identically in both modes. */
export const telnyxInboundSchema=z.object({publicKey:z.string().regex(/^[A-Za-z0-9+/]{43}=$/),applicationId:z.string().regex(/^\d{1,64}$/),testCaller:z.string().regex(/^\+[1-9]\d{6,14}$/).optional(),mode:z.enum(['test','live']).optional(),verifyProfileId:z.uuid().optional()}).strict();
export type TelnyxInbound=z.infer<typeof telnyxInboundSchema>;
/** Fail-closed caller gate: live mode admits any caller; anything else requires
 * the designated test caller (a missing testCaller admits nobody). */
export function telnyxCallerAllowed(inbound:TelnyxInbound,from:string){
 return inbound.mode==='live'||(typeof inbound.testCaller==='string'&&inbound.testCaller===from);
}
