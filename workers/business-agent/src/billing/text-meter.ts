import {encodeChatGenerator,setMergeCacheSize} from 'gpt-tokenizer/model/gpt-oss-120b';
import {z} from 'zod';
import {HttpError} from '../http';

// Shared tokenizer vocabulary is public; do not retain private merge-cache text
// across business Agent instances in the same isolate.
setMergeCacheSize(0);
const requestSchema=z.object({messages:z.array(z.object({role:z.enum(['system','user','assistant']),content:z.string()}).strict()).min(1).max(32),
  max_tokens:z.number().int().min(1).max(64000)}).strict();

/** Local Harmony estimate, not a provider usage receipt. Cloudflare may apply
 * its own template; live comparison is required before larger-job billing. */
export function estimateStandardText(input:unknown){
  const request=requestSchema.parse(input);
  if(new TextEncoder().encode(JSON.stringify(request)).length>128000)throw new HttpError(422,'text_meter_limit','The text request exceeds the metering limit.');
  let inputTokens=0;
  for(const part of encodeChatGenerator(request.messages,undefined,{allowedSpecial:new Set(),disallowedSpecial:new Set()}))inputTokens+=part.length;
  if(inputTokens+request.max_tokens>128000)throw new HttpError(422,'text_context_limit','The request exceeds the model context limit.');
  return {version:1 as const,model:'@cf/openai/gpt-oss-120b' as const,tokenizer:'gpt-tokenizer@4.0.0/o200k_harmony' as const,
    basis:'local_harmony_estimate' as const,inputTokens,outputTokenLimit:request.max_tokens,
    estimatedCredits:Math.max(1,Math.ceil(inputTokens/12000),Math.ceil(request.max_tokens/2000)),
    providerValidated:false as const};
}
