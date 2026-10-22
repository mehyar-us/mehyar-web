/**
 * Crew 7 Growth Engine — integration wiring.
 *
 * All six workstreams (7a social connectors, 7b content calendar, 7c post
 * generation, 7d image generation, 7e video studio, 7f ad generation) were
 * built in isolated file areas and export handler/registrar functions.
 * This module wires them into the worker's manual-regex dispatch in
 * src/index.ts with a single call: handleGrowthRequest(request, env, actor).
 *
 * Safety invariants (do not weaken):
 * - Nothing publishes to a public channel without explicit owner approval.
 * - Nothing spends money, launches campaigns, or calls Meta Ads APIs.
 * - IG/FB publish stays test-gated until Meta App Review clears.
 * - Every handler is tenant-scoped and returns null for non-matching paths.
 */
import type {Env,Actor} from './env';
import {handleSocialRequest} from './social/index';
import {GROWTH_CALENDAR_ROUTES} from './growth-calendar';
import {registerPostgenRoutes,type PostgenHandler,type PostgenContext} from './postgen';
import {registerImagegenRoutes} from './imagegen';
import {handleVideogenRequest} from './videogen';
import {handleAdgenRequest} from './adgen';
import {runDuePosts} from './growth-calendar';

/** Convert a `:param` path template to a RegExp with named capture info. */
function pathToPattern(template:string):{pattern:RegExp;names:string[]}{
 const names:string[]=[];
 const source=template.replace(/:[a-zA-Z_]+/g,(name)=>{
  names.push(name.slice(1));
  return name===':tenantId'?'([a-f0-9]{32})':'([^/]+)';
 });
 return {pattern:new RegExp(`^${source}$`),names};
}

interface MiniRoute{method:string;pattern:RegExp;names:string[];handler:PostgenHandler;}

function buildPostgenRoutes():MiniRoute[]{
 const routes:MiniRoute[]=[];
 const add=(method:string,path:string,handler:PostgenHandler)=>{
  const {pattern,names}=pathToPattern(`/api/businesses/:tenantId/postgen${path}`);
  routes.push({method,pattern,names,handler});
 };
 registerPostgenRoutes({
  get:(path,handler)=>add('GET',path,handler),
  post:(path,handler)=>add('POST',path,handler),
  delete:(path,handler)=>add('DELETE',path,handler),
 });
 return routes;
}

interface ImagegenRoute{method:string;pattern:RegExp;handler:(request:Request,env:Env,actor:Actor)=>Promise<Response>;}

function buildImagegenRoutes():ImagegenRoute[]{
 const routes:ImagegenRoute[]=[];
 const add=(method:string,path:string,handler:(request:Request,env:Env,actor:Actor)=>Promise<Response>)=>{
  const {pattern}=pathToPattern(path);
  routes.push({method,pattern,handler});
 };
 registerImagegenRoutes({
  post:(path,handler)=>add('POST',path,handler),
  get:(path,handler)=>add('GET',path,handler),
  delete:(path,handler)=>add('DELETE',path,handler),
 });
 return routes;
}

const postgenRoutes=buildPostgenRoutes();
const imagegenRoutes=buildImagegenRoutes();

function paramsFrom(names:string[],match:RegExpMatchArray):Record<string,string>{
 const params:Record<string,string>={};
 names.forEach((name,i)=>{params[name]=match[i+1];});
 return params;
}

/**
 * Try every Growth Engine handler in order. Returns a Response when a
 * workstream claims the request, null when none match (caller continues).
 * Must be called inside the authenticated /api/businesses/:tenantId block —
 * every handler re-verifies actor.tenantId itself.
 */
export async function handleGrowthRequest(request:Request,env:Env,actor:Actor):Promise<Response|null>{
 // 7a — social connectors (publish test-gated until App Review clears).
 const social=await handleSocialRequest(request,env,actor);
 if(social)return social;
 // 7e — video studio (job lifecycle; worker never generates video itself).
 const video=await handleVideogenRequest(request,env,actor);
 if(video)return video;
 // 7f — ad drafts (never spends; zero Meta API calls).
 const ads=await handleAdgenRequest(request,env,actor);
 if(ads)return ads;
 const url=new URL(request.url);
 // 7b — content calendar (regex table; approval enforced at send time too).
 for(const def of GROWTH_CALENDAR_ROUTES){
  if(def.method!==request.method)continue;
  const match=url.pathname.match(def.pattern);
  if(!match)continue;
  if(match[1]!==actor.tenantId)return null;
  const ctx:{request:Request;url:URL;env:Env;userId:string;params:{tenantId:string;postId?:string;seriesId?:string}}={
   request,url,env,userId:actor.userId,
   params:{tenantId:match[1],postId:match[2],seriesId:match[2]},
  };
  return def.handle(ctx);
 }
 // 7c — post drafts (generation only; nothing publishes from here).
 for(const route of postgenRoutes){
  if(route.method!==request.method)continue;
  const match=url.pathname.match(route.pattern);
  if(!match)continue;
  const params=paramsFrom(route.names,match);
  if(params.tenantId!==actor.tenantId)return null;
  const ctx:PostgenContext={env,actor};
  return route.handler(request,params,ctx);
 }
 // 7d — image generation (test-gated; binaries not persisted without R2).
 for(const route of imagegenRoutes){
  if(route.method!==request.method)continue;
  if(!url.pathname.match(route.pattern))continue;
  return route.handler(request,env,actor);
 }
 return null;
}

/**
 * Cron entry for due social posts. Safe to call on every scheduled tick:
 * runDuePosts is idempotent, approval-gated, and test-gated (never writes
 * status='sent' unless a live adapter actually published).
 */
export async function runGrowthDuePosts(env:Env):Promise<void>{
 try{
  const summary=await runDuePosts(env);
  console.log(JSON.stringify({event:'growth_due_posts',...summary}));
 }catch(error){
  console.error(JSON.stringify({event:'growth_due_posts_failed',error:String(error).slice(0,200)}));
 }
}
