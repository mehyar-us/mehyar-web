import {describe,it,expect} from 'vitest';
import {BUILTIN_RECIPES,recipeFromGuide,genericRecipe,recipeSchema} from '../src/connector-recipes';
import {listGuides,guideForService} from '../src/connector-guides';

/* One Connector recipes (2026-10-15): the catalog is declarative data
 * seeded from the existing connector guides. These tests pin the shape
 * every recipe must keep: schema-valid, methods ranked, and ALWAYS an
 * assisted final method — a human-guided path exists for everything. */

describe('builtin recipe catalog',()=>{
 it('has one recipe per guide, each schema-valid with an assisted last resort',()=>{
  expect(BUILTIN_RECIPES).toHaveLength(listGuides().length);
  expect(BUILTIN_RECIPES.length).toBeGreaterThanOrEqual(9);
  for(const recipe of BUILTIN_RECIPES){
   expect(()=>recipeSchema.parse(recipe)).not.toThrow();
   expect(recipe.methods.length).toBeGreaterThanOrEqual(1);
   expect(recipe.methods[recipe.methods.length-1].kind).toBe('assisted');
   expect(recipe.source).toBe('builtin');
  }
 });
 it('maps oauth guides to an oauth method on the right provider',()=>{
  for(const service of ['google','google_business','microsoft','zoho']){
   const recipe=BUILTIN_RECIPES.find(r=>r.service===service)!;
   const guide=guideForService(service)!;
   expect(recipe.methods[0]).toEqual({kind:'oauth',provider:guide.oauthProvider});
  }
 });
 it('gives Square and Stripe their known read-only verify checks',()=>{
  const square=BUILTIN_RECIPES.find(r=>r.service==='square')!;
  const stripe=BUILTIN_RECIPES.find(r=>r.service==='stripe')!;
  for(const recipe of [square,stripe]){
   const method=recipe.methods[0];
   expect(method.kind).toBe('api_key');
   if(method.kind==='api_key'){
    expect(method.verify?.method).toBe('GET');
    expect(method.verify?.auth).toBe('bearer');
    expect(method.verify?.url).toMatch(/^https:\/\//);
   }
  }
 });
 it('request-access guides (Vagaro, Booksy, Fresha) are assisted-only — honestly',()=>{
  for(const service of ['vagaro','booksy','fresha']){
   const recipe=BUILTIN_RECIPES.find(r=>r.service===service)!;
   expect(recipe.methods.map(m=>m.kind)).toEqual(['assisted']);
  }
 });
 it('recipeFromGuide preserves the guide unlocks copy',()=>{
  for(const guide of listGuides()){
   expect(recipeFromGuide(guide).unlocks).toBe(guide.unlocks);
  }
 });
});

describe('generic recipe for unknown platforms',()=>{
 it('is generic-sourced and laddered api_key (owner-supplied endpoint) then assisted',()=>{
  const recipe=genericRecipe('Fancy CRM 3000');
  expect(recipe.source).toBe('generic');
  expect(recipe.service).toBe('fancy-crm-3000');
  expect(recipe.methods.map(m=>m.kind)).toEqual(['api_key','assisted']);
  expect(()=>recipeSchema.parse(recipe)).not.toThrow();
 });
});
