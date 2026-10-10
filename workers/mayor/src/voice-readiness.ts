import type {Env} from './env';
import {json} from './http';

/** Voice transport the browser voice path would use, as seen from this worker. */
export type VoiceTransport='gateway'|'direct'|'none';

export interface VoiceReadiness{
 available:boolean;
 /** Plain-language reason when unavailable; null when available. Never a secret. */
 reason:string|null;
 transport:VoiceTransport;
}

const NOT_CONFIGURED='voice service is not configured';

/**
 * Capability probe for the browser voice paths (PWA tap-to-talk and the
 * standalone /assessment-call/ page). Pure and conservative: the shared AI
 * Gateway wins when its credentials are present; otherwise the direct Workers
 * AI binding is the honest fallback (production currently has no
 * AI_GATEWAY_* secrets set, so all live traffic uses it); otherwise voice is
 * reported unavailable with a plain-language reason. Never claims voice
 * works when a dependency cannot be verified.
 */
export function voiceReadiness(env:Pick<Env,'AI'|'AI_GATEWAY_ACCOUNT_ID'|'AI_GATEWAY_TOKEN'>):VoiceReadiness{
 if(env.AI_GATEWAY_TOKEN?.trim()&&env.AI_GATEWAY_ACCOUNT_ID?.trim())
  return {available:true,reason:null,transport:'gateway'};
 if(env.AI)return {available:true,reason:null,transport:'direct'};
 return {available:false,reason:NOT_CONFIGURED,transport:'none'};
}

/**
 * The GET /api/voice/readiness response. PUBLIC capability probe: no auth,
 * no user data, reveals no secrets. CORS-open so the standalone
 * /assessment-call/ page (served from mehyar-web) can read it; json() sets
 * cache-control: no-store.
 */
export function voiceReadinessResponse(env:Pick<Env,'AI'|'AI_GATEWAY_ACCOUNT_ID'|'AI_GATEWAY_TOKEN'>):Response{
 const response=json(voiceReadiness(env));
 response.headers.set('access-control-allow-origin','*');
 return response;
}
