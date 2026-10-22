import {describe,it,expect,beforeEach,vi} from 'vitest';
import {
 buildImagePrompt,generateImage,listAssets,deleteAsset,attachAssetToPost,
 registerImagegenRoutes,IMAGE_MODEL_ID,MAX_IMAGES_PER_TENANT_PER_DAY,
 type ImagegenApp,
} from '../src/imagegen';
import type {Actor} from '../src/env';

/* No real external calls: env.AI.run is a stub, and AGENT_DB is an in-memory
 * fake that implements just the SQL shapes src/imagegen.ts issues. */

const OWNER:Actor={tenantId:'a1b2c3d4e5f60718293a4b5c6d7e8f90',userId:'user-owner-1'};
const OTHER_TENANT='f1e2d3c4b5a69788796a5b4c3d2e1f00';

interface Row{sql:string;args:any[]}
type Membership={role:string};

function fakeDb(opts:{role?:string;assets?:any[]}={}){
 const calls:Row[]=[];
 const assets:any[]=[...(opts.assets??[])];
 const membershipSql=(sql:string)=>/agent_memberships/.test(sql);
 const prepare=(sql:string)=>({bind:(...args:any[])=>{
  calls.push({sql,args});
  const first=async()=>{
   if(membershipSql(sql))return {tenant_id:OWNER.tenantId,user_id:OWNER.userId,role:opts.role??'owner',status:'active',expires_at:null} as Membership;
   if(/COUNT\(\*\)/.test(sql)){
    const [tenantId,cutoff]=args;
    return {n:assets.filter(a=>a.tenant_id===tenantId&&a.created_at>=cutoff&&a.status!=='deleted').length};
   }
   if(/SELECT used_in FROM mayor_imagegen_assets/.test(sql)){
    const [id,tenantId]=args;
    const row=assets.find(a=>a.id===id&&a.tenant_id===tenantId&&a.status!=='deleted');
    return row?{used_in:row.used_in}:null;
   }
   return null;
  };
  const all=async()=>{
   if(/FROM mayor_imagegen_assets/.test(sql)){
    const [tenantId]=args;
    return {results:assets.filter(a=>a.tenant_id===tenantId&&a.status!=='deleted')
     .sort((x,y)=>x.created_at<y.created_at?1:-1).slice(0,50)};
   }
   return {results:[]};
  };
  const run=async()=>{
   if(/^INSERT INTO mayor_imagegen_assets/.test(sql.trim())){
    const [id,tenant_id,use_case,prompt,final_prompt,model,created_at]=args;
    assets.push({id,tenant_id,use_case,prompt,final_prompt,model,ai_generated:1,status:'generated',
     r2_key:null,used_in:null,created_at,deleted_at:null});
    return {meta:{changes:1}};
   }
   if(/^UPDATE mayor_imagegen_assets SET status='deleted'/.test(sql.trim())){
    const [deleted_at,id,tenant_id]=args;
    const row=assets.find(a=>a.id===id&&a.tenant_id===tenant_id&&a.status!=='deleted');
    if(row){row.status='deleted';row.deleted_at=deleted_at;return {meta:{changes:1}};}
    return {meta:{changes:0}};
   }
   if(/^UPDATE mayor_imagegen_assets SET used_in/.test(sql.trim())){
    const [used_in,id,tenant_id]=args;
    const row=assets.find(a=>a.id===id&&a.tenant_id===tenant_id);
    if(row)row.used_in=used_in;
    return {meta:{changes:1}};
   }
   return {meta:{changes:0}};
  };
  return {first,all,run};
 }});
 return {db:{prepare},calls,assets};
}

function fakeEnv(assets:any[]=[],role='owner',aiRun?:(model:string,input:any)=>Promise<any>){
 const {db,calls,assets:store}=fakeDb({role,assets});
 const seen:{model:string;input:any}[]=[];
 const env={
  AI:{run:aiRun??(async(model:string,input:any)=>{seen.push({model,input});return {image:'aGVsbG8td29ybGQtaW1hZ2UtYnl0ZXMtaGVsbG8td29ybGQtaW1hZ2UtYnl0ZXMtaGVsbG8td29ybGQ='};})},
  AGENT_DB:db,
 } as any;
 return {env,calls,store,seen};
}

const baseBrand={businessName:'Glow Studio',vertical:'salon',brandColors:['#1a2b4c'],headline:'Spring glow event',logoOverlay:'none' as const};
const baseInput={useCase:'service_promo' as const,prompt:'A bright promo for our spring facial event',brand:baseBrand};

describe('prompt construction + honesty guardrails',()=>{
 it('spells the business name verbatim and appends the honesty footer',()=>{
  const {prompt}=buildImagePrompt(baseInput);
  expect(prompt).toContain('"Glow Studio"');
  expect(prompt).toContain('spell EXACTLY');
  expect(prompt).toContain('do not depict any identifiable real person');
  expect(prompt).toContain('no before/after body or result transformations');
 });
 it('rejects fake-result claims in the owner prompt',()=>{
  expect(()=>buildImagePrompt({...baseInput,prompt:'Lose 20 lbs with our detox wrap!'}))
   .toThrowError(expect.objectContaining({code:'unsupported_claim'}));
 });
 it('rejects guaranteed-result and #1-rated social proof',()=>{
  expect(()=>buildImagePrompt({...baseInput,prompt:'Guaranteed results in one visit'}))
   .toThrowError(expect.objectContaining({code:'unsupported_claim'}));
  expect(()=>buildImagePrompt({...baseInput,prompt:'Voted #1 best salon in town'}))
   .toThrowError(expect.objectContaining({code:'unsupported_claim'}));
 });
 it('rejects invented prices but allows business-supplied prices',()=>{
  expect(()=>buildImagePrompt({...baseInput,prompt:'Facials now $49 this week'}))
   .toThrowError(expect.objectContaining({code:'invented_price'}));
  const priced={...baseInput,brand:{...baseBrand,price:'$49'},prompt:'Facials this week'};
  const {prompt}=buildImagePrompt(priced);
  expect(prompt).toContain('"$49"');
 });
 it('rejects fake claims in the headline too',()=>{
  expect(()=>buildImagePrompt({...baseInput,brand:{...baseBrand,headline:'Guaranteed glow in 1 visit'}}))
   .toThrowError(expect.objectContaining({code:'unsupported_claim'}));
 });
 it('before_after_frame renders empty labeled slots, never synthetic transformations',()=>{
  const {prompt}=buildImagePrompt({...baseInput,useCase:'before_after_frame',prompt:'Frame for client results'});
  expect(prompt).toContain('TWO EMPTY labeled photo slots');
  expect(prompt).toContain('do not render any person, body part, or transformation inside them');
  expect(prompt).not.toMatch(/slimmer|thinner|younger/i);
 });
 it('threads the language param for future text-in-image localization',()=>{
  const en=buildImagePrompt(baseInput).prompt;
  expect(en).toContain('Overlay text in English');
  const es=buildImagePrompt({...baseInput,language:'es'}).prompt;
  expect(es).toContain('language "es"');
 });
 it('uses vertical vocabulary in scene + tone',()=>{
  const {prompt}=buildImagePrompt({...baseInput,brand:{...baseBrand,vertical:'restaurant'}});
  expect(prompt).toContain('restaurant table setting');
 });
});

describe('generate route',()=>{
 it('calls the model through the gateway shape and records an AI-generated asset',async()=>{
  const {env,seen,store}=fakeEnv();
  const result=await generateImage(env,OWNER,baseInput);
  expect(seen).toHaveLength(1);
  expect(seen[0].model).toBe(IMAGE_MODEL_ID);
  expect(String(seen[0].input.prompt)).toContain('Glow Studio');
  expect(seen[0].input).not.toHaveProperty('seed'); // Workers AI binding rejects seed (5006)
  expect(result.aiGenerated).toBe(true);
  expect(result.model).toBe(IMAGE_MODEL_ID);
  expect(result.imageBase64.length).toBeGreaterThan(0);
  expect(store).toHaveLength(1);
  expect(store[0].ai_generated).toBe(1);
  expect(store[0].tenant_id).toBe(OWNER.tenantId);
  expect(store[0].r2_key).toBeNull(); // DB metadata only until R2 lands
 });
 it('rejects non-owners',async()=>{
  const {env,seen}=fakeEnv([],'staff');
  await expect(generateImage(env,OWNER,baseInput))
   .rejects.toMatchObject({status:403});
  expect(seen).toHaveLength(0);
 });
 it('enforces the per-tenant daily image budget',async()=>{
  const now=new Date().toISOString();
  const assets=Array.from({length:MAX_IMAGES_PER_TENANT_PER_DAY},(_,i)=>({
   id:`00000000-0000-0000-0000-${String(i).padStart(12,'0')}`,tenant_id:OWNER.tenantId,use_case:'service_promo',
   prompt:'x',final_prompt:'x',model:IMAGE_MODEL_ID,ai_generated:1,status:'generated',r2_key:null,
   used_in:null,created_at:now,deleted_at:null}));
  const {env,seen}=fakeEnv(assets);
  await expect(generateImage(env,OWNER,baseInput)).rejects.toMatchObject({status:429,code:'imagegen_rate_limited'});
  expect(seen).toHaveLength(0); // budget checked before any model call
 });
 it('503s cleanly when the kill-switch is set',async()=>{
  const {env,seen}=fakeEnv();
  await expect(generateImage({...env,IMAGEGEN_DISABLED:'1'},OWNER,baseInput))
   .rejects.toMatchObject({status:503,code:'imagegen_disabled'});
  expect(seen).toHaveLength(0);
 });
 it('maps model failures to clean codes without leaking provider payloads',async()=>{
  const {env}=fakeEnv([],'owner',async()=>{throw new Error('model_not_found: @cf/black-forest-labs/flux-1-schnell');});
  await expect(generateImage(env,OWNER,baseInput))
   .rejects.toMatchObject({status:502,code:'imagegen_model_unavailable'});
 });
 it('502s on malformed model output',async()=>{
  const {env}=fakeEnv([],'owner',async()=>({unexpected:'shape'}));
  await expect(generateImage(env,OWNER,baseInput))
   .rejects.toMatchObject({status:502,code:'imagegen_bad_output'});
 });
});

describe('list / delete / attach',()=>{
 const seed=[{id:'11111111-1111-1111-1111-111111111111',tenant_id:OWNER.tenantId,use_case:'service_promo',
  prompt:'a',final_prompt:'a',model:IMAGE_MODEL_ID,ai_generated:1,status:'generated',r2_key:null,used_in:null,
  created_at:'2026-10-09T10:00:00.000Z',deleted_at:null},
  {id:'22222222-2222-2222-2222-222222222222',tenant_id:OTHER_TENANT,use_case:'service_promo',
  prompt:'b',final_prompt:'b',model:IMAGE_MODEL_ID,ai_generated:1,status:'generated',r2_key:null,used_in:null,
  created_at:'2026-10-09T11:00:00.000Z',deleted_at:null}];
 it('lists only the caller tenant assets',async()=>{
  const {env}=fakeEnv(structuredClone(seed));
  const assets=await listAssets(env,OWNER);
  expect(assets).toHaveLength(1);
  expect(assets[0].id).toBe('11111111-1111-1111-1111-111111111111');
  expect(assets[0].aiGenerated).toBe(true);
 });
 it('delete is tenant-scoped and soft-deletes',async()=>{
  const {env,store}=fakeEnv(structuredClone(seed));
  const out=await deleteAsset(env,OWNER,'11111111-1111-1111-1111-111111111111');
  expect(out.deleted).toBe(true);
  expect(store.find(a=>a.id.startsWith('1111'))!.status).toBe('deleted');
  await expect(deleteAsset(env,OWNER,'22222222-2222-2222-2222-222222222222'))
   .rejects.toMatchObject({status:404});
 });
 it('attach records the post id in used_in',async()=>{
  const {env,store}=fakeEnv(structuredClone(seed));
  const out=await attachAssetToPost(env,OWNER,'11111111-1111-1111-1111-111111111111','post_abc');
  expect(out.attached).toBe(true);
  expect(JSON.parse(store.find(a=>a.id.startsWith('1111'))!.used_in)).toEqual(['post_abc']);
 });
});

describe('registerImagegenRoutes',()=>{
 it('registers generate/list/delete/attach and enforces tenant match',async()=>{
  const routes:Record<string,any>={};
  const app:ImagegenApp={
   post:(p,h)=>{routes['POST '+p]=h},
   get:(p,h)=>{routes['GET '+p]=h},
   delete:(p,h)=>{routes['DELETE '+p]=h},
  };
  registerImagegenRoutes(app);
  expect(Object.keys(routes)).toHaveLength(4);

  const {env}=fakeEnv();
  const req=(method:string,path:string,body?:unknown)=>new Request(`https://mayor.test${path}`,
   {method,headers:body?{'content-type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
  const tenantPath=`/api/businesses/${OWNER.tenantId}/imagegen`;

  const gen=await routes['POST /api/businesses/:tenantId/imagegen/generate'](
   req('POST',`${tenantPath}/generate`,baseInput),env,OWNER);
  expect(gen.status).toBe(201);
  const genJson=await gen.json();
  expect(genJson.asset.aiGenerated).toBe(true);
  expect(typeof genJson.image.base64).toBe('string');

  const listed=await routes['GET /api/businesses/:tenantId/imagegen/assets'](
   req('GET',`${tenantPath}/assets`),env,OWNER);
  expect((await listed.json()).assets).toHaveLength(1);

  // Cross-tenant actor is rejected even with a valid session.
  const intruder:Actor={tenantId:OTHER_TENANT,userId:OWNER.userId};
  await expect(routes['GET /api/businesses/:tenantId/imagegen/assets'](
   req('GET',`${tenantPath}/assets`),env,intruder)).rejects.toMatchObject({status:403});
 });
});
