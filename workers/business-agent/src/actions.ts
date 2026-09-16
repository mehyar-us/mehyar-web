import { z } from 'zod';
import type { Actor, Env } from './env';
import { HttpError, digest } from './http';
import { CHAT_ROLES, OPERATORS, requireMembership, requireTenant } from './permissions';
import { GOOGLE_MAIL_OPERATIONS } from './connectors/google-mail';
import { GOOGLE_CALENDAR_OPERATIONS } from './connectors/google-calendar';
import { MICROSOFT_MAIL_OPERATIONS } from './connectors/microsoft-mail';
import { MICROSOFT_CALENDAR_OPERATIONS } from './connectors/microsoft-calendar';

const identifier = z.string().min(1).max(512).regex(/^[^\s\x00-\x1f]+$/);
const email = z.string().email().max(254).transform(value => value.toLowerCase());
const instant = z.iso.datetime({ offset: true });
const policySchema = z.object({
  id: z.string().uuid(), expectedVersion: z.number().int().min(0),
  name: z.string().trim().min(1).max(100), trigger: z.string().trim().min(1).max(200),
  operation: z.enum(['mail.reply', 'calendar.create']), provider: z.enum(['google', 'microsoft']),
  grantId: z.string().uuid(), mode: z.enum(['preview', 'approve', 'automatic']),
  resources: z.array(identifier).min(1).max(100), recipients: z.array(email).min(1).max(100),
  // Automatic replies may use only an exact owner-authored template at this stage.
  template: z.string().max(6000).optional(),
  startsAt: instant, expiresAt: instant,
  maxActionsPerDay: z.number().int().min(1).max(1000),
  maxCostMicrosPerDay: z.number().int().min(0).max(1_000_000_000),
  escalation: z.string().trim().min(1).max(500), enabled: z.boolean(),
}).strict();
const proposalSchema = z.object({
  policyId: z.string().uuid(), policyVersion: z.number().int().positive(),
  action: z.discriminatedUnion('operation', [
    z.object({operation:z.literal('mail.reply'),resourceId:identifier,messageId:identifier,
      recipient:email,text:z.string().trim().min(1).max(6000)}).strict(),
    z.object({operation:z.literal('calendar.create'),resourceId:identifier,title:z.string().trim().min(1).max(200),
      description:z.string().max(4000).optional(),attendees:z.array(email).min(1).max(30),
      start:instant,end:instant,timeZone:z.string().min(1).max(100)}).strict(),
  ]),
}).strict();
type Policy = Omit<z.infer<typeof policySchema>, 'expectedVersion'>;
type Proposal = z.infer<typeof proposalSchema>;
type PolicyRow = {id:string;version:number;body:string;body_hash:string;authorized_by:string;updated_at:string};
type ActionRow = {id:string;user_id:string;request_key:string;request_hash:string;policy_id:string;policy_version:number;
  body:string;body_hash:string;status:string;created_at:string;expires_at:string;approved_by:string|null;
  approved_at:string|null;reservation_day:string|null;reserved_cost_micros:number;decision_reason:string|null};
const invalid = (code:string,message:string,status=409) => new HttpError(status,code,message);
function parse<T>(schema:z.ZodType<T>, input:unknown):T {
  const result=schema.safeParse(input);
  if(!result.success) throw invalid('invalid_action_input','Check the action and policy fields.',400);
  return result.data;
}

/** Lives inside the business Durable Object: decisions and reservations share one serialized store.
 * No credentials, provider transport or external effects are exposed by these review methods.
 */
export class ActionControls {
  constructor(private sql:SqlStorage,private env:Env,private paused:()=>boolean) {}
  private rows<T>(query:string,...bindings:SqlStorageValue[]):T[] {
    return this.sql.exec(query,...bindings).toArray() as T[];
  }
  initialize() {
    this.sql.exec(`CREATE TABLE IF NOT EXISTS action_policies(id TEXT PRIMARY KEY,version INTEGER NOT NULL,
      body TEXT NOT NULL,body_hash TEXT NOT NULL,authorized_by TEXT NOT NULL,updated_at TEXT NOT NULL)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS action_policy_versions(id TEXT NOT NULL,version INTEGER NOT NULL,
      body TEXT NOT NULL,body_hash TEXT NOT NULL,authorized_by TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(id,version))`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS action_reviews(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,
      request_key TEXT NOT NULL,request_hash TEXT NOT NULL,policy_id TEXT NOT NULL,policy_version INTEGER NOT NULL,
      body TEXT NOT NULL,body_hash TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL,expires_at TEXT NOT NULL,
      approved_by TEXT,approved_at TEXT,reservation_day TEXT,reserved_cost_micros INTEGER NOT NULL DEFAULT 0,
      decision_reason TEXT,UNIQUE(user_id,request_key))`);
    this.sql.exec('CREATE INDEX IF NOT EXISTS action_reviews_budget ON action_reviews(policy_id,reservation_day,status)');
    this.sql.exec(`CREATE TABLE IF NOT EXISTS action_decisions(id TEXT PRIMARY KEY,action_id TEXT NOT NULL,
      actor_id TEXT NOT NULL,decision TEXT NOT NULL,action_hash TEXT NOT NULL,reason TEXT,created_at TEXT NOT NULL)`);
  }
  private recordDecision(action:ActionRow,actorId:string,decision:string,reason:string|null=null) {
    this.sql.exec('INSERT INTO action_decisions(id,action_id,actor_id,decision,action_hash,reason,created_at) VALUES (?,?,?,?,?,?,?)',
      crypto.randomUUID(),action.id,actorId,decision,action.body_hash,reason,new Date().toISOString());
  }
  private policy(id:string):PolicyRow {
    const [row]=this.rows<PolicyRow>('SELECT * FROM action_policies WHERE id = ?',id);
    if(!row) throw invalid('policy_not_found','This policy is not available.',404);
    return row;
  }
  private currentPolicy(id:string,version:number) {
    const row=this.policy(id); const policy=JSON.parse(row.body) as Policy;
    if(row.version!==version) throw invalid('policy_changed','The policy changed. Prepare a new action for review.');
    const now=Date.now();
    if(!policy.enabled||Date.parse(policy.startsAt)>now||Date.parse(policy.expiresAt)<=now)
      throw invalid('policy_inactive','This policy is disabled or outside its authorized time window.');
    return {row,policy};
  }
  private async authority(actor:Actor,policy:Policy,row:PolicyRow) {
    await requireTenant(this.env,actor);
    await requireMembership(this.env,{...actor,userId:row.authorized_by},['owner']);
    const grant=await this.env.AGENT_DB.prepare("SELECT user_id,provider,granted_scopes,status FROM auth_provider_grants WHERE id = ? AND tenant_scope = ?")
      .bind(policy.grantId,actor.tenantId).first<{user_id:string;provider:string;granted_scopes:string;status:string}>();
    if(!grant||grant.provider!==policy.provider||grant.status!=='authorized') throw invalid('connection_unavailable','Reconnect the account before approving this action.');
    await requireMembership(this.env,{...actor,userId:grant.user_id},OPERATORS);
    const scopes=new Set<string>((JSON.parse(grant.granted_scopes) as string[]).map(scope=>scope.replace(/^https:\/\/graph\.microsoft\.com\//,'')));
    const operation=policy.operation==='mail.reply'
      ? (policy.provider==='google'?GOOGLE_MAIL_OPERATIONS.reply:MICROSOFT_MAIL_OPERATIONS.reply)
      : (policy.provider==='google'?GOOGLE_CALENDAR_OPERATIONS.create:MICROSOFT_CALENDAR_OPERATIONS.create);
    if(!operation.scopes.every(group=>group.some(scope=>scopes.has(scope)))) throw invalid('insufficient_scope','The account has not granted the required permissions.',403);
  }
  private checkAction(policy:Policy,action:Proposal['action']) {
    if(action.operation!==policy.operation||!policy.resources.includes(action.resourceId))
      throw invalid('resource_not_allowed','This resource is outside the saved policy.',403);
    const recipients=action.operation==='mail.reply'?[action.recipient]:action.attendees;
    if(recipients.some(recipient=>!policy.recipients.includes(recipient))) throw invalid('recipient_not_allowed','A recipient is outside the saved policy.',403);
    if(action.operation==='mail.reply'&&policy.mode==='automatic'&&action.text!==policy.template)
      throw invalid('template_not_allowed','Automatic replies must match the owner-approved template.',403);
    if(action.operation==='calendar.create') {
      try {new Intl.DateTimeFormat('en',{timeZone:action.timeZone}).format();} catch {throw invalid('invalid_timezone','Choose a valid timezone.',400);}
      if(Date.parse(action.start)>=Date.parse(action.end)||Date.parse(action.start)<=Date.now()) throw invalid('invalid_appointment','The appointment must start in the future and end after it starts.',400);
    }
  }
  private expire() {
    const now=new Date().toISOString();
    for(const action of this.rows<ActionRow>("SELECT * FROM action_reviews WHERE status IN ('pending','approved','preview') AND expires_at <= ?",now))
      this.recordDecision(action,'system:expiry','expired','Review authorization expired');
    this.sql.exec("UPDATE action_reviews SET status='expired',decision_reason='Review authorization expired' WHERE status IN ('pending','approved','preview') AND expires_at <= ?",now);
  }
  private present(row:ActionRow) {
    return {id:row.id,requestedBy:row.user_id,policyId:row.policy_id,policyVersion:row.policy_version,
      action:JSON.parse(row.body) as Proposal['action'],actionHash:row.body_hash,status:row.status,createdAt:row.created_at,expiresAt:row.expires_at,
      approvedBy:row.approved_by,approvedAt:row.approved_at,reason:row.decision_reason,
      executionAvailable:false,executionNote:'Approval records permission only. Connector execution is not enabled yet.'};
  }
  async policies(actor:Actor) {
    await requireMembership(this.env,actor,OPERATORS);
    return this.rows<PolicyRow>('SELECT * FROM action_policies ORDER BY updated_at DESC LIMIT 100')
      .map(row=>({...JSON.parse(row.body) as Policy,version:row.version,authorizedBy:row.authorized_by,updatedAt:row.updated_at}));
  }
  async savePolicy(actor:Actor,input:unknown) {
    const {expectedVersion,...policy}=parse(policySchema,input);
    const start=Date.parse(policy.startsAt),end=Date.parse(policy.expiresAt);
    if(start>=end||end<=Date.now()||end>Date.now()+366*86400000) throw invalid('invalid_policy_window','Choose an expiry within one year and after the start.',400);
    if(policy.mode==='automatic'&&policy.operation==='mail.reply'&&!policy.template?.trim()) throw invalid('template_required','An automatic reply policy needs an exact approved template.',400);
    const body=JSON.stringify(policy),hash=await digest(body);
    await requireTenant(this.env,actor); await requireMembership(this.env,actor,['owner']);
    const [prior]=this.rows<PolicyRow>('SELECT * FROM action_policies WHERE id = ?',policy.id);
    if(prior?.version===expectedVersion+1&&prior.body_hash===hash&&prior.authorized_by===actor.userId) return {...policy,version:prior.version};
    if((prior?.version??0)!==expectedVersion) throw invalid('policy_version_conflict','Refresh the policy before saving your changes.');
    if(!prior&&this.rows<{count:number}>('SELECT COUNT(*) AS count FROM action_policies')[0].count>=100) throw invalid('policy_limit','This workspace has reached its policy limit.',429);
    // No await after the version read: concurrent edits cannot silently overwrite one another.
    this.sql.exec(`INSERT INTO action_policies(id,version,body,body_hash,authorized_by,updated_at) VALUES (?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET version=excluded.version,body=excluded.body,body_hash=excluded.body_hash,authorized_by=excluded.authorized_by,updated_at=excluded.updated_at`,
      policy.id,expectedVersion+1,body,hash,actor.userId,new Date().toISOString());
    this.sql.exec('INSERT INTO action_policy_versions(id,version,body,body_hash,authorized_by,created_at) VALUES (?,?,?,?,?,?)',
      policy.id,expectedVersion+1,body,hash,actor.userId,new Date().toISOString());
    for(const action of this.rows<ActionRow>("SELECT * FROM action_reviews WHERE policy_id=? AND status IN ('pending','approved','preview')",policy.id))
      this.recordDecision(action,actor.userId,'cancelled','Policy changed; new review required');
    this.sql.exec("UPDATE action_reviews SET status='cancelled',decision_reason='Policy changed; new review required' WHERE policy_id=? AND status IN ('pending','approved','preview')",policy.id);
    return {...policy,version:expectedVersion+1};
  }
  async list(actor:Actor) {
    const membership=await requireMembership(this.env,actor,CHAT_ROLES); this.expire();
    const rows=membership.role==='staff'
      ?this.rows<ActionRow>('SELECT * FROM action_reviews WHERE user_id=? ORDER BY created_at DESC LIMIT 100',actor.userId)
      :this.rows<ActionRow>('SELECT * FROM action_reviews ORDER BY created_at DESC LIMIT 100');
    return rows.map(row=>this.present(row));
  }
  async detail(actor:Actor,id:string) {
    const membership=await requireMembership(this.env,actor,CHAT_ROLES);this.expire();
    const [action]=this.rows<ActionRow>('SELECT * FROM action_reviews WHERE id=?',id);
    if(!action||(membership.role==='staff'&&action.user_id!==actor.userId)) throw invalid('action_not_found','This action is not available.',404);
    return {...this.present(action),decisions:this.rows<{actorId:string;decision:string;actionHash:string;reason:string|null;createdAt:string}>(
      'SELECT actor_id AS actorId,decision,action_hash AS actionHash,reason,created_at AS createdAt FROM action_decisions WHERE action_id=? ORDER BY rowid',id)};
  }
  async propose(actor:Actor,input:unknown,key:string) {
    const proposal=parse(proposalSchema,input);
    if(!/^[a-zA-Z0-9_-]{16,128}$/.test(key)) throw invalid('invalid_request_key','A unique request key is required.',400);
    const body=JSON.stringify(proposal.action),bodyHash=await digest(body),hash=await digest(JSON.stringify(proposal));
    await requireMembership(this.env,actor,CHAT_ROLES); await requireTenant(this.env,actor);
    this.expire();
    const [prior]=this.rows<ActionRow>('SELECT * FROM action_reviews WHERE user_id=? AND request_key=?',actor.userId,key);
    if(prior) {
      if(prior.request_hash!==hash) throw invalid('request_key_reused','This request key belongs to a different action.');
      return this.present(prior);
    }
    let {row,policy}=this.currentPolicy(proposal.policyId,proposal.policyVersion);
    await this.authority(actor,policy,row);
    // Re-read after external authorization checks; a policy update/pause wins while awaiting D1.
    this.expire();
    const [concurrent]=this.rows<ActionRow>('SELECT * FROM action_reviews WHERE user_id=? AND request_key=?',actor.userId,key);
    if(concurrent) {
      if(concurrent.request_hash!==hash) throw invalid('request_key_reused','This request key belongs to a different action.');
      return this.present(concurrent);
    }
    ({row,policy}=this.currentPolicy(proposal.policyId,proposal.policyVersion));
    if(this.paused()) throw invalid('agent_paused','Resume the agent before proposing new actions.');
    this.checkAction(policy,proposal.action); this.expire();
    if(this.rows<{count:number}>("SELECT COUNT(*) AS count FROM action_reviews WHERE status IN ('pending','approved','preview')")[0].count>=100)
      throw invalid('review_limit','Resolve existing reviews before adding more.',429);
    // Automatic policies are stored, but automatic execution is deliberately not enabled by this review API.
    const now=new Date().toISOString(),id=crypto.randomUUID();
    this.sql.exec(`INSERT INTO action_reviews(id,user_id,request_key,request_hash,policy_id,policy_version,body,body_hash,status,created_at,expires_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`,id,actor.userId,key,hash,policy.id,row.version,body,bodyHash,policy.mode==='preview'?'preview':'pending',now,
      new Date(Math.min(Date.parse(policy.expiresAt),Date.now()+86400000)).toISOString());
    return this.present(this.rows<ActionRow>('SELECT * FROM action_reviews WHERE id=?',id)[0]);
  }
  async decide(actor:Actor,id:string,input:unknown) {
    const decision=parse(z.object({decision:z.enum(['approve','reject']),actionHash:z.string().regex(/^[a-f0-9]{64}$/),reason:z.string().trim().max(500).optional()}).strict(),input);
    await requireMembership(this.env,actor,OPERATORS); await requireTenant(this.env,actor); this.expire();
    let [action]=this.rows<ActionRow>('SELECT * FROM action_reviews WHERE id=?',id);
    if(!action) throw invalid('action_not_found','This action is not available.',404);
    if(action.body_hash!==decision.actionHash) throw invalid('action_changed','The reviewed action does not match. Refresh before deciding.');
    if(action.status===(decision.decision==='approve'?'approved':'rejected')) return this.present(action);
    if(!['pending','approved','preview'].includes(action.status)) throw invalid('action_resolved','This action has already been resolved.');
    if(decision.decision==='reject') {
      this.recordDecision(action,actor.userId,'rejected',decision.reason??'Declined by an operator');
      this.sql.exec("UPDATE action_reviews SET status='rejected',decision_reason=?,approved_by=?,approved_at=? WHERE id=?",decision.reason??'Declined by an operator',actor.userId,new Date().toISOString(),id);
      return this.present(this.rows<ActionRow>('SELECT * FROM action_reviews WHERE id=?',id)[0]);
    }
    const {row,policy}=this.currentPolicy(action.policy_id,action.policy_version);
    if(policy.mode==='preview') throw invalid('preview_only','This policy permits drafts only. Change the policy and create a new proposal to approve execution.');
    await requireMembership(this.env,{...actor,userId:action.user_id},CHAT_ROLES);
    await this.authority(actor,policy,row);
    await requireMembership(this.env,actor,OPERATORS);
    this.expire(); [action]=this.rows<ActionRow>('SELECT * FROM action_reviews WHERE id=?',id);
    if(action.status==='approved') return this.present(action);
    if(action.status!=='pending') throw invalid('action_resolved','This action is no longer waiting for approval.');
    this.currentPolicy(action.policy_id,action.policy_version);
    if(this.paused()) throw invalid('agent_paused','Resume the agent before approving actions.');
    this.checkAction(policy,JSON.parse(action.body));
    const day=new Date().toISOString().slice(0,10);
    const [budget]=this.rows<{count:number;cost:number}>("SELECT COUNT(*) AS count,COALESCE(SUM(reserved_cost_micros),0) AS cost FROM action_reviews WHERE policy_id=? AND reservation_day=? AND status IN ('approved','running','uncertain','succeeded')",policy.id,day);
    // These direct calendar/reply operations reserve one action and zero supplier units.
    // Paid-channel executors must supply server-priced reservations before being added here.
    if(budget.count>=policy.maxActionsPerDay||budget.cost>policy.maxCostMicrosPerDay) throw invalid('action_budget_limit','The policy has reached its daily action or spending limit.',429);
    this.sql.exec("UPDATE action_reviews SET status='approved',approved_by=?,approved_at=?,reservation_day=?,reserved_cost_micros=0 WHERE id=? AND status='pending'",actor.userId,new Date().toISOString(),day,id);
    this.recordDecision(action,actor.userId,'approved');
    return this.present(this.rows<ActionRow>('SELECT * FROM action_reviews WHERE id=?',id)[0]);
  }
}
