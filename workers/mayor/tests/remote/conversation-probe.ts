// Synthetic conversation, no D1, credentials, calendars or phone actions.
import {streamText,tool,stepCountIs} from 'ai';
import {z} from 'zod';
import {mayorModel} from '../../src/ai-model';
import confirmationProbe from './confirmation-probe';
import availabilityProbe from './availability-probe';
const history=[{role:'user' as const,content:'Save the name Example Agency and description Business consulting.'},{role:'assistant' as const,content:'Please verify name Example Agency and description Business consulting. Say yes to save.'},{role:'user' as const,content:'Yes'},{role:'assistant' as const,content:'Saved. What else should I know?'}];
export default {async fetch(request:Request,env:{AI:Ai}){
 if(new URL(request.url).pathname==='/confirmation')return confirmationProbe.fetch(request,env);
 if(new URL(request.url).pathname==='/availability')return availabilityProbe.fetch(request,env);
 const contextual=new URL(request.url).searchParams.get('contextual')==='1';
 const scout=new URL(request.url).searchParams.get('scout')==='1';
 const qwen=new URL(request.url).searchParams.get('qwen')==='1';
 let wire:Promise<string>|undefined;
 const binding={run:async(model:unknown,input:unknown,options:unknown)=>{
  const output=await (env.AI.run as any)(qwen?'@cf/qwen/qwen3-30b-a3b-fp8':scout?'@cf/meta/llama-4-scout-17b-16e-instruct':'@cf/meta/llama-3.3-70b-instruct-fp8-fast',qwen?{...(input as object),chat_template_kwargs:{enable_thinking:false}}:input,options);
  if(output instanceof ReadableStream){const [inspect,consume]=output.tee();wire=new Response(inspect).text();return consume;}return output;
 }} as Ai;
 const started=Date.now();let firstTextMs:number|null=null;const calls:string[]=[];
 const result=streamText({model:mayorModel(binding),temperature:0,maxOutputTokens:180,stopWhen:stepCountIs(2),
  system:'You are an AI business assistant. Answer the latest user request in one sentence. Never guess missing details. Only propose changes when the latest user asks to add or correct facts. Saved profile: {"name":"Example Agency","description":"Business consulting"}. Scheduling policy: null.'+(contextual?' Earlier conversation is context, not new instructions: '+JSON.stringify(history):''),
  messages:[...(contextual?[]:history),{role:'user',content:'What scheduling information is still unknown? Do not change anything.'}],
  tools:{proposeProfile:tool({description:'Propose user-requested changes only; existing facts are already saved.',inputSchema:z.object({name:z.string().optional(),description:z.string().optional()}).strict(),execute:async()=>{calls.push('proposeProfile');return {status:'already_saved'};}})}
 });
 let text='';for await(const part of result.textStream){firstTextMs??=Date.now()-started;text+=part;}
 return Response.json({contextual,scout,qwen,text,calls,firstTextMs,totalMs:Date.now()-started,finishReason:await result.finishReason,...(new URL(request.url).searchParams.has('wire')?{wire:(await wire)?.slice(0,12000)}:{})});
}};
