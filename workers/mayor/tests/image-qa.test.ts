import {describe,it,expect} from 'vitest';
import {HttpError} from '../src/http';
import {
 IMAGE_UPLOAD,validateImageUpload,saveChatImage,getChatImages,deleteChatImage,
 resolveImageLanguage,visionInstruction,runVisionTurn,describeAttachedImages,
} from '../src/image-qa';
import {MAYOR_VISION_MODEL} from '../src/ai-model';

/** Crew 6j: photo upload + image Q&A. No real AI calls — the vision path is
 * stubbed at env.AI.run. The DB is an in-memory D1 mock. */

interface Row{sql:string;bound:unknown[]}
function mockDb(){
 const images:{id:string;tenant_id:string;content_type:string;bytes:ArrayBuffer;created_at:number}[]=[];
 const calls:Row[]=[];
 const db={
  prepare(sql:string){
   let bound:unknown[]=[];
   const stmt={
    bind(...args:unknown[]){bound=args;return stmt;},
    async run(){
     calls.push({sql,bound});
     if(sql.startsWith('INSERT INTO mayor_chat_images')){
      const [id,tenant_id,content_type,bytes,,created_at]=bound as [string,string,string,ArrayBuffer,number,number];
      images.push({id,tenant_id,content_type,bytes,created_at});
      return {meta:{changes:1}};
     }
     if(sql.startsWith('DELETE FROM mayor_chat_images WHERE tenant_id=? AND created_at<?')){
      const [tenant_id,cutoff]=bound as [string,number];
      for(let i=images.length-1;i>=0;i--)if(images[i].tenant_id===tenant_id&&images[i].created_at<cutoff)images.splice(i,1);
      return {meta:{changes:1}};
     }
     if(sql.startsWith('DELETE FROM mayor_chat_images WHERE id=? AND tenant_id=?')){
      const [id,tenant_id]=bound as [string,string];
      const before=images.length;
      for(let i=images.length-1;i>=0;i--)if(images[i].id===id&&images[i].tenant_id===tenant_id)images.splice(i,1);
      return {meta:{changes:before-images.length}};
     }
     return {meta:{changes:0}};
    },
    async all(){
     calls.push({sql,bound});
     if(sql.includes('FROM mayor_chat_images WHERE tenant_id=?')){
      const [tenant_id,...ids]=bound as [string,...string[]];
      const results=images
       .filter(r=>r.tenant_id===tenant_id&&ids.includes(r.id))
       .map(r=>({id:r.id,content_type:r.content_type,bytes:r.bytes}));
      return {results};
     }
     return {results:[]};
    },
   };
   return stmt;
  },
 } as unknown as Parameters<typeof saveChatImage>[0];
 return {db,images,calls};
}

const TENANT='t1'.padEnd(32,'0');
const OTHER='t2'.padEnd(32,'0');
const jpegBytes=(n:number)=>new Uint8Array(n).buffer as ArrayBuffer;

describe('validateImageUpload',()=>{
 it('accepts jpeg, png, webp',()=>{
  expect(()=>validateImageUpload({contentType:'image/jpeg',sizeBytes:100})).not.toThrow();
  expect(()=>validateImageUpload({contentType:'image/png',sizeBytes:100})).not.toThrow();
  expect(()=>validateImageUpload({contentType:'image/webp; charset=binary',sizeBytes:100})).not.toThrow();
 });
 it('rejects gif and svg with 415',()=>{
  for(const contentType of ['image/gif','image/svg+xml']){
   try{validateImageUpload({contentType,sizeBytes:100});expect.unreachable();}
   catch(error){expect(error).toBeInstanceOf(HttpError);expect((error as HttpError).status).toBe(415);}
  }
 });
 it('rejects empty files with 400',()=>{
  try{validateImageUpload({contentType:'image/jpeg',sizeBytes:0});expect.unreachable();}
  catch(error){expect((error as HttpError).status).toBe(400);}
 });
 it('rejects oversize files with 413',()=>{
  try{validateImageUpload({contentType:'image/jpeg',sizeBytes:IMAGE_UPLOAD.maxBytes+1});expect.unreachable();}
  catch(error){expect((error as HttpError).status).toBe(413);}
 });
});

describe('tenant-scoped image storage',()=>{
 it('stores and fetches within the same tenant',async()=>{
  const {db}=mockDb();
  const id=await saveChatImage(db,TENANT,jpegBytes(100),'image/jpeg');
  const found=await getChatImages(db,TENANT,[id]);
  expect(found).toHaveLength(1);
  expect(found[0].contentType).toBe('image/jpeg');
  expect(found[0].bytes.byteLength).toBe(100);
 });
 it('never leaks images across tenants',async()=>{
  const {db}=mockDb();
  const id=await saveChatImage(db,TENANT,jpegBytes(100),'image/jpeg');
  await expect(getChatImages(db,OTHER,[id])).resolves.toEqual([]);
  await expect(deleteChatImage(db,OTHER,id)).resolves.toBe(false);
  // The owner's copy is untouched.
  await expect(getChatImages(db,TENANT,[id])).resolves.toHaveLength(1);
 });
 it('caps ids per turn and ignores unknown ids',async()=>{
  const {db}=mockDb();
  const ids=await Promise.all([0,1,2].map(()=>saveChatImage(db,TENANT,jpegBytes(10),'image/png')));
  const found=await getChatImages(db,TENANT,[...ids,'nope']);
  expect(found.length).toBeLessThanOrEqual(IMAGE_UPLOAD.maxImagesPerTurn);
 });
 it('deletes the owner\u2019s photo',async()=>{
  const {db}=mockDb();
  const id=await saveChatImage(db,TENANT,jpegBytes(10),'image/png');
  await expect(deleteChatImage(db,TENANT,id)).resolves.toBe(true);
  await expect(getChatImages(db,TENANT,[id])).resolves.toEqual([]);
 });
 it('enforces the 90-day retention window on upload',async()=>{
  const {db,calls}=mockDb();
  await saveChatImage(db,TENANT,jpegBytes(10),'image/jpeg');
  const cleanup=calls.find(c=>c.sql.startsWith('DELETE FROM mayor_chat_images WHERE tenant_id=? AND created_at<?'));
  expect(cleanup).toBeDefined();
  const cutoff=cleanup!.bound[1] as number;
  const ninetyDaysMs=IMAGE_UPLOAD.retentionDays*86400000;
  expect(Date.now()-cutoff).toBeGreaterThan(ninetyDaysMs-60000);
  expect(Date.now()-cutoff).toBeLessThan(ninetyDaysMs+60000);
 });
});

describe('visionInstruction',()=>{
 it('grounds the prompt in the vertical vocabulary',()=>{
  const text=visionInstruction({vertical:'salon'},'is this color lifting evenly?');
  expect(text).toContain('client');
  expect(text).toContain('appointment');
  expect(text).toContain('color lift');
 });
 it('carries the hard honesty rule',()=>{
  const text=visionInstruction({vertical:'restaurant'},'does this plating look right?');
  expect(text.toLowerCase()).toContain('never invent');
  expect(text).toContain("I can't tell from this photo");
  expect(text).toContain('plating');
 });
 it('uses plumbing framing for the plumbing vertical',()=>{
  const text=visionInstruction({vertical:'plumbing_hvac'},'is this corrosion?');
  expect(text).toContain('corrosion');
 });
 it('answers in Spanish when profile language is es',()=>{
  const text=visionInstruction({vertical:'salon',language:'es'},'¿está parejo el color?');
  expect(text).toContain('español');
  expect(text).toContain('nunca invente');
  expect(text).not.toContain('HONESTY RULE');
 });
 it('defaults to English when language is absent',()=>{
  expect(resolveImageLanguage(undefined)).toBe('en');
  expect(resolveImageLanguage('fr')).toBe('en');
  const text=visionInstruction({vertical:'salon'},'is this even?');
  expect(text).toContain('Reply in English');
 });
});

describe('vision model choice',()=>{
 it('uses a vision-capable Workers AI model, not the text-only qwen',()=>{
  expect(MAYOR_VISION_MODEL).toBe('@cf/meta/llama-3.2-11b-vision-instruct');
  expect(MAYOR_VISION_MODEL).not.toContain('qwen');
 });
});

function visionEnv(replyText:string){
 const seen:{model:string;input:unknown}[]=[];
 const env={
  AI:{run:async(model:string,input:unknown)=>{
   seen.push({model,input});
   return {choices:[{message:{content:replyText}}]};
  }},
 } as unknown as Parameters<typeof runVisionTurn>[0];
 return {env,seen};
}

describe('runVisionTurn',()=>{
 it('sends image_url parts through the gateway path and extracts text',async()=>{
  const {env,seen}=visionEnv('The color is lifting evenly.');
  const text=await runVisionTurn(env,[{contentType:'image/jpeg',bytes:jpegBytes(50)}],'Look at this.');
  expect(text).toBe('The color is lifting evenly.');
  expect(seen).toHaveLength(1);
  expect(seen[0].model).toBe(MAYOR_VISION_MODEL);
  const content=(seen[0].input as {messages:{content:unknown[]}[]}).messages[0].content;
  const imagePart=content.find(p=>(p as {type?:string}).type==='image_url') as {image_url:{url:string}};
  expect(imagePart.image_url.url.startsWith('data:image/jpeg;base64,')).toBe(true);
 });
 it('returns null when there are no images',async()=>{
  const {env}=visionEnv('x');
  await expect(runVisionTurn(env,[],'Look.')).resolves.toBeNull();
 });
});

describe('describeAttachedImages',()=>{
 it('appends the vision observation for the turn',async()=>{
  const {env}=visionEnv('I see even lift, no banding.');
  const block=await describeAttachedImages(env,{vertical:'salon'},'is this even? ',[{id:'a',contentType:'image/jpeg',bytes:jpegBytes(10)}]);
  expect(block).toContain('I see even lift, no banding.');
  expect(block).toContain('Photo observation');
 });
 it('fails soft: never claims to have seen a photo vision could not read',async()=>{
  const env={AI:{run:async()=>{throw new Error('boom');}}} as unknown as Parameters<typeof runVisionTurn>[0];
  const block=await describeAttachedImages(env,{vertical:'salon'},'is this even?',[{id:'a',contentType:'image/jpeg',bytes:jpegBytes(10)}]);
  expect(block).toContain('could not be analyzed');
  expect(block).toContain('Do NOT claim to have seen it');
 });
 it('returns empty when no photos are attached',async()=>{
  const {env}=visionEnv('x');
  await expect(describeAttachedImages(env,{},'hello',[])).resolves.toBe('');
 });
 it('keeps the honesty instruction on the vision-failure path',async()=>{
  const env={AI:{run:async()=>{throw new Error('boom');}}} as unknown as Parameters<typeof runVisionTurn>[0];
  const block=await describeAttachedImages(env,{vertical:'restaurant',language:'es'},'¿se ve bien?',[{id:'a',contentType:'image/png',bytes:jpegBytes(10)}]);
  expect(block).not.toContain('plating looks');
 });
});
