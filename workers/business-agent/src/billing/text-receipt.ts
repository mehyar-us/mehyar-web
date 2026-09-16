import {z} from 'zod';
const count=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const usageSchema=z.object({prompt_tokens:count,completion_tokens:count,total_tokens:count})
  .refine(value=>Number.isSafeInteger(value.prompt_tokens+value.completion_tokens)&&value.total_tokens===value.prompt_tokens+value.completion_tokens);

/** Only the provider envelope's usage is inspected. Model text and extra usage
 * fields are not retained. Missing and malformed counters never mean zero. */
export function parseTextUsageReceipt(response:unknown){
  if(!response||typeof response!=='object'||!Object.hasOwn(response,'usage')||(response as {usage?:unknown}).usage==null)
    return {state:'missing' as const};
  const parsed=usageSchema.safeParse((response as {usage:unknown}).usage);
  if(!parsed.success)return {state:'invalid' as const};
  return {state:'reported' as const,inputTokens:parsed.data.prompt_tokens,outputTokens:parsed.data.completion_tokens,totalTokens:parsed.data.total_tokens};
}
