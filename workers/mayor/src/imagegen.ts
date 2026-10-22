import {z} from 'zod';
import type {Actor,Env} from './env';
import {HttpError,json,readJson} from './http';
import {requireMembership} from './permissions';
import {gatewayRun} from './ai-gateway';
import {verticalProfile} from './verticals';

/**
 * Promo image generation (workstream 7d).
 *
 * Image calls go through the SAME gateway/binding pattern as every other
 * model call: `gatewayRun(env)` from ai-gateway.ts (shared AI Gateway with
 * caching/fallbacks/per-tenant rate limits when configured, direct Workers
 * AI binding otherwise). Do not invent a second model client.
 */

/** Workers AI text-to-image model, live-verified 2026-10-09 (Moonroom E2E: 20/20 images via this binding).
 * NOTE: the Workers AI *binding* rejects the `seed` param (error 5006 — the REST API accepts it) — omit it. */
export const IMAGE_MODEL_ID='@cf/black-forest-labs/flux-1-schnell';

/** Test/kill-switch gate: set IMAGEGEN_DISABLED=1 to 503 every generate call. */
type ImagegenEnv=Pick<Env,'AI'|'AGENT_DB'|'AI_GATEWAY_ACCOUNT_ID'|'AI_GATEWAY_ID'|'AI_GATEWAY_TOKEN'>&{IMAGEGEN_DISABLED?:string};

/** Per-tenant daily image budget — one business must never burn the image budget. */
export const MAX_IMAGES_PER_TENANT_PER_DAY=20;

export const useCaseSchema=z.enum(['service_promo','seasonal_offer','social_creative','before_after_frame']);
export type ImageUseCase=z.infer<typeof useCaseSchema>;

const brandSchema=z.object({
 /** Business display name — spelled exactly into the prompt; never paraphrased. */
 businessName:z.string().trim().min(1).max(80),
 /** Vertical key; selects scene vocabulary from the 5 runtime profiles. */
 vertical:z.string().trim().max(40).optional(),
 /** Brand palette hints, e.g. ["#1a2b4c","#f5c518"]. Never invented. */
 brandColors:z.array(z.string().regex(/^#[0-9a-fA-F]{6}$/)).max(4).optional(),
 /** Short overlay headline (<= 8 words). Text-in-image is model-rendered; keep it short. */
 headline:z.string().trim().min(1).max(60).optional(),
 /** Price shown in the image. ONLY from business data — never invented (compliance item 12). */
 price:z.string().trim().min(1).max(30).optional(),
 /** Where the owner's logo would sit when supplied. 'none' = no logo supplied. */
 logoOverlay:z.enum(['none','top-left','top-right','bottom-left','bottom-right']).optional(),
}).strict();

export const generateRequestSchema=z.object({
 useCase:useCaseSchema,
 /** Owner's own description of what the image should show. Screened for honesty guardrails. */
 prompt:z.string().trim().min(1).max(500),
 brand:brandSchema,
 /** ISO 639-1, default 'en'. Threaded for future text-in-image localization. */
 language:z.string().trim().regex(/^[a-z]{2}$/).optional(),
}).strict();
export type GenerateRequest=z.infer<typeof generateRequestSchema>;

/* ---------------- honesty guardrails (compliance items 12, 19) ---------------- */

/** Claim shapes we refuse to render — fake results, fake social proof, fake credentials. */
const CLAIM_BLOCKLIST:RegExp[]=[
 /lose\s+\d+\s*(lbs?|pounds?|kilos?|kg)/i,          // "lose 20 lbs!" imagery
 /\bguaranteed\b/i,                                // guaranteed results
 /\bmiracle\b/i,
 /#\s?1\b.*\b(rated|best|top)\b/i,                 // "#1 rated" social proof
 /\bbest\b.{0,20}\bin\s+(town|the city|america)\b/i,
 /\bdoctors?\s+(recommend|approve)\b/i,
 /\bfda\b.{0,10}approved\b/i,
];
/** A price the owner did not supply — never invent prices in image text. */
const PRICE_PATTERN=/\$\s?\d/;

function assertHonestCopy(label:string,text:string,priceSupplied:boolean){
 for(const pattern of CLAIM_BLOCKLIST){
  if(pattern.test(text))throw new HttpError(400,'unsupported_claim',
   `${label} makes a claim we cannot put in generated imagery. Remove the claim and try again.`);
 }
 if(!priceSupplied&&PRICE_PATTERN.test(text))throw new HttpError(400,'invented_price',
  `${label} contains a price that was not supplied as business data. Add the price to the brand options or remove it.`);
}

/* ---------------- prompt construction ---------------- */

const VERTICAL_SCENES:Record<string,string>={
 salon:'a modern salon interior, styling chair and large mirror, warm flattering light',
 restaurant:'a cozy restaurant table setting with fresh dishes, warm evening light',
 plumbing_hvac:'a clean branded service van and professional technician tools, trustworthy and tidy',
 dental:'a bright modern dental office reception, clean and welcoming',
 auto_repair:'a clean professional auto repair bay with modern equipment',
 other:'a welcoming local business storefront at golden hour',
};

const USE_CASE_FRAMING:Record<ImageUseCase,string>={
 service_promo:'Promotional graphic for a specific service. Clean layout with one short headline and room for the business name.',
 seasonal_offer:'Seasonal promotional graphic. Festive but tasteful, one short headline, room for the business name.',
 social_creative:'Bold square social-media creative. Eye-catching, minimal text, thumb-stopping composition.',
 // Honesty rule: the model NEVER synthesizes before/after imagery. It renders an
 // empty branded frame with two labeled photo slots; the OWNER drops their real
 // before/after photos in client-side. No fake transformations, ever.
 before_after_frame:'A branded photo-frame template with TWO EMPTY labeled photo slots ("BEFORE" and "AFTER"). '+
  'The slots must be empty/blank placeholders — do not render any person, body part, or transformation inside them. '+
  'The owner will place their own real photos into the slots.',
};

export interface BuiltPrompt{prompt:string;headline:string|null}

/** Build a text-safe English prompt. Business name is quoted verbatim so the
 * model spells it correctly; every prompt carries the honesty footer. */
export function buildImagePrompt(input:GenerateRequest):BuiltPrompt{
 const {useCase,prompt,brand,language='en'}=input;
 const priceSupplied=typeof brand.price==='string'&&brand.price.length>0;
 assertHonestCopy('Prompt',prompt,priceSupplied);
 if(brand.headline)assertHonestCopy('Headline',brand.headline,priceSupplied);

 const profile=verticalProfile(brand.vertical);
 const scene=VERTICAL_SCENES[profile.vertical]??VERTICAL_SCENES.other;
 const voice=profile.suggestionVoice?` Tone: ${profile.suggestionVoice}`:'';
 const palette=brand.brandColors?.length?` Brand palette accents: ${brand.brandColors.join(', ')}.`:'';
 const logo=brand.logoOverlay&&brand.logoOverlay!=='none'
  ?` Leave clear space in the ${brand.logoOverlay.replace('-',' ')} corner for the business logo overlay.`
  :` No logo overlay.`;
 const headline=brand.headline??null;
 const headlineLine=headline
  ?` Overlay headline text, spelled EXACTLY as written (no paraphrase, no extra words): "${headline}".`
  :` No overlay text besides the business name.`;
 const priceLine=priceSupplied?` Price shown in the image, exactly as written: "${brand.price}".`:' No prices anywhere in the image.';
 const langLine=language!=='en'
  ?` Any overlay text is rendered in language "${language}".`
  :` Overlay text in English.`;

 // The honesty footer is non-negotiable: AI-generated disclosure baked into the
 // composition brief, no real people presented as customers, no fake results.
 const honestyFooter=' Honesty rules: do not depict any identifiable real person as a customer or staff member; '+
  'no before/after body or result transformations; no fake reviews, awards, or credentials; '+
  'the business name below is spelled exactly as given.';
 const businessLine=`Business name (spell EXACTLY, letter for letter): "${brand.businessName}".`;

 const full=`${USE_CASE_FRAMING[useCase]} Scene: ${scene}.${voice}${palette}${logo} ${headlineLine}${priceLine} ${langLine} ${businessLine}${honestyFooter} Owner brief: ${prompt}`;
 return {prompt:full,headline};
}

/* ---------------- generation ---------------- */

export interface GeneratedImage{assetId:string;imageBase64:string;mimeType:string;model:string;aiGenerated:true}

function imagegenDisabled(env:ImagegenEnv){
 return env.IMAGEGEN_DISABLED==='1'||env.IMAGEGEN_DISABLED==='true';
}

function extractImageBase64(output:unknown):string{
 // Workers AI text-to-image returns {image: "<base64>"}. Be defensive: accept a
 // bare base64 string too; anything else is a clean 502, never a partial render.
 if(typeof output==='string'&&output.length>64)return output;
 if(output&&typeof output==='object'){
  const image=(output as {image?:unknown}).image;
  if(typeof image==='string'&&image.length>64)return image;
 }
 throw new HttpError(502,'imagegen_bad_output','The image model returned an unexpected result. Try again.');
}

function toCleanError(error:unknown):never{
 // Never leak provider payloads or credentials; map to stable codes.
 if(error instanceof HttpError)throw error;
 const message=error instanceof Error?error.message:'';
 if(/model_not_found|no such model|404/.test(message))throw new HttpError(502,'imagegen_model_unavailable',
  'The image model is unavailable right now. Try again later.');
 throw new HttpError(502,'imagegen_failed','Image generation failed. Try again.');
}

async function checkRateLimit(db:D1Database,tenantId:string){
 const cutoff=new Date(Date.now()-24*60*60*1000).toISOString();
 const row=await db.prepare(
  `SELECT COUNT(*) AS n FROM mayor_imagegen_assets WHERE tenant_id=? AND created_at>=? AND status!='deleted'`)
  .bind(tenantId,cutoff).first<{n:number}>();
 const used=row?.n??0;
 if(used>=MAX_IMAGES_PER_TENANT_PER_DAY)throw new HttpError(429,'imagegen_rate_limited',
  `Image budget reached for today (${MAX_IMAGES_PER_TENANT_PER_DAY}/day). Try again tomorrow.`);
}

export interface AssetRow{id:string;tenant_id:string;use_case:string;prompt:string;final_prompt:string;model:string;
 ai_generated:number;status:string;r2_key:string|null;used_in:string|null;created_at:string;deleted_at:string|null}

const assetView=(row:AssetRow)=>({id:row.id,useCase:row.use_case,prompt:row.prompt,model:row.model,
 aiGenerated:row.ai_generated===1,status:row.status,usedIn:row.used_in?JSON.parse(row.used_in) as string[]:[],
 createdAt:row.created_at});

/** Generate one promo image. Owner role only. Returns the image bytes (base64)
 * plus the recorded asset. Binary persistence is DB-metadata-only today — see
 * the R2 TODO below; the integrator wires an R2 bucket + binding when provisioned. */
export async function generateImage(env:ImagegenEnv,actor:Actor,input:GenerateRequest):Promise<GeneratedImage>{
 if(imagegenDisabled(env))throw new HttpError(503,'imagegen_disabled','Image generation is currently disabled.');
 const parsed=generateRequestSchema.parse(input);
 await requireMembership(env,actor,['owner']);
 const {prompt:finalPrompt}=buildImagePrompt(parsed);
 await checkRateLimit(env.AGENT_DB,actor.tenantId);

 const run=gatewayRun(env);
 let output:unknown;
 try{
  // Same call shape as every other Workers AI call: run(model, input).
  // No `seed` — the Workers AI binding rejects it (5006).
  output=await run(IMAGE_MODEL_ID,{prompt:finalPrompt,num_steps:4});
 }catch(error){toCleanError(error);}
 const imageBase64=extractImageBase64(output);

 const id=crypto.randomUUID();
 const now=new Date().toISOString();
 await env.AGENT_DB.prepare(
  `INSERT INTO mayor_imagegen_assets (id,tenant_id,use_case,prompt,final_prompt,model,ai_generated,status,r2_key,used_in,created_at,deleted_at)
   VALUES (?,?,?,?,?,?,1,'generated',NULL,NULL,?,NULL)`)
  .bind(id,actor.tenantId,parsed.useCase,parsed.prompt,finalPrompt,IMAGE_MODEL_ID,now).run();
 // TODO(storage): persist `imageBase64` to R2 (no R2 binding in wrangler.jsonc yet).
 // When provisioned: r2 bucket `mayor-imagegen`, key `imagegen/<tenantId>/<id>.png`,
 // UPDATE mayor_imagegen_assets SET r2_key=? WHERE id=?, and serve via a signed
 // GET route. The DB row is already the source of truth for metadata.
 return {assetId:id,imageBase64,mimeType:'image/png',model:IMAGE_MODEL_ID,aiGenerated:true};
}

export async function listAssets(env:ImagegenEnv,actor:Actor){
 await requireMembership(env,actor,['owner']);
 const rows=await env.AGENT_DB.prepare(
  `SELECT id,tenant_id,use_case,prompt,final_prompt,model,ai_generated,status,r2_key,used_in,created_at,deleted_at
   FROM mayor_imagegen_assets WHERE tenant_id=? AND status!='deleted' ORDER BY created_at DESC LIMIT 50`)
  .bind(actor.tenantId).all<AssetRow>();
 return (rows.results??[]).map(assetView);
}

export async function deleteAsset(env:ImagegenEnv,actor:Actor,assetId:string){
 await requireMembership(env,actor,['owner']);
 if(!/^[0-9a-f-]{36}$/.test(assetId))throw new HttpError(400,'invalid_asset','Unknown image.');
 const now=new Date().toISOString();
 const result=await env.AGENT_DB.prepare(
  `UPDATE mayor_imagegen_assets SET status='deleted',deleted_at=? WHERE id=? AND tenant_id=? AND status!='deleted'`)
  .bind(now,assetId,actor.tenantId).run();
 // D1 run() exposes meta.changes; the fake in tests mirrors it.
 const changes=(result as {meta?:{changes?:number}}).meta?.changes;
 if(typeof changes==='number'&&changes===0)throw new HttpError(404,'asset_not_found','Image not found.');
 return {deleted:true,id:assetId};
}

/** Mark an asset as used in a post draft (gallery → attach). Tenant-scoped. */
export async function attachAssetToPost(env:ImagegenEnv,actor:Actor,assetId:string,postId:string){
 await requireMembership(env,actor,['owner']);
 if(!/^[0-9a-f-]{36}$/.test(assetId)||!/^[A-Za-z0-9_-]{1,128}$/.test(postId))throw new HttpError(400,'invalid_input','Unknown image or post.');
 const row=await env.AGENT_DB.prepare(
  `SELECT used_in FROM mayor_imagegen_assets WHERE id=? AND tenant_id=? AND status!='deleted'`)
  .bind(assetId,actor.tenantId).first<{used_in:string|null}>();
 if(!row)throw new HttpError(404,'asset_not_found','Image not found.');
 const usedIn=row.used_in?JSON.parse(row.used_in) as string[]:[];
 if(!usedIn.includes(postId))usedIn.push(postId);
 await env.AGENT_DB.prepare(`UPDATE mayor_imagegen_assets SET used_in=? WHERE id=? AND tenant_id=?`)
  .bind(JSON.stringify(usedIn),assetId,actor.tenantId).run();
 return {attached:true,id:assetId,postId};
}

/* ---------------- route registration ---------------- */

/** Minimal router surface the integrator adapts into index.ts's dispatch.
 * Handlers receive the already-authenticated Actor; tenant scoping is enforced
 * inside each handler (actor.tenantId must match the :tenantId path segment). */
export interface ImagegenRouteHandler{(request:Request,env:Env,actor:Actor):Promise<Response>}
export interface ImagegenApp{
 post(path:string,handler:ImagegenRouteHandler):void;
 get(path:string,handler:ImagegenRouteHandler):void;
 delete(path:string,handler:ImagegenRouteHandler):void;
}

function tenantIdFrom(request:Request):string{
 const match=new URL(request.url).pathname.match(/^\/api\/businesses\/([a-f0-9]{32})\/imagegen\//);
 if(!match)throw new HttpError(404,'not_found','Not found.');
 return match[1];
}

function assertTenant(actor:Actor,request:Request){
 const tenantId=tenantIdFrom(request);
 if(actor.tenantId!==tenantId)throw new HttpError(403,'tenant_mismatch','This image does not belong to your business.');
}

export function registerImagegenRoutes(app:ImagegenApp){
 app.post('/api/businesses/:tenantId/imagegen/generate',async(request,env,actor)=>{
  assertTenant(actor,request);
  const body=await readJson(request,64_000);
  const result=await generateImage(env,actor,generateRequestSchema.parse(body));
  return json({asset:{id:result.assetId,model:result.model,aiGenerated:result.aiGenerated},
   image:{mimeType:result.mimeType,base64:result.imageBase64}},201);
 });
 app.get('/api/businesses/:tenantId/imagegen/assets',async(request,env,actor)=>{
  assertTenant(actor,request);
  return json({assets:await listAssets(env,actor)});
 });
 app.delete('/api/businesses/:tenantId/imagegen/assets/:assetId',async(request,env,actor)=>{
  assertTenant(actor,request);
  const match=new URL(request.url).pathname.match(/\/imagegen\/assets\/([^/]+)$/);
  return json(await deleteAsset(env,actor,match?.[1]??''));
 });
 app.post('/api/businesses/:tenantId/imagegen/assets/:assetId/attach',async(request,env,actor)=>{
  assertTenant(actor,request);
  const match=new URL(request.url).pathname.match(/\/imagegen\/assets\/([^/]+)\/attach$/);
  const body=await readJson(request,4_096);
  const postId=(body as {postId?:unknown}).postId;
  if(typeof postId!=='string')throw new HttpError(400,'invalid_input','A post id is required.');
  return json(await attachAssetToPost(env,actor,match?.[1]??'',postId));
 });
}
