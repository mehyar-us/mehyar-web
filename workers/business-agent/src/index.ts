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
import {renameAgent} from './agent-settings';
import {runBillingReconciliation} from './billing/reconciliation';
import {runEmailRecovery} from './email/recovery';
import {runMailboxRecovery} from './connectors/mailbox-recovery';
import {runMailboxProcessing} from './connectors/mailbox-processing';
import {runMailboxTriageDispatch} from './connectors/mailbox-triage-dispatch';
import {runMailboxMaintenance} from './connectors/mailbox-maintenance';
import {runMailboxAuthorityReview} from './connectors/mailbox-authority-review';
import {mailboxAnalysisRequest,mailboxAnalysisRoutes} from './connectors/mailbox-analysis-api';
import {runEmailMaintenance} from './email/maintenance';
import {queueInvitationEmail,cancelInvitationEmail} from './email/customer';
import {platformEmailUsage} from './email/usage';
import {handleEmailWebhook} from './email/webhook';
import {teamDirectory,inviteMember,revokeInvitation,revokeMember,myInvitations,acceptInvitation} from './team';
import {changeMemberRole} from './team-roles';

export { BusinessAgent };

async function route(request:Request,env:Env) {
  const url=new URL(request.url);
  const path=url.pathname;
  if(path==='/api/health'&&request.method==='GET') return json({ok:true,service:'business-agent',environment:env.ENVIRONMENT});
  if(path.startsWith('/api/auth/')) return handleAuthRequest(request,env);
  if(path==='/api/catalog'&&request.method==='GET') return json(publicCatalog());
  if(path==='/api/agent-billing/webhook') return handleBillingRequest(request,env);
  if(path==='/api/platform-email/webhook')return handleEmailWebhook(request,env);
  // This Worker never accepts or forwards legacy payment traffic.
  if(path.startsWith('/api/pay/')||path.startsWith('/api/audit/')) throw new HttpError(404,'not_found','This address is not available.');
  if(!['GET','HEAD'].includes(request.method)) requireOrigin(request,env.APP_ORIGIN);
  const session=await getSession(request,env);
  if(path==='/api/session'&&request.method==='GET') return json({user:session?.user?{id:session.user.id,name:session.user.name,email:session.user.email}:null});
  if(!session?.user) throw new HttpError(401,'sign_in_required','Sign in to continue.');
  const userId=session.user.id;
  if(path==='/api/invitations'&&request.method==='GET')return json(await myInvitations(env,userId,url.searchParams.get('cursor')));
  if(path==='/api/invitations/accept'&&request.method==='POST'){
    const {id}=z.object({id:z.string().regex(/^[a-f0-9]{64}$/)}).strict().parse(await readJson(request));
    return json(await acceptInvitation(env,userId,id));
  }
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
  if(section==='platform-email-usage'&&request.method==='GET')return json(await platformEmailUsage(env,actor));
  if(section==='team'&&request.method==='GET')return json(await teamDirectory(env,actor,{membersCursor:url.searchParams.get('membersCursor'),invitationsCursor:url.searchParams.get('invitationsCursor')}));
  if(section==='team/invitations'&&request.method==='POST')return json(await inviteMember(env,actor,await readJson(request),requestKey(request)),201);
  if(section==='team/role'&&request.method==='POST')return json(await changeMemberRole(env,actor,await readJson(request),requestKey(request)));
  if(section==='team/revoke-member'&&request.method==='POST'){
    const {userId,expectedRevision}=z.object({userId:z.string().min(1).max(128),expectedRevision:z.number().int().min(1)}).strict().parse(await readJson(request));return json(await revokeMember(env,actor,userId,expectedRevision,requestKey(request)));
  }
  const invitation=section.match(/^team\/invitations\/([a-f0-9]{64})\/revoke$/);
  if(invitation&&request.method==='POST'){z.object({}).strict().parse(await readJson(request));return json(await revokeInvitation(env,actor,invitation[1]));}
  const invitationEmail=section.match(/^team\/invitations\/([a-f0-9]{64})\/email$/);
  if(invitationEmail&&request.method==='POST'){z.object({}).strict().parse(await readJson(request));return json(await queueInvitationEmail(env,actor,invitationEmail[1]),202);}
  const cancelEmail=section.match(/^team\/invitations\/([a-f0-9]{64})\/email\/cancel$/);
  if(cancelEmail&&request.method==='POST'){z.object({}).strict().parse(await readJson(request));return json(await cancelInvitationEmail(env,actor,cancelEmail[1]));}
  if(section==='automations'&&request.method==='GET') return json(automationCatalog());
  const agent=await getAgentByName(env.BUSINESS_AGENTS,actor.tenantId);
  if(mailboxAnalysisRoutes.has(section)&&request.method==='POST'){
    await requireMembership(env,actor,OPERATORS);
    return mailboxAnalysisRequest(request,section,actor,agent);
  }
  const mailbox=section.match(/^connections\/([a-f0-9-]{36})\/mailbox$/);
  const mailboxAnalyses=section.match(/^connections\/([a-f0-9-]{36})\/mailbox\/analyses$/);
  if(mailboxAnalyses&&request.method==='GET')return json(unwrap(await agent.mailboxAnalyses(actor,mailboxAnalyses[1],url.searchParams.get('after')??undefined)));
  const mailboxReview=section.match(/^connections\/([a-f0-9-]{36})\/mailbox\/recovery$/);
  if(mailboxReview&&request.method==='POST'){
    const input=z.object({recoveryId:z.string().uuid().optional()}).strict().parse(await readJson(request));
    return json(unwrap(await agent.reviewMailboxRecovery(actor,mailboxReview[1],input.recoveryId)));
  }
  const mailboxStop=section.match(/^connections\/([a-f0-9-]{36})\/mailbox\/stop$/);
  const mailboxResume=section.match(/^connections\/([a-f0-9-]{36})\/mailbox\/resume$/);
  if(mailboxResume&&request.method==='POST'){
    const input=z.object({expectedRevision:z.number().int().min(1).max(Number.MAX_SAFE_INTEGER-1)}).strict().parse(await readJson(request));
    return json(unwrap(await agent.resumeMailboxMonitoring(actor,mailboxResume[1],input.expectedRevision)));
  }
  if(mailboxStop&&request.method==='POST'){
    z.object({}).strict().parse(await readJson(request));
    return json(unwrap(await agent.stopMailboxMonitoring(actor,mailboxStop[1])));
  }
  const mailboxFolders=section.match(/^connections\/([a-f0-9-]{36})\/mailbox\/folders$/);
  const outlookStatus=section.match(/^connections\/([a-f0-9-]{36})\/mailbox\/folders\/status$/);
  if(outlookStatus&&request.method==='GET')return json(unwrap(await agent.outlookMailboxStatus(actor,outlookStatus[1])));
  const mailboxSetup=section.match(/^connections\/([a-f0-9-]{36})\/mailbox\/setup$/);
  if(mailboxSetup&&request.method==='POST'){
    const input=z.object({inventoryId:z.string().uuid(),folderIds:z.array(z.string().min(1).max(2048)).min(1).max(100)}).strict().parse(await readJson(request));
    return json(unwrap(await agent.configureMailboxFolders(actor,mailboxSetup[1],input.inventoryId,input.folderIds)),202);
  }
  if(mailboxFolders&&request.method==='POST'){
    const input=z.object({continuation:z.string().uuid().optional()}).strict().parse(await readJson(request));
    return json(unwrap(await agent.mailboxFolders(actor,mailboxFolders[1],input.continuation)));
  }
  if(mailbox&&request.method==='GET')return json(unwrap(await agent.mailboxStatus(actor,mailbox[1])));
  if(mailbox&&request.method==='POST'){
    z.object({}).strict().parse(await readJson(request));
    const current=unwrap(await agent.mailboxStatus(actor,mailbox[1]));
    if(current.state==='not_started'&&!current.setupEnabled)throw new HttpError(503,'mailbox_setup_unavailable','Mailbox setup is awaiting activation.');
    unwrap(await agent.initializeMailbox(actor,mailbox[1]));
    return json(unwrap(await agent.mailboxStatus(actor,mailbox[1])),202);
  }
  if(section==='business-brief'&&request.method==='GET')return json(unwrap(await agent.businessBrief(actor)));
  if(section==='agent-name'&&request.method==='POST')return json(await renameAgent(env,actor,await readJson(request),requestKey(request)));
  if(section==='business-brief'&&request.method==='POST')return json(unwrap(await agent.saveBusinessBrief(actor,await readJson(request),requestKey(request))));
  const research=section.match(/^research(?:\/([a-f0-9-]{36}))?$/);
  if(section==='research'&&request.method==='POST')return json(unwrap(await agent.requestResearch(actor,await readJson(request),requestKey(request))),202);
  const confirmation=section.match(/^research\/([a-f0-9-]{36})\/confirm$/);
  const researchCancellation=section.match(/^research\/([a-f0-9-]{36})\/cancel$/);
  if(researchCancellation&&request.method==='POST')return json(unwrap(await agent.cancelResearch(actor,researchCancellation[1])));
  if(confirmation&&request.method==='POST')return json(unwrap(await agent.confirmResearchClaim(actor,confirmation[1],await readJson(request))));
  if(research&&request.method==='GET') {
    const offset=z.coerce.number().int().min(0).max(100_000).parse(url.searchParams.get('offset')??0);
    return json(research[1]?unwrap(await agent.researchEvidence(actor,research[1],offset)):unwrap(await agent.researchJobs(actor,offset)));
  }
  const calendarConnection=section.match(/^connections\/([a-f0-9-]{36})\/calendars$/);
  if(calendarConnection&&request.method==='GET') {
    const provider=z.enum(['google','microsoft']).parse(url.searchParams.get('provider'));
    return json(unwrap(await agent.connectionCalendars(actor,calendarConnection[1],provider,url.searchParams.get('continuation')??undefined)));
  }
  if(section==='action-policies'&&request.method==='GET') return json({policies:unwrap(await agent.actionPolicies(actor))});
  if(section==='usage'&&request.method==='GET') return json({usage:unwrap(await agent.usage(actor))});
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
  async scheduled(_controller,env){
    try{await runMailboxMaintenance(env);}catch{console.error(JSON.stringify({event:'agent_mailbox_maintenance_unavailable'}));}
    try{await runMailboxAuthorityReview(env);}catch{console.error(JSON.stringify({event:'agent_mailbox_authority_review_unavailable'}));}
    try{await runEmailMaintenance(env);}catch{console.error(JSON.stringify({event:'agent_email_maintenance_unavailable'}));}
    try{await runBillingReconciliation(env);}catch{console.error(JSON.stringify({event:'agent_billing_reconciliation_unavailable'}));}
    try{await runEmailRecovery(env);}catch{console.error(JSON.stringify({event:'agent_email_recovery_unavailable'}));}
    try{await runMailboxProcessing(env);}catch{console.error(JSON.stringify({event:'agent_mailbox_processing_unavailable'}));}
    try{await runMailboxTriageDispatch(env);}catch{console.error(JSON.stringify({event:'agent_mailbox_triage_dispatch_unavailable'}));}
    try{await runMailboxRecovery(env);}catch{console.error(JSON.stringify({event:'agent_mailbox_recovery_unavailable'}));}
  },
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
