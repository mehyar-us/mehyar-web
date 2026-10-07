// Isolated remote preview; synthetic input only, no database or external actions.
import {streamText,tool,stepCountIs} from 'ai';
import {mayorModel} from '../../src/ai-model';
import {z} from 'zod';
import {profileReadback,confirmationStream} from '../../src/confirmation';
export default {async fetch(_request:Request,env:{AI:Ai}){
 let readback:string|undefined,armed=false,cleared=false,proposedName='';const chunks:string[]=[],events:string[]=[];
 const started=Date.now();
 const result=streamText({model:mayorModel(env.AI),
  prompt:'Propose the business name Remote Probe Business using proposeProfile. Do not claim it was saved.',maxOutputTokens:120,
  toolChoice:{type:'tool',toolName:'proposeProfile'},stopWhen:[stepCountIs(2),()=>readback!==undefined],
  tools:{proposeProfile:tool({inputSchema:z.object({name:z.string()}),execute:async patch=>{proposedName=patch.name;readback=profileReadback(patch);return {status:'awaiting_confirmation'};}})}
 });
 async function* checked(){for await(const part of result.fullStream){if(!['text-delta','tool-input-delta'].includes(part.type))events.push(part.type);if(part.type==='error')throw new Error('Model stream failed');if(part.type==='text-delta')yield part.text;}if(await result.finishReason==='error')throw new Error('Model failed');}
 for await(const text of confirmationStream(checked(),()=>readback,()=>true,()=>{armed=true;},()=>{cleared=true;}))chunks.push(text);
 return Response.json({events,finishReason:await result.finishReason,warnings:await result.warnings,ok:armed&&!cleared&&proposedName==='Remote Probe Business'&&chunks.at(-1)===readback,armed,cleared,proposedName,text:chunks.join(''),durationMs:Date.now()-started});
}};
