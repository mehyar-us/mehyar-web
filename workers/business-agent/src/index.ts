import { getAgentByName } from 'agents';
import { ZodError, z } from 'zod';
import type { Actor, Env } from './env';
import { BusinessAgent, unwrap } from './agent';
import { getSession, handleAuthRequest } from './auth';
import { publicCatalog } from './catalog';
import { automationCatalog } from './automations';
import { handleBillingRequest } from './billing';
import { HttpError, json, readJson, requestKey, requireOrigin } from './http';
import { KNOWLEDGE_ROLES, OPERATORS, requireMembership, requireTenant } from './permissions';
import { addMemory, createTenant, deleteMemory, getMemory, listTenants, presentTenant } from './tenants';

export { BusinessAgent };

async function route(request:Request,env:Env) {
  const url=new URL(request.url);
  const path=url.pathname;
  if(path==='/api/health'&&request.method==='GET') return json({ok:true,service:'business-agent',environment:env.ENVIRONMENT});
  if(path.startsWith('/api/auth/')) return handleAuthRequest(request,env);
  if(path==='/api/catalog'&&request.method==='GET') return json(publicCatalog());
  if(path==='/api/agent-billing/webhook') return handleBillingRequest(request,env);
  // This Worker never accepts or forwards legacy payment traffic.
  if(path.startsWith('/api/pay/')||path.startsWith('/api/audit/')) throw new HttpError(404,'not_found','This address is not available.');
  if(!['GET','HEAD'].includes(request.method)) requireOrigin(request,env.APP_ORIGIN);
  const session=await getSession(request,env);
  if(path==='/api/session'&&request.method==='GET') return json({user:session?.user?{id:session.user.id,name:session.user.name,email:session.user.email}:null});
  if(!session?.user) throw new HttpError(401,'sign_in_required','Sign in to continue.');
  const userId=session.user.id;
  if(path.startsWith('/api/agent-billing/')) {
    const tenantId=url.searchParams.get('tenantId');
    if(!tenantId) throw new HttpError(400,'workspace_required','Select a business workspace.');
    return handleBillingRequest(request,env,{userId,tenantId});
  }
  if(path==='/api/tenants'&&request.method==='GET') return json({tenants:await listTenants(env,userId)});
  if(path==='/api/tenants'&&request.method==='POST') {
    const tenant=await createTenant(env,userId,await readJson(request),requestKey(request));
    const agent=await getAgentByName(env.BUSINESS_AGENTS,tenant.id);
    unwrap(await agent.provision({tenantId:tenant.id,userId}));
    return json({tenant:presentTenant(tenant)},201);
  }
  const match=path.match(/^\/api\/tenants\/([a-zA-Z0-9_-]+)(?:\/(.*))?$/);
  if(!match) throw new HttpError(404,'not_found','This address is not available.');
  const actor:Actor={userId,tenantId:match[1]};
  const tenant=await requireTenant(env,actor);
  const membership=await requireMembership(env,actor);
  const section=match[2]||'';
  if(section==='automations'&&request.method==='GET') return json(automationCatalog());
  const agent=await getAgentByName(env.BUSINESS_AGENTS,actor.tenantId);
  const calendarConnection=section.match(/^connections\/([a-f0-9-]{36})\/calendars$/);
  if(calendarConnection&&request.method==='GET') {
    const provider=z.enum(['google','microsoft']).parse(url.searchParams.get('provider'));
    return json(unwrap(await agent.connectionCalendars(actor,calendarConnection[1],provider)));
  }
  if(section==='action-policies'&&request.method==='GET') return json({policies:unwrap(await agent.actionPolicies(actor))});
  if(section==='action-policies'&&request.method==='POST') return json({policy:unwrap(await agent.saveActionPolicy(actor,await readJson(request)))});
  if(section==='actions'&&request.method==='GET') return json({actions:unwrap(await agent.actionReviews(actor))});
  if(section==='actions'&&request.method==='POST') return json({action:unwrap(await agent.proposeAction(actor,await readJson(request),requestKey(request)))},201);
  const decision=section.match(/^actions\/([a-f0-9-]{36})\/decision$/);
  if(decision&&request.method==='POST') return json({action:unwrap(await agent.decideAction(actor,decision[1],await readJson(request)))});
  const review=section.match(/^actions\/([a-f0-9-]{36})$/);
  if(review&&request.method==='GET') return json({action:unwrap(await agent.actionReview(actor,review[1]))});
  const execution=section.match(/^actions\/([a-f0-9-]{36})\/execute$/);
  if(execution&&request.method==='POST') return json(unwrap(await agent.executeAction(actor,execution[1],await readJson(request))));
  if(!section&&request.method==='GET') {
    const canKnow=KNOWLEDGE_ROLES.includes(membership.role);
    const connections=OPERATORS.includes(membership.role)?(await env.AGENT_DB.prepare('SELECT id,provider,account_label AS accountLabel,status,last_sync_at AS lastSyncAt FROM agent_connections WHERE tenant_id = ?').bind(actor.tenantId).all()).results:[];
    const activity=OPERATORS.includes(membership.role)?(await env.AGENT_DB.prepare('SELECT id,action,summary,created_at AS createdAt FROM agent_activity WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 50').bind(actor.tenantId).all()).results:[];
    return json({tenant:presentTenant(tenant),membership:{role:membership.role},connections,activity,
      memory:canKnow?await getMemory(env,actor):[],usage:unwrap(await agent.usage(actor))});
  }
  if(section==='messages'&&request.method==='GET') return json({messages:unwrap(await agent.messages(actor))});
  if(section==='messages'&&request.method==='POST') {
    const {content}=z.object({content:z.string().trim().min(1).max(6000)}).strict().parse(await readJson(request));
    return json(unwrap(await agent.chat(actor,content,requestKey(request))));
  }
  if(section==='pause'&&request.method==='POST') {
    const {paused}=z.object({paused:z.boolean()}).strict().parse(await readJson(request));
    return json(unwrap(await agent.pause(actor,paused)));
  }
  if(section==='memory'&&request.method==='GET') {await requireMembership(env,actor,KNOWLEDGE_ROLES);return json({memory:await getMemory(env,actor)});}
  if(section==='memory'&&request.method==='POST') return json({memory:await addMemory(env,actor,await readJson(request))},201);
  if(section.startsWith('memory/')&&request.method==='DELETE') {await deleteMemory(env,actor,section.slice(7));return json({ok:true});}
  throw new HttpError(404,'not_found','This feature is not available yet.');
}

export default {
  async fetch(request:Request,env:Env):Promise<Response> {
    const requestId=crypto.randomUUID();
    try {const response=await route(request,env);response.headers.set('x-request-id',requestId);return response;}
    catch(error) {
      if(error instanceof HttpError) return json({error:{code:error.code,message:error.message},requestId},error.status);
      if(error instanceof ZodError) return json({error:{code:'invalid_input',message:'Check the form and try again.'},requestId},400);
      // No request bodies, identities, model prompts, provider tokens, or raw exception messages in logs.
      console.error(JSON.stringify({event:'request_failed',requestId}));
      return json({error:{code:'service_unavailable',message:'This service is temporarily unavailable. Please try again.'},requestId},503);
    }
  },
} satisfies ExportedHandler<Env>;
