import {HttpError} from './http';
import {verticalProfile} from './verticals';
import {mayorVisionRun,MAYOR_VISION_MODEL} from './ai-model';
import type {Env} from './env';

/** Crew 6j — photo upload + image Q&A for the chat composer.
 *
 * Flow: the composer uploads each photo first (POST .../conversation/images,
 * multipart), gets back an image id, then sends the chat turn with
 * `{text, imageIds}`. The turn runs a vision pre-pass over the attached
 * photos and appends the observation to the user message — deterministically,
 * the same pattern as growthMetricsInstruction.
 *
 * Tenant scoping: every row carries tenant_id and every query filters on it.
 * Images are the business's data — never cross-tenant, never shared.
 * Retention: 90 days, enforced opportunistically on upload; owners can delete
 * a photo any time. See workers/mayor/docs/image-retention.md.
 */

export const IMAGE_UPLOAD={
 /** MIME types we accept. No GIF/SVG: no animation, no vector/XML attack surface. */
 allowedTypes:['image/jpeg','image/png','image/webp'] as const,
 /** Server-side hard cap per photo. The client downscales to ~1280px first. */
 maxBytes:5*1024*1024,
 /** Photos per chat turn. Keeps vision latency and cost bounded. */
 maxImagesPerTurn:2,
 /** Retention window in days. Documented in docs/image-retention.md. */
 retentionDays:90,
} as const;

export interface ImageUploadFile{contentType:string;sizeBytes:number}

/** Reject bad uploads before any byte is stored. Throws HttpError. */
export function validateImageUpload(file:ImageUploadFile):void{
 const type=file.contentType.toLowerCase().split(';')[0].trim();
 if(!(IMAGE_UPLOAD.allowedTypes as readonly string[]).includes(type))
  throw new HttpError(415,'unsupported_image_type','Send a JPEG, PNG, or WebP photo.');
 if(!Number.isFinite(file.sizeBytes)||file.sizeBytes<=0)
  throw new HttpError(400,'empty_image','That photo came through empty. Try again.');
 if(file.sizeBytes>IMAGE_UPLOAD.maxBytes)
  throw new HttpError(413,'image_too_large','That photo is too large. Keep it under 5 MB.');
}

type Db=Pick<Env,'AGENT_DB'>['AGENT_DB'];

export interface StoredImage{id:string;contentType:string;bytes:ArrayBuffer}

/** Store a photo, tenant-scoped. Returns the image id. */
export async function saveChatImage(db:Db,tenantId:string,bytes:ArrayBuffer,contentType:string):Promise<string>{
 if(!tenantId)throw new HttpError(400,'tenant_required','A business is required.');
 const type=contentType.toLowerCase().split(';')[0].trim();
 validateImageUpload({contentType:type,sizeBytes:bytes.byteLength});
 const id=crypto.randomUUID(),now=Date.now();
 await db.prepare(
  `INSERT INTO mayor_chat_images(id,tenant_id,content_type,bytes,byte_size,created_at) VALUES(?,?,?,?,?,?)`
 ).bind(id,tenantId,type,bytes,bytes.byteLength,now).run();
 // Retention enforcement: drop this tenant's photos older than the window.
 // Opportunistic (runs on upload, not a cron) so no scheduler is needed.
 await db.prepare(`DELETE FROM mayor_chat_images WHERE tenant_id=? AND created_at<?`)
  .bind(tenantId,now-IMAGE_UPLOAD.retentionDays*86400000).run().catch(()=>{});
 return id;
}

/** Fetch photos for a turn. Tenant-scoped: ids from another business resolve to nothing. */
export async function getChatImages(db:Db,tenantId:string,ids:string[]):Promise<StoredImage[]>{
 const unique=[...new Set(ids.filter(id=>typeof id==='string'&&id.length>0))].slice(0,IMAGE_UPLOAD.maxImagesPerTurn);
 if(!unique.length||!tenantId)return [];
 const placeholders=unique.map(()=>'?').join(',');
 const rows=await db.prepare(
  `SELECT id,content_type,bytes FROM mayor_chat_images WHERE tenant_id=? AND id IN (${placeholders})`
 ).bind(tenantId,...unique).all<{id:string;content_type:string;bytes:ArrayBuffer}>();
 return (rows.results??[]).map(r=>({id:r.id,contentType:r.content_type,bytes:r.bytes}));
}

/** Delete one photo. Tenant-scoped: returns false when the id isn't this business's. */
export async function deleteChatImage(db:Db,tenantId:string,id:string):Promise<boolean>{
 if(!tenantId||!id)return false;
 const result=await db.prepare(`DELETE FROM mayor_chat_images WHERE id=? AND tenant_id=?`).bind(id,tenantId).run();
 return (result.meta?.changes??0)>0;
}

/** Defensive language read for the vision prompt. Anything that isn't 'es'
 * falls back to 'en' — the profile may not carry a language field yet. */
export function resolveImageLanguage(value:unknown):'en'|'es'{
 return value==='es'?'es':'en';
}

type ImageProfile={vertical?:unknown;language?:unknown};

const VERTICAL_FOCUS:Record<string,string>={
 salon:'hair color lift and evenness, cut lines and blending, and scalp or skin condition visible in the frame',
 restaurant:'plating, portion size, presentation, and any food-safety cues visible in the frame',
 plumbing_hvac:'corrosion, leaks, water staining, and the condition of fittings and pipes',
 dental:'the office environment and visible equipment only — never diagnose a patient\u2019s condition from a photo',
 auto_repair:'body damage, tire wear, fluid leaks, and the condition of visible parts',
};

/** Deterministic vision instruction, appended to the user message when photos
 * are attached — same pattern as growthMetricsInstruction. Vertical-flavored,
 * bilingual, and carries the hard honesty rule: never invent. */
export function visionInstruction(profile:ImageProfile={},transcript='',imageCount=1):string{
 const vp=verticalProfile(typeof profile.vertical==='string'?profile.vertical:undefined);
 const lang=resolveImageLanguage(profile.language);
 const focus=VERTICAL_FOCUS[vp.vertical]??'what is actually visible in the frame';
 const v=vp.vocabulary;
 const question=transcript.trim()?` The owner asks: "${transcript.trim().slice(0,500)}"`:'';
 if(lang==='es'){
  return `\n\n[Instrucción para esta foto: el dueño adjuntó ${imageCount===1?'una foto':'fotos'} y pregunta sobre ${vp.label.toLowerCase()}.${question} En este negocio, los clientes se llaman “${v.customer}”, las reservas son “${v.booking}” y el personal es “${v.staff}”. Enfóquese en: ${focus}. REGLA DE HONESTIDAD — nunca invente lo que no puede ver. Si la foto está borrosa, oscura, recortada o no muestra lo necesario para responder, dígalo claramente (“No puedo determinarlo con esta foto — …”) y pida una mejor foto. Nunca adivine diagnósticos, medidas ni identidades. Describa solo lo que realmente se ve. Responda en español.]`;
 }
 return `\n\n[Instruction for this photo: the owner attached ${imageCount===1?'a photo':'photos'} and asks about their ${vp.label.toLowerCase()}.${question} In this business, customers are called “${v.customer}”, bookings are “${v.booking}”, and staff are “${v.staff}”. Focus on: ${focus}. HONESTY RULE — never invent what you cannot see. If the photo is blurry, dark, cropped, or doesn't show what's needed to answer, say so plainly ("I can't tell from this photo — ...") and ask for a clearer one. Never guess at diagnoses, measurements, or identities. Describe only what is actually visible. Reply in English.]`;
}

function arrayBufferToBase64(bytes:ArrayBuffer):string{
 const view=new Uint8Array(bytes);let binary='';
 const CHUNK=0x8000;
 for(let i=0;i<view.length;i+=CHUNK)binary+=String.fromCharCode(...view.subarray(i,i+CHUNK));
 return btoa(binary);
}

function extractVisionText(output:unknown):string|null{
 if(!output||typeof output!=='object')return null;
 const response=(output as {response?:unknown}).response;
 if(typeof response==='string'&&response.trim())return response.trim();
 const content=(output as {choices?:Array<{message?:{content?:unknown}}>}).choices?.[0]?.message?.content;
 if(typeof content==='string'&&content.trim())return content.trim();
 return null;
}

/** Run the vision model over the attached photos through the same
 * gatewayRun + fallback path as the text model. Returns the model's
 * observation, or null when vision is unavailable. */
export async function runVisionTurn(
 env:Pick<Env,'AI'|'AI_GATEWAY_ACCOUNT_ID'|'AI_GATEWAY_ID'|'AI_GATEWAY_TOKEN'>,
 images:{contentType:string;bytes:ArrayBuffer}[],
 instruction:string,
 signal?:AbortSignal,
):Promise<string|null>{
 if(!images.length)return null;
 const run=mayorVisionRun(env);
 const content:unknown[]=[{type:'text',text:instruction}];
 for(const image of images){
  content.push({type:'image_url',image_url:{url:`data:${image.contentType};base64,${arrayBufferToBase64(image.bytes)}`}});
 }
 const output=await run(MAYOR_VISION_MODEL,{
  messages:[{role:'user',content}],
  max_tokens:600,
  temperature:0,
 },{signal});
 return extractVisionText(output);
}

/** Vision pre-pass for a chat turn with attached photos. Returns the block
 * to append to the user message, or '' when there is nothing to add.
 * Fails soft: a dead vision call still lets the text turn answer — but the
 * model is told not to claim it saw the photo. */
export async function describeAttachedImages(
 env:Pick<Env,'AI'|'AI_GATEWAY_ACCOUNT_ID'|'AI_GATEWAY_ID'|'AI_GATEWAY_TOKEN'>,
 profile:ImageProfile,
 transcript:string,
 images:StoredImage[],
 signal?:AbortSignal,
):Promise<string>{
 if(!images.length)return '';
 const instruction=visionInstruction(profile,transcript,images.length);
 let observation:string|null=null;
 try{observation=await runVisionTurn(env,images,instruction,signal);}
 catch{observation=null;}
 if(!observation)
  return `\n\n[Photo note: the owner attached ${images.length===1?'a photo':'photos'} this turn, but the photo could not be analyzed. Do NOT claim to have seen it or describe its contents. Say the photo didn't come through and ask them to send it again.]`;
 return `\n\n[Photo observation — from the owner's attached photo${images.length===1?'':'s'}, analyzed just now, never from memory: ${observation}]\nTreat the observation as evidence for this answer. If it says the photo is unclear, say so plainly and ask for a better photo instead of guessing.`;
}
