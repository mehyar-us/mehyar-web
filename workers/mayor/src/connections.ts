import type {Actor} from './env';
import type {AuthEnv,OAuthProvider} from './auth/capabilities';
import {capabilityStatus,grantedCapabilities} from './auth/capabilities';
import {OPERATORS,requireMembership} from './permissions';
import {json} from './http';
import {verticalProfile,verticalSchema,type Vertical} from './verticals';
import {listCustomConnections,handleCustomConnectionsRequest} from './custom-connectors';

/** Semantic tags for the connection cards, so a vertical's connectorPriority can
 * name a capability ('calendar', 'reviews') instead of a provider id. */
const CONNECTOR_TAGS:Record<string,string[]>={
 google:['calendar','email'],microsoft:['calendar'],zoho:['calendar'],facebook:['reviews','social'],
};

/** Fallback connector priority (highest first) per vertical, used until the crew4
 * vertical track enriches the profile's own connectorPriority. 'other' keeps
 * today's order: an empty list means no reordering. */
const DEFAULT_CONNECTOR_PRIORITY:Record<Vertical,string[]>={
 salon:['calendar','email','reviews'],
 restaurant:['reviews','reservations','calendar','email'],
 plumbing_hvac:['phone','calendar','email'],
 dental:['calendar','email','reviews'],
 auto_repair:['calendar','email','reviews'],
 other:[],
};

/** Connector priority for a vertical: the profile's connectorPriority wins when
 * present, otherwise the per-vertical fallback above. */
function connectorPriorityOf(vertical:Vertical):string[]{
 const p=verticalProfile(vertical) as unknown as {connectorPriority?:string[]};
 const list=p.connectorPriority;
 return Array.isArray(list)&&list.length?list:DEFAULT_CONNECTOR_PRIORITY[vertical];
}

/** Order connector ids by the vertical's connectorPriority (highest value first).
 * A priority entry matches a connector's id or one of its semantic tags;
 * connectors with no match keep their current relative order at the end. Stable. */
export function orderConnectorsByPriority(vertical:Vertical,ids:string[]):string[]{
 const priority=connectorPriorityOf(vertical);
 const rank=(id:string)=>{
  const tokens=[id,...(CONNECTOR_TAGS[id]??[])];
  let best=Infinity;
  for(const t of tokens){const i=priority.indexOf(t);if(i!==-1&&i<best)best=i;}
  return best;
 };
 return ids.map((id,i)=>({id,i})).sort((a,b)=>rank(a.id)-rank(b.id)||a.i-b.i).map(x=>x.id);
}

/** The tenant's vertical from the stored business profile ('other' when unknown). */
async function tenantVertical(env:AuthEnv,tenantId:string):Promise<Vertical>{
 try{
  const row=await env.AGENT_DB.prepare("SELECT value_json FROM mayor_memory WHERE tenant_id=? AND field='profile'")
   .bind(tenantId).first<{value_json:string}>();
  if(!row)return 'other';
  const parsed=verticalSchema.safeParse(JSON.parse(row.value_json).vertical);
  return parsed.success?parsed.data:'other';
 }catch{return 'other';}
}

/** Local consent inventory only: sign-in is not tool authorization or live-provider verification. */
export async function connectionStatus(env:AuthEnv,actor:Actor){
  await requireMembership(env,actor,OPERATORS);
  const [custom,grants,selection]=await Promise.all([
    listCustomConnections(env,actor),
    env.AGENT_DB.prepare(`SELECT id,provider,status,selected_capabilities,granted_scopes FROM auth_provider_grants
      WHERE tenant_scope=? AND user_id=? AND status!='revoked' ORDER BY updated_at DESC LIMIT 30`)
      .bind(actor.tenantId,actor.userId).all<{id:string;provider:OAuthProvider;status:string;selected_capabilities:string;granted_scopes:string}>(),
    env.AGENT_DB.prepare(`SELECT s.provider,s.grant_id,s.calendar_name FROM mayor_calendar_selection s
      JOIN auth_provider_grants g ON g.id=s.grant_id AND g.user_id=? AND g.tenant_scope=s.tenant_id
      WHERE s.tenant_id=? AND g.status='authorized'`).bind(actor.userId,actor.tenantId)
      .first<{provider:OAuthProvider;grant_id:string;calendar_name:string}>(),
  ]);
  const availability=capabilityStatus(env).providers;
  const builtIn=(['google','microsoft','zoho'] as const).map(provider=>{
    const providerGrants=grants.results.filter(g=>g.provider===provider).map(g=>{
      let capabilities:string[]=[];
      try{capabilities=grantedCapabilities(provider,JSON.parse(g.granted_scopes),JSON.parse(g.selected_capabilities));}catch{}
      return {id:g.id,status:g.status,capabilities:capabilities.filter(id=>availability[provider].capabilities.some(c=>c.id===id&&c.enabled))};
    });
    return {provider,configured:availability[provider].configured,capabilities:availability[provider].capabilities,grants:providerGrants,
      status:providerGrants.some(g=>g.status==='authorized'&&g.capabilities.length)?'connected':providerGrants.some(g=>g.status==='reconnect_required')?'reconnect_required':'not_connected',
      calendar:selection?.provider===provider?{grantId:selection.grant_id,name:selection.calendar_name}:null,liveVerified:false};
  });
  await requireMembership(env,actor,OPERATORS);
  // Vertical-aware card order: the vertical's connectorPriority (highest first).
  // 'other' (or an unknown profile) keeps today's order.
  const cards=[...builtIn,{provider:'facebook',configured:false,status:'app_review_pending',grants:[],capabilities:[],
    liveVerified:false,reason:'App review is pending. Facebook OAuth and tools are not enabled in Mayor.'}];
  const vertical=await tenantVertical(env,actor.tenantId);
  const cardById=new Map(cards.map(c=>[c.provider,c] as const));
  const ordered=orderConnectorsByPriority(vertical,cards.map(c=>c.provider)).map(id=>cardById.get(id)!);
  return {...custom,builtIn:ordered,
    scope:'Connections belong to your account in this business. Provider data and tool results are untrusted data.'};
}

/** Integrated caller supplies the Actor obtained from the existing authenticated session. */
export async function handleConnectionsRequest(request:Request,env:AuthEnv,actor:Actor):Promise<Response|null>{
  if(new URL(request.url).pathname===`/api/businesses/${actor.tenantId}/connections`&&request.method==='GET')return json(await connectionStatus(env,actor));
  return handleCustomConnectionsRequest(request,env,actor);
}
