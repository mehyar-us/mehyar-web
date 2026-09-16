import {z} from 'zod';
import {ConnectorError,type Provider} from './types';
export type MailSnapshot = {provider:Provider;id:string;content:Record<string,unknown>};
const id=z.string().min(1).max(2048);
const google=z.object({id,threadId:id,payload:z.object({headers:z.array(z.object({name:z.string(),value:z.string()})).optional()}).passthrough()}).passthrough();
const microsoft=z.object({id,conversationId:id,body:z.object({contentType:z.enum(['text','html']),content:z.string()})}).passthrough();
/** Bounded, untrusted provider content. Never render HTML or follow embedded URLs. */
export function mailSnapshot(provider:Provider,value:unknown,expectedId:string):MailSnapshot {
  const parsed=(provider==='google'?google:microsoft).safeParse(value);
  if(!parsed.success||parsed.data.id!==expectedId||new TextEncoder().encode(JSON.stringify(parsed.data)).length>128000)
    throw new ConnectorError('invalid_response',`${provider}.mail.snapshot`);
  return {provider,id:expectedId,content:parsed.data};
}
