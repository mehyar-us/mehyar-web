import {z} from 'zod';
import type {Env} from './env';
import {providerConfigured,type AuthEnv} from './auth/capabilities';
import {listGuides,guideForService,genericConnectorGuide,type ConnectorGuide,type OAuthProviderId} from './connector-guides';

/**
 * One Connector recipes (design: one-connector-design.md, 2026-10-15).
 * A recipe is DECLARATIVE DATA the engine interprets — ranked connect
 * methods, what to capture, how to verify. Recipes never contain code;
 * the learning loop (Phase 2) writes new ones into connector_recipes and
 * they merge over these builtins by service.
 */

export interface CaptureSpec{label:string;hint:string}
export interface HttpCheck{method:'GET';url:string;auth:'bearer'}
export type FailureKind='bad_credential'|'insufficient_scope'|'method_removed'|'platform_gate'|'network'|'owner_abandoned'|'unknown';
export type ConnectMethod=
 |{kind:'oauth';provider:OAuthProviderId}
 |{kind:'api_key';capture:CaptureSpec;apiBase?:string;verify?:HttpCheck}
 |{kind:'webhook';capture:CaptureSpec}
 |{kind:'mcp';capture:CaptureSpec}
 |{kind:'assisted';steps:string[];note?:string};
export interface ConnectorRecipe{
 service:string;name:string;aliases:string[];capabilities:string[];unlocks:string;
 methods:ConnectMethod[];platformGate?:string;source:'builtin'|'learned'|'generic';version:number;
 /** Learned recipes only: 'draft' until the first verified live connection
  * promotes them (Phase 2). Row metadata — never part of the stored JSON. */
 learnedState?:'draft'|'promoted';
}

/** Semantic capability tags per service (mirrors connections.ts so a
 * vertical's priority can name capabilities, not providers). */
const CAPABILITY_TAGS:Record<string,string[]>={
 google:['calendar','email'],
 google_business:['reviews','social'],
 microsoft:['calendar'],
 zoho:['calendar'],
 square:['payments','bookings'],
 stripe:['payments'],
 vagaro:['bookings'],
 booksy:['bookings'],
 fresha:['bookings'],
};

const ALIASES:Record<string,string[]>={
 square:['squareup','square pos'],stripe:['stripe payments'],
 google_business:['gbp','google business profile','google reviews'],google:['gmail','google calendar'],
 microsoft:['outlook','office 365','microsoft 365'],zoho:['zoho crm','zoho calendar'],
 vagaro:[],booksy:[],fresha:[],
};

/** Read-only verify checks for platforms whose API shape is known. The
 * engine runs these THROUGH the attached custom connection (the secret
 * never leaves that module); the check documents what a pass means. */
const KNOWN_VERIFY:Record<string,HttpCheck>={
 square:{method:'GET',url:'https://connect.squareup.com/v2/locations',auth:'bearer'},
 stripe:{method:'GET',url:'https://api.stripe.com/v1/account',auth:'bearer'},
};

export function recipeFromGuide(guide:ConnectorGuide):ConnectorRecipe{
 const methods:ConnectMethod[]=[];
 if(guide.authKind==='oauth'&&guide.oauthProvider){
  methods.push({kind:'oauth',provider:guide.oauthProvider});
 }else if(guide.authKind==='api_key'){
  methods.push({kind:'api_key',
   capture:{label:`${guide.name} API key`,hint:`In ${guide.name}, open developer/API settings and create a key for The Mayor.`},
   apiBase:guide.apiBase,verify:KNOWN_VERIFY[guide.service]});
 }
 // Every recipe ends at assisted: a human-guided path always exists.
 methods.push({kind:'assisted',steps:guide.steps,note:guide.note});
 return {
  service:guide.service,name:guide.name,aliases:ALIASES[guide.service]??[],
  capabilities:CAPABILITY_TAGS[guide.service]??[],unlocks:guide.unlocks,
  methods,source:'builtin',version:1,
 };
}

export const BUILTIN_RECIPES:ConnectorRecipe[]=listGuides().map(recipeFromGuide);

/** The recipe for a service we have no guide for: assisted-only, generic. */
export function genericRecipe(serviceName:string):ConnectorRecipe{
 const guide=genericConnectorGuide(serviceName);
 const recipe=recipeFromGuide(guide);
 return {...recipe,service:serviceName.trim().toLowerCase().replace(/[^a-z0-9]+/g,'-').slice(0,40)||'unknown',source:'generic'};
}

const methodSchema:z.ZodType<ConnectMethod>=z.lazy(()=>z.union([
 z.object({kind:z.literal('oauth'),provider:z.enum(['google','microsoft','zoho'])}),
 z.object({kind:z.literal('api_key'),capture:z.object({label:z.string().max(120),hint:z.string().max(300)}),apiBase:z.string().url().max(300).optional(),verify:z.object({method:z.literal('GET'),url:z.string().url().max(300),auth:z.literal('bearer')}).optional()}),
 z.object({kind:z.literal('webhook'),capture:z.object({label:z.string().max(120),hint:z.string().max(300)})}),
 z.object({kind:z.literal('mcp'),capture:z.object({label:z.string().max(120),hint:z.string().max(300)})}),
 z.object({kind:z.literal('assisted'),steps:z.array(z.string().max(300)).max(12),note:z.string().max(300).optional()}),
]));
export const recipeSchema:z.ZodType<ConnectorRecipe>=z.lazy(()=>z.object({
 service:z.string().min(1).max(60),name:z.string().min(1).max(80),
 aliases:z.array(z.string().max(60)).max(12),capabilities:z.array(z.string().max(40)).max(8),
 unlocks:z.string().max(300),methods:z.array(methodSchema).min(1).max(6),
 platformGate:z.string().max(300).optional(),source:z.enum(['builtin','learned','generic']),version:z.number().int().min(1),
}));

/** All recipes: builtins, with learned DB recipes merged over by service. */
export async function listRecipes(env:Pick<Env,'AGENT_DB'>):Promise<ConnectorRecipe[]>{
 const byService=new Map(BUILTIN_RECIPES.map(r=>[r.service,r]));
 try{
  const rows=await env.AGENT_DB.prepare('SELECT service,recipe_json,state FROM connector_recipes').all<{service:string;recipe_json:string;state?:string}>();
  for(const row of rows.results??[]){
   try{
    const parsed=recipeSchema.parse(JSON.parse(row.recipe_json));
    if(parsed.source==='learned')parsed.learnedState=row.state==='draft'?'draft':'promoted';
    byService.set(parsed.service,parsed);
   }catch{/* a malformed learned recipe never breaks the catalog */}
  }
 }catch{/* table not migrated yet: builtins only */}
 return [...byService.values()];
}

export async function getRecipe(env:Pick<Env,'AGENT_DB'>,service:string):Promise<ConnectorRecipe|null>{
 const all=await listRecipes(env);
 return all.find(r=>r.service===service)??null;
}

/** One-click means the owner taps once and signs in — an OAuth method on a
 * configured provider. Everything else (paste a key, follow steps) is not,
 * and the engine prefers one-click ways first (Mayor's order, 2026-10-15). */
export function isOneClick(env:AuthEnv,method:ConnectMethod):boolean{
 return method.kind==='oauth'&&providerConfigured(env,method.provider);
}

export {guideForService};
