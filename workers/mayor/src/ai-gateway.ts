import type {Env} from './env';

/**
 * Shared AI Gateway client. Every model call from every business routes
 * through the `mayor-businesses` gateway, which provides:
 * - Response caching (1h TTL) — repeated business queries don't re-bill.
 * - Automatic fallbacks — configured in the gateway, no code changes.
 * - Per-tenant rate limits — one business can't burn the AI budget.
 * - Unified observability — cost and latency per business in one dashboard.
 *
 * When the gateway token isn't configured, callers fall back to the direct
 * Workers AI binding. The gateway is the primary path; the binding is the
 * safety net, not the other way around.
 */

type GatewayEnv=Pick<Env,'AI_GATEWAY_ACCOUNT_ID'|'AI_GATEWAY_ID'|'AI_GATEWAY_TOKEN'>;

function gatewayBase(env:GatewayEnv){
 const account=env.AI_GATEWAY_ACCOUNT_ID, gateway=env.AI_GATEWAY_ID||'mayor-businesses', token=env.AI_GATEWAY_TOKEN;
 if(!account||!token)throw new Error('ai_gateway_not_configured');
 return {base:`https://gateway.ai.cloudflare.com/v1/${account}/${gateway}/workers-ai`,token};
}

/** Workers AI-compatible run() that goes through the shared gateway. Mirrors Env['AI']['run']. */
export function gatewayRun(env:GatewayEnv&Pick<Env,'AI'>){
 const direct=env.AI.run.bind(env.AI);
 return async(model:string,input:unknown,options?:{stream?:boolean;signal?:AbortSignal}):Promise<unknown>=>{
  let gw:{base:string;token:string};
  try{gw=gatewayBase(env);}catch{return direct(model,input as any,options as any);}
  const url=`${gw.base}/${model}`;
  // P1 fix: the caller's abort signal (e.g. hung-up voice call) must reach the
  // gateway fetch, combined with the 60s timeout — never dropped.
  const signal=options?.signal?AbortSignal.any([options.signal,AbortSignal.timeout(60000)]):AbortSignal.timeout(60000);
  let response:Response;
  try{
   response=await fetch(url,{method:'POST',
    headers:{'authorization':`Bearer ${gw.token}`,'content-type':'application/json'},
    body:JSON.stringify(input??{}),signal});
  }catch(error){
   // Network error or caller abort — fall back to the direct binding, unless
   // the caller aborted (then propagate the abort, don't burn more work).
   if(error instanceof DOMException&&error.name==='AbortError')throw error;
   return direct(model,input as any,options as any);
  }
  if(!response.ok){
   // P1 fix: fall back ONLY on 5xx (gateway/provider fault). 429/401/403 and
   // other 4xx must surface — silently falling back would defeat per-tenant
   // rate limits and hide auth misconfiguration.
   try{await response.body?.cancel();}catch{}
   if(response.status>=500)return direct(model,input as any,options as any);
   throw new Error(`ai_gateway_error_${response.status}`);
  }
  if(options?.stream&&response.body){
   return response.body as ReadableStream<Uint8Array>;
  }
  try{return await response.json();}catch{
   return direct(model,input as any,options as any);
  }
 };
}
