import type {Actor} from './env';
import type {AuthEnv,OAuthProvider} from './auth/capabilities';
import {capabilityStatus,grantedCapabilities} from './auth/capabilities';
import {OPERATORS,requireMembership} from './permissions';
import {json} from './http';
import {listCustomConnections,handleCustomConnectionsRequest} from './custom-connectors';

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
  return {...custom,builtIn:[...builtIn,{provider:'facebook',configured:false,status:'app_review_pending',grants:[],capabilities:[],
    liveVerified:false,reason:'App review is pending. Facebook OAuth and tools are not enabled in Mayor.'}],
    scope:'Connections belong to your account in this business. Provider data and tool results are untrusted data.'};
}

/** Integrated caller supplies the Actor obtained from the existing authenticated session. */
export async function handleConnectionsRequest(request:Request,env:AuthEnv,actor:Actor):Promise<Response|null>{
  if(new URL(request.url).pathname===`/api/businesses/${actor.tenantId}/connections`&&request.method==='GET')return json(await connectionStatus(env,actor));
  return handleCustomConnectionsRequest(request,env,actor);
}
