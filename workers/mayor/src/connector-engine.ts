import {z} from 'zod';
import type {Actor,Env} from './env';
import {providerConfigured,grantedCapabilities} from './auth/capabilities';
import {checkCustomConnection,listCustomConnections} from './custom-connectors';
import {resolveConnectorService} from './connector-guides';
import {OPERATORS,requireMembership} from './permissions';
import {HttpError,json,readJson} from './http';
import {getRecipe,genericRecipe,listRecipes,isOneClick,type ConnectorRecipe,type ConnectMethod,type FailureKind} from './connector-recipes';

/**
 * One Connector engine (design: one-connector-design.md, 2026-10-15).
 * ONE state machine connects a business to anything:
 *   offered -> capturing -> verifying -> connected
 *   a failed method records its failure kind and walks DOWN the recipe's
 *   ranked method list; exhausting the list is 'gave_up'. A connection
 *   counts only when verification passes against the REAL stores: OAuth
 *   grants in auth_provider_grants, credentials via the custom-connector
 *   module's own check (secrets never leave that module), or the owner's
 *   explicit confirmation for an assisted method.
 */

export type SessionState='offered'|'capturing'|'verifying'|'connected'|'gave_up';
interface SessionRow{id:string;tenant_id:string;service:string;method_index:number;method_kind:string;state:SessionState;failure_kind:string|null;connection_id:string|null;created_at:number;updated_at:number}

const FAILURE_KINDS:readonly FailureKind[]=['bad_credential','insufficient_scope','method_removed','platform_gate','network','owner_abandoned','unknown'];

/** First method at/after `from` the owner can actually use right now:
 * an OAuth method counts only when that provider is configured. */
function nextViableIndex(env:Env,recipe:ConnectorRecipe,from:number):number{
 for(let i=from;i<recipe.methods.length;i++){
  const method=recipe.methods[i];
  if(method.kind==='oauth'&&!providerConfigured(env,method.provider))continue;
  return i;
 }
 return -1;
}

async function recordEvent(env:Env,tenantId:string,service:string,version:number,outcome:string,failureKind?:FailureKind,methodKind?:string){
 // Telemetry must never break the owner's connect flow.
 try{
  await env.AGENT_DB.prepare('INSERT INTO connector_recipe_events(tenant_id,service,version,outcome,failure_kind,method_kind,created_at) VALUES(?,?,?,?,?,?,?)')
   .bind(tenantId,service,version,outcome,failureKind??null,methodKind??null,Date.now()).run();
 }catch{/* table not migrated yet */}
}

/** Queue a platform for the crew's docs-research pass (the learning loop's
 * input). Deduped while a request is open. Never breaks the connect flow. */
async function enqueueResearch(env:Env,tenantId:string,service:string,reason:'unknown_platform'|'method_removed'){
 try{
  const now=Date.now();
  await env.AGENT_DB.prepare(`INSERT INTO connector_research_requests(id,service,reason,status,tenant_id,created_at,updated_at)
   SELECT ?,?,?, 'queued', ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM connector_research_requests WHERE service=? AND status IN ('queued','researched'))`)
   .bind(crypto.randomUUID(),service,reason,tenantId,now,now,service).run();
 }catch{/* table not migrated yet */}
}

/** A draft learned recipe whose NON-assisted method just verified live is
 * promoted into the shared catalog (design §6.4). Assisted success proves
 * nothing about the platform's API, so it never promotes. */
async function promoteRecipeIfDraft(env:Env,row:SessionRow,recipe:ConnectorRecipe){
 if(recipe.source!=='learned'||recipe.learnedState!=='draft')return;
 try{
  await env.AGENT_DB.prepare("UPDATE connector_recipes SET state='promoted',updated_at=? WHERE service=? AND state='draft'")
   .bind(Date.now(),recipe.service).run();
  recipe.learnedState='promoted';
  await recordEvent(env,row.tenant_id,row.service,recipe.version,'recipe_promoted');
 }catch{/* promotion is bookkeeping; the connection itself already succeeded */}
}

/** Fleet evidence per method kind for one service, across all businesses
 * and versions: how often each way actually completed a connection. */
type FleetStats=Map<string,{successes:number,failures:number}>;
async function methodFleetStats(env:Env,service:string):Promise<FleetStats>{
 const stats:FleetStats=new Map();
 try{
  const rows=await env.AGENT_DB.prepare("SELECT method_kind,outcome,COUNT(*) AS n FROM connector_recipe_events WHERE service=? AND method_kind IS NOT NULL AND outcome IN ('connected','method_failed') GROUP BY method_kind,outcome")
   .bind(service).all<{method_kind:string;outcome:string;n:number}>();
  for(const r of rows.results??[]){
   const entry=stats.get(r.method_kind)??{successes:0,failures:0};
   if(r.outcome==='connected')entry.successes=r.n;else entry.failures=r.n;
   stats.set(r.method_kind,entry);
  }
 }catch{/* no telemetry yet */}
 return stats;
}

/** The Mayor's ordering (2026-10-15): one-click ways first; among equals,
 * the way the fleet has connected with most is the way that stays. */
function orderCompare(env:Env,stats:FleetStats,a:ConnectMethod,b:ConnectMethod,ia:number,ib:number):number{
 const oneClick=(isOneClick(env,a)?0:1)-(isOneClick(env,b)?0:1);
 if(oneClick)return oneClick;
 const sa=stats.get(a.kind)?.successes??0,sb=stats.get(b.kind)?.successes??0;
 if(sa!==sb)return sb-sa;
 return ia-ib;
}

/** The method a new session should start on: the best viable way by the
 * ordering above (an unconfigured OAuth provider is not viable). */
function preferredMethodIndex(env:Env,recipe:ConnectorRecipe,stats:FleetStats):number{
 let best=-1;
 for(let i=0;i<recipe.methods.length;i++){
  const method=recipe.methods[i];
  if(method.kind==='oauth'&&!providerConfigured(env,method.provider))continue;
  if(best<0||orderCompare(env,stats,method,recipe.methods[best],i,best)<0)best=i;
 }
 return best;
}

/** Persist the fleet's winning order into the catalog so it STAYS: real
 * methods reorder by the ordering above (assisted is the human fallback
 * and stays last — it is not a platform method). A reorder persists only
 * when the new top way is one-click, or beats the old top by real volume
 * (5+ successes and a margin of 2) — no flapping on noise. */
async function persistFleetOrder(env:Env,tenantId:string,recipe:ConnectorRecipe,stats:FleetStats):Promise<ConnectorRecipe|null>{
 const real=recipe.methods.filter(m=>m.kind!=='assisted');
 if(real.length<2)return null;
 const sorted=[...real].sort((a,b)=>orderCompare(env,stats,a,b,recipe.methods.indexOf(a),recipe.methods.indexOf(b)));
 const ordered=[...sorted,...recipe.methods.filter(m=>m.kind==='assisted')];
 if(ordered.every((m,i)=>sameMethod(m,recipe.methods[i])))return null;
 const newSuccesses=stats.get(sorted[0].kind)?.successes??0;
 const oldSuccesses=stats.get(real[0].kind)?.successes??0;
 if(!isOneClick(env,sorted[0])&&!(newSuccesses>=5&&newSuccesses>=oldSuccesses+2))return null;
 let state=recipe.learnedState??'promoted';
 try{
  const row=await env.AGENT_DB.prepare('SELECT state FROM connector_recipes WHERE service=?').bind(recipe.service).first<{state:string}>();
  if(row?.state==='draft'||row?.state==='promoted')state=row.state;
  const stored:Record<string,unknown>={...recipe,methods:ordered,version:recipe.version+1};delete stored.learnedState;
  await env.AGENT_DB.prepare(`INSERT INTO connector_recipes(service,recipe_json,source,version,updated_at,state) VALUES(?,?,?,?,?,?)
   ON CONFLICT(service) DO UPDATE SET recipe_json=excluded.recipe_json,version=excluded.version,updated_at=excluded.updated_at,state=excluded.state`)
   .bind(recipe.service,JSON.stringify(stored),recipe.source,recipe.version+1,Date.now(),state).run();
 }catch{return null;}
 const revised:ConnectorRecipe={...recipe,methods:ordered,version:recipe.version+1};
 await recordEvent(env,tenantId,recipe.service,revised.version,'recipe_revised');
 return revised;
}

function publicMethod(env:Env,method:ConnectMethod){
 // Methods are declarative and secret-free by construction.
 return {...method,oneClick:isOneClick(env,method)};
}

function sessionView(env:Env,row:SessionRow,recipe:ConnectorRecipe){
 const method=recipe.methods[row.method_index];
 return {
  id:row.id,service:row.service,name:recipe.name,source:recipe.source,
  state:row.state,method:method?publicMethod(env,method):null,
  methodIndex:row.method_index,methodsTotal:recipe.methods.length,
  failureKind:row.failure_kind,connectionId:row.connection_id,
  unlocks:recipe.unlocks,platformGate:recipe.platformGate??null,
  firstAttempt:recipe.learnedState==='draft',
  createdAt:row.created_at,updatedAt:row.updated_at,
 };
}

async function ownedSession(env:Env,actor:Actor,id:string):Promise<SessionRow>{
 const row=await env.AGENT_DB.prepare('SELECT * FROM mayor_connector_sessions WHERE id=? AND tenant_id=?')
  .bind(z.uuid().parse(id),actor.tenantId).first<SessionRow>();
 if(!row)throw new HttpError(404,'session_not_found','That connection attempt could not be found.');
 return row;
}

async function recipeFor(env:Env,row:SessionRow):Promise<ConnectorRecipe>{
 return (await getRecipe(env,row.service))??genericRecipe(row.service);
}

async function updateSession(env:Env,row:SessionRow,patch:Partial<SessionRow>):Promise<SessionRow>{
 const next={...row,...patch,updated_at:Date.now()};
 await env.AGENT_DB.prepare('UPDATE mayor_connector_sessions SET method_index=?,method_kind=?,state=?,failure_kind=?,connection_id=?,updated_at=? WHERE id=? AND tenant_id=?')
  .bind(next.method_index,next.method_kind,next.state,next.failure_kind,next.connection_id,next.updated_at,row.id,row.tenant_id).run();
 return next;
}

function sameMethod(a:ConnectMethod,b:ConnectMethod):boolean{
 return a.kind===b.kind&&(a.kind!=='oauth'||(a as {provider:string}).provider===(b as {provider:string}).provider);
}

/** Learning-loop revision (design §6.5): a LEARNED recipe method that keeps
 * failing (3+ failures and more failures than successes at this version)
 * is demoted to just above the assisted last resort, and the version
 * bumps. Builtins never self-revise — a human ships those. Returns the
 * revised recipe, or null when no revision is warranted. */
async function maybeDemoteMethod(env:Env,row:SessionRow,recipe:ConnectorRecipe,failed:ConnectMethod):Promise<ConnectorRecipe|null>{
 if(recipe.source!=='learned')return null;
 let failures=0,successes=0;
 try{
  const counts=await env.AGENT_DB.prepare("SELECT outcome,COUNT(*) AS n FROM connector_recipe_events WHERE service=? AND version=? AND method_kind=? AND outcome IN ('method_failed','connected') GROUP BY outcome")
   .bind(recipe.service,recipe.version,failed.kind).all<{outcome:string;n:number}>();
  for(const c of counts.results??[]){if(c.outcome==='method_failed')failures=c.n;else successes=c.n;}
 }catch{return null;}
 if(failures<3||failures<=successes)return null;
 const from=recipe.methods.findIndex(m=>sameMethod(m,failed));
 if(from<0)return null;
 const landing=recipe.methods[recipe.methods.length-1]?.kind==='assisted'?recipe.methods.length-2:recipe.methods.length-1;
 if(from>=landing)return null;
 const methods=[...recipe.methods];
 const [moved]=methods.splice(from,1);
 methods.splice(landing,0,moved);
 const revised:ConnectorRecipe={...recipe,methods,version:recipe.version+1};
 try{
  const stored:Record<string,unknown>={...revised};delete stored.learnedState;
  await env.AGENT_DB.prepare('UPDATE connector_recipes SET recipe_json=?,version=?,updated_at=? WHERE service=?')
   .bind(JSON.stringify(stored),revised.version,Date.now(),recipe.service).run();
 }catch{return null;}
 await recordEvent(env,row.tenant_id,recipe.service,revised.version,'recipe_revised');
 return revised;
}

/** Record a method failure and walk down to the next viable method. */
async function advanceAfterFailure(env:Env,row:SessionRow,recipe:ConnectorRecipe,kind:FailureKind):Promise<SessionRow>{
 const failed=recipe.methods[row.method_index];
 await recordEvent(env,row.tenant_id,row.service,recipe.version,'method_failed',kind,failed?.kind);
 if(kind==='method_removed')await enqueueResearch(env,row.tenant_id,row.service,'method_removed');
 let current=recipe;
 if(failed){const revised=await maybeDemoteMethod(env,row,recipe,failed);if(revised)current=revised;}
 const failedAt=failed?current.methods.findIndex(m=>sameMethod(m,failed)):row.method_index;
 const next=nextViableIndex(env,current,failedAt+1);
 if(next>=0){
  return updateSession(env,row,{method_index:next,method_kind:current.methods[next].kind,state:'offered',failure_kind:kind,connection_id:null});
 }
 await recordEvent(env,row.tenant_id,row.service,current.version,'gave_up',kind,failed?.kind);
 return updateSession(env,row,{state:'gave_up',failure_kind:kind});
}

function failureKindFor(err:unknown):FailureKind{
 if(err instanceof HttpError){
  // The custom-connector module reports provider rejections under its own
  // code; a rejection from the platform is, in practice, the credential.
  if(err.code==='connection_provider_rejected')return 'bad_credential';
  if(err.code==='connection_transport_unknown'||err.code==='connection_redirect_refused'||err.code==='connection_response_too_large')return 'network';
  if(err.status===401||err.status===403)return 'bad_credential';
  if(err.status>=500)return 'network';
  return 'unknown';
 }
 return 'network';
}

export async function startConnectorSession(env:Env,actor:Actor,rawService:unknown){
 await requireMembership(env,actor,OPERATORS);
 const input=z.object({service:z.string().trim().min(1).max(80)}).strict().parse(rawService);
 const canonical=resolveConnectorService(input.service);
 let recipe=canonical?await getRecipe(env,canonical):null;
 if(!recipe){
  // A learned recipe may be the ONLY trace of a platform (it was never a
  // builtin guide) — search the merged catalog by service, name, alias.
  const q=input.service.trim().toLowerCase();
  const all=await listRecipes(env);
  recipe=all.find(r=>r.service===q||r.name.toLowerCase()===q||r.aliases.some(a=>a.toLowerCase()===q))??null;
 }
 if(!recipe)recipe=genericRecipe(canonical??input.service);
 // Fleet ordering (Mayor, 2026-10-15): start on the way that connects —
 // one-click first, then the way the most businesses connected with —
 // and persist a proven new order into the catalog so it stays.
 const stats=await methodFleetStats(env,recipe.service);
 const revised=await persistFleetOrder(env,actor.tenantId,recipe,stats);
 if(revised)recipe=revised;
 const index=preferredMethodIndex(env,recipe,stats);
 if(index<0)throw new HttpError(422,'no_method_available',`There is no way to connect ${recipe.name} right now.`);
 const now=Date.now();
 const row:SessionRow={id:crypto.randomUUID(),tenant_id:actor.tenantId,service:recipe.service,
  method_index:index,method_kind:recipe.methods[index].kind,state:'offered',failure_kind:null,
  connection_id:null,created_at:now,updated_at:now};
 await env.AGENT_DB.prepare('INSERT INTO mayor_connector_sessions(id,tenant_id,service,method_index,method_kind,state,failure_kind,connection_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
  .bind(row.id,row.tenant_id,row.service,row.method_index,row.method_kind,row.state,row.failure_kind,row.connection_id,row.created_at,row.updated_at).run();
 await recordEvent(env,actor.tenantId,recipe.service,recipe.version,'session_started',undefined,row.method_kind);
 // A platform the catalog doesn't know queues a docs-research pass — the
 // owner's generic flow proceeds meanwhile; the learned recipe replaces
 // it for the next business (design §6).
 if(recipe.source==='generic')await enqueueResearch(env,actor.tenantId,recipe.service,'unknown_platform');
 return sessionView(env,row,recipe);
}

export async function listConnectorSessions(env:Env,actor:Actor){
 await requireMembership(env,actor,OPERATORS);
 const rows=await env.AGENT_DB.prepare('SELECT * FROM mayor_connector_sessions WHERE tenant_id=? ORDER BY updated_at DESC LIMIT 25')
  .bind(actor.tenantId).all<SessionRow>();
 const recipes=await listRecipes(env);
 const byService=new Map(recipes.map(r=>[r.service,r]));
 return {sessions:(rows.results??[]).map(row=>sessionView(env,row,byService.get(row.service)??genericRecipe(row.service)))};
}

export async function beginConnectorSession(env:Env,actor:Actor,id:string){
 await requireMembership(env,actor,OPERATORS);
 const row=await ownedSession(env,actor,id);
 const recipe=await recipeFor(env,row);
 if(row.state==='capturing')return sessionView(env,row,recipe);
 if(row.state!=='offered')throw new HttpError(409,'session_not_offered','This connection attempt is no longer waiting to start.');
 const next=await updateSession(env,row,{state:'capturing'});
 return sessionView(env,next,recipe);
}

export async function attachConnectorConnection(env:Env,actor:Actor,id:string,raw:unknown){
 await requireMembership(env,actor,OPERATORS);
 const row=await ownedSession(env,actor,id);
 const recipe=await recipeFor(env,row);
 const method=recipe.methods[row.method_index];
 if(row.state!=='capturing'||!method||method.kind==='oauth'||method.kind==='assisted'){
  throw new HttpError(409,'attach_not_applicable','This step does not take a saved connection.');
 }
 const input=z.object({connectionId:z.uuid()}).strict().parse(raw);
 // The connection must be one of THIS user's own custom connections.
 const {connections}=await listCustomConnections(env,actor);
 if(!connections.some(c=>c.id===input.connectionId))throw new HttpError(404,'connection_not_found','That saved connection could not be found.');
 const next=await updateSession(env,row,{connection_id:input.connectionId});
 return sessionView(env,next,recipe);
}

/** Verify the current method against the real store. Only a pass connects. */
export async function verifyConnectorSession(env:Env,actor:Actor,id:string,transport:typeof fetch=fetch){
 await requireMembership(env,actor,OPERATORS);
 const row=await ownedSession(env,actor,id);
 const recipe=await recipeFor(env,row);
 const method=recipe.methods[row.method_index];
 if(row.state!=='capturing'||!method)throw new HttpError(409,'session_not_capturing','Start this step before verifying it.');
 await updateSession(env,row,{state:'verifying'});

 if(method.kind==='assisted'){
  // For an assisted method, the owner's verify call IS the confirmation
  // that they completed the guided steps on the platform itself. (It
  // never promotes a draft recipe — see promoteRecipeIfDraft.)
  const next=await updateSession(env,row,{state:'connected'});
  await recordEvent(env,row.tenant_id,row.service,recipe.version,'connected',undefined,method.kind);
  return sessionView(env,next,recipe);
 }

 if(method.kind==='oauth'){
  const grant=await env.AGENT_DB.prepare("SELECT selected_capabilities,granted_scopes FROM auth_provider_grants WHERE tenant_id=? AND user_id=? AND provider=? AND status='authorized'")
   .bind(actor.tenantId,actor.userId,method.provider).first<{selected_capabilities:string;granted_scopes:string}>();
  if(!grant){
   // Not a recipe failure: the owner simply has not finished sign-in yet.
   await updateSession(env,row,{state:'capturing'});
   throw new HttpError(409,'oauth_incomplete',`Finish signing in with ${method.provider} first, then verify.`);
  }
  let capabilities:string[]=[];
  try{capabilities=grantedCapabilities(method.provider,JSON.parse(grant.granted_scopes),JSON.parse(grant.selected_capabilities));}catch{capabilities=[];}
  if(!capabilities.length){
   const next=await advanceAfterFailure(env,row,recipe,'insufficient_scope');
   return sessionView(env,next,recipe);
  }
  const next=await updateSession(env,row,{state:'connected'});
  await recordEvent(env,row.tenant_id,row.service,recipe.version,'connected',undefined,method.kind);
  await promoteRecipeIfDraft(env,row,recipe);
  return sessionView(env,next,recipe);
 }

 // api_key / webhook / mcp: verify runs through the attached custom
 // connection; the secret never leaves the custom-connector module.
 if(!row.connection_id){
  await updateSession(env,row,{state:'capturing'});
  throw new HttpError(409,'connection_required','Save the connection first, then verify.');
 }
 try{
  await checkCustomConnection(env,actor,row.connection_id,transport);
 }catch(err){
  const next=await advanceAfterFailure(env,row,recipe,failureKindFor(err));
  return sessionView(env,next,recipe);
 }
 const next=await updateSession(env,row,{state:'connected'});
 await recordEvent(env,row.tenant_id,row.service,recipe.version,'connected',undefined,method.kind);
 await promoteRecipeIfDraft(env,row,recipe);
 return sessionView(env,next,recipe);
}

/** The UI/owner reports the current method failed; walk down the ladder. */
export async function failConnectorSession(env:Env,actor:Actor,id:string,raw:unknown){
 await requireMembership(env,actor,OPERATORS);
 const row=await ownedSession(env,actor,id);
 const recipe=await recipeFor(env,row);
 if(row.state==='connected'||row.state==='gave_up')throw new HttpError(409,'session_finished','This connection attempt is already finished.');
 const input=z.object({kind:z.enum(FAILURE_KINDS)}).strict().parse(raw);
 const next=await advanceAfterFailure(env,row,recipe,input.kind);
 return sessionView(env,next,recipe);
}

export async function handleConnectorEngineRequest(request:Request,env:Env,actor:Actor):Promise<Response|null>{
 const url=new URL(request.url);
 const base=`/api/businesses/${actor.tenantId}/connector-engine`;
 if(url.pathname===`${base}/recipes`&&request.method==='GET'){
  await requireMembership(env,actor,OPERATORS);
  const recipes=await listRecipes(env);
  const detailed=await Promise.all(recipes.map(async r=>{
   const stats=await methodFleetStats(env,r.service);
   return {service:r.service,name:r.name,capabilities:r.capabilities,unlocks:r.unlocks,
    methods:r.methods.map(m=>m.kind),platformGate:r.platformGate??null,source:r.source,version:r.version,learnedState:r.learnedState??null,
    methodDetails:r.methods.map(m=>({kind:m.kind,oneClick:isOneClick(env,m),successes:stats.get(m.kind)?.successes??0,failures:stats.get(m.kind)?.failures??0}))};
  }));
  return json({recipes:detailed});
 }
 if(url.pathname===`${base}/sessions`&&request.method==='GET')return json(await listConnectorSessions(env,actor));
 if(url.pathname===`${base}/sessions`&&request.method==='POST')return json(await startConnectorSession(env,actor,await readJson(request,4096)),201);
 const action=url.pathname.match(new RegExp(`^${base.replace(/[/]/g,'\\/')}\\/sessions\\/([a-f0-9-]{36})\\/(begin|attach|verify|fail)$`));
 if(action&&request.method==='POST'){
  const [,sessionId,verb]=action;
  if(verb==='begin')return json(await beginConnectorSession(env,actor,sessionId));
  if(verb==='attach')return json(await attachConnectorConnection(env,actor,sessionId,await readJson(request,4096)));
  if(verb==='verify')return json(await verifyConnectorSession(env,actor,sessionId));
  if(verb==='fail')return json(await failConnectorSession(env,actor,sessionId,await readJson(request,4096)));
 }
 return null;
}
