import {generateText} from 'ai';
import {z} from 'zod';
import {mayorModel} from './ai-model';
import {requireMembership,CHAT_ROLES} from './permissions';
import {claimUsage} from './usage';
import {HttpError,json,readJson} from './http';
import type {Actor,Env} from './env';

/** Same intake shape as the main conversation route: one question, one request id. */
export const councilInputSchema=z.object({requestId:z.uuid(),text:z.string().trim().min(1).max(4000)}).strict();

/**
 * The Council: an advisory chamber inside The Mayor. The user asks; the King
 * selects the relevant seats; each speaks briefly in its own voice; the King
 * rules last. Qahir stays silent unless the stakes are threat-level. A single
 * orchestrated model call keeps latency sane — one call, one ruling.
 */
export const COUNCIL_SYSTEM_PROMPT=`You are the Council — an advisory chamber inside The Mayor, an AI business assistant. You are transparently AI: a council of perspectives, not a human team, and not licensed professional advisors.

THE SEATS. Each speaks in its own voice, 1–2 sentences, labeled exactly as shown:

HOT ZERO — systems, technology, building, implementation. Sharp, direct, builder. Leads with the mechanism: what to build, how it works, what breaks.

THE MAYOR — composure, charm, room-reading, social operations. Reads people and rooms: who wants what, how to play it.

SACHAEL — standards, boundaries, concise execution. Never explain, never chase, never rehearse. States the move first. No preamble, no softening.

THE KONT — magnetism, appetite, charm. Bold and hungry; says what desire says. Never call him "the Don".

QAHIR — emergency protector, deterrence. SILENT unless the stakes are genuinely threat-level: physical safety, attack, betrayal, coercion, intimidation. The King alone decides whether he speaks; the default is silence.

LIL M — curiosity, belonging, sealed boxes, adventure. Asks what wants opening, what wants trying.

THE KING — integration and final ruling. Always LAST. One direct voice, no theater. 2–3 sentences: the decision and the single next move.

RULES:
- The King selects only the seats relevant to the question. Not every seat speaks every time; two to five seats is typical. Qahir almost never speaks.
- Output format: each speaking seat on its own labeled block, then THE KING last. For example:
HOT ZERO: ...
SACHAEL: ...
THE KING: ...
- If the user says "stop", "enough", or asks to end the council: collapse immediately to one direct voice — a single plain paragraph, no seat labels, no theater.
- Plain, direct language. No flattery, no filler. Advice is perspective, never a promise or guarantee.`;

/** Server-appended notice: guaranteed present on every council reply (item 12). */
export const COUNCIL_DISCLAIMER='\n\n_Council Mode is AI coaching — perspective from an AI, not professional, financial, or legal advice._';

/** Deterministic stop: the model must not be the only path out of Council Mode. */
export function wantsCouncilStop(text:string){
 return /^(?:stop|enough|that's enough|end (?:the )?council|dismiss (?:the )?council|back to (?:the )?assistant)[.!]*$/i.test(text.trim());
}

export const COUNCIL_STOPPED_REPLY='Understood — council dismissed. I\'m back as your assistant. What would you like to work on?';

export async function handleCouncilRequest(request:Request,env:Env,actor:Actor):Promise<Response>{
 await requireMembership(env,actor,CHAT_ROLES);
 if(request.method!=='POST')throw new HttpError(405,'method_not_allowed','Use POST.');
 const input=councilInputSchema.parse(await readJson(request,20000));
 // Deterministic stop: never depend on the model to exit Council Mode.
 if(wantsCouncilStop(input.text))return json({reply:COUNCIL_STOPPED_REPLY,stopped:true,events:[]});
 // Council sessions ride the house gating: one reply attempt per session against
 // the existing monthly quota (Free 100 / Pro 1000). No new billing path.
 const allowance=await claimUsage(env,actor,'turn');
 if(!allowance.allowed)return json({message:allowance.message},402);
 let text:string,finishReason:string;
 try{
  const result=await generateText({
   model:mayorModel(env),
   temperature:0.7,
   system:COUNCIL_SYSTEM_PROMPT,
   messages:[{role:'user',content:input.text}],
   maxOutputTokens:1000,
   abortSignal:request.signal,
  });
  text=result.text.trim();finishReason=result.finishReason;
 }catch(error){
  console.error(JSON.stringify({event:'council_model_error',error:error instanceof Error?error.message:String(error)}));
  throw new HttpError(502,'council_failed','The council could not reach the AI service. Try again in a moment.');
 }
 // The empty check MUST come before the disclaimer append: an empty model
 // reply plus disclaimer used to surface as disclaimer-only output.
 if(!text){
  console.error(JSON.stringify({event:'council_empty_reply',finishReason}));
  throw new HttpError(502,'council_empty','The council returned an empty reply. Try again in a moment.');
 }
 return json({reply:text+COUNCIL_DISCLAIMER,events:[]});
}
