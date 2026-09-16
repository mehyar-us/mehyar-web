import {z} from 'zod';
import type {Actor,Env} from './env';
import {digest,HttpError} from './http';
import {requireMembership,requireTenant} from './permissions';
import {getPlan} from './catalog';
export {revokeMember} from './team-removal';

const inputSchema=z.object({email:z.email().max(254).transform(value=>value.toLowerCase()),role:z.enum(['manager','staff','billing','viewer'])}).strict();
type Invitation={id:string;tenant_id:string;invited_email:string;role:string;invited_by:string;request_hash:string;status:string;created_at:string;expires_at:string;accepted_by:string|null};
const present=(row:Invitation)=>({id:row.id,email:row.invited_email,role:row.role,status:row.status==='pending'&&row.expires_at<=new Date().toISOString()?'expired':row.status,createdAt:row.created_at,expiresAt:row.expires_at});
const ownerSql="EXISTS (SELECT 1 FROM agent_memberships m JOIN agent_tenants t ON t.id=m.tenant_id WHERE m.tenant_id=? AND m.user_id=? AND m.role='owner' AND m.status='active' AND (m.expires_at IS NULL OR m.expires_at>?) AND t.status NOT IN ('deleted','offboarding'))";
async function owner(env:Env,actor:Actor){await requireTenant(env,actor);await requireMembership(env,actor,['owner']);}

export async function teamDirectory(env:Env,actor:Actor,cursors:{membersCursor?:string|null;invitationsCursor?:string|null}={}){
  await owner(env,actor);
  const tenant=await requireTenant(env,actor);
  const parsed=z.object({membersCursor:z.string().min(1).max(128).nullable().optional(),invitationsCursor:z.string().regex(/^[a-f0-9]{64}$/).nullable().optional()}).strict().parse(cursors);
  const memberCursor=parsed.membersCursor?await env.AGENT_DB.prepare('SELECT created_at,user_id FROM agent_memberships WHERE tenant_id=? AND user_id=?').bind(actor.tenantId,parsed.membersCursor).first<{created_at:string;user_id:string}>():null;
  const invitationCursor=parsed.invitationsCursor?await env.AGENT_DB.prepare('SELECT created_at,id FROM agent_team_invitations WHERE tenant_id=? AND id=?').bind(actor.tenantId,parsed.invitationsCursor).first<{created_at:string;id:string}>():null;
  if(parsed.membersCursor&&!memberCursor||parsed.invitationsCursor&&!invitationCursor)throw new HttpError(400,'invalid_team_cursor','Refresh the team list to continue.');
  const members=await env.AGENT_DB.prepare(`SELECT m.user_id AS id,u.name,u.email,m.role,m.status,m.revision,m.expires_at AS expiresAt FROM agent_memberships m
    LEFT JOIN auth_user u ON u.id=m.user_id WHERE m.tenant_id=? ${memberCursor?'AND (m.created_at>? OR (m.created_at=? AND m.user_id>?))':''}
    ORDER BY m.created_at,m.user_id LIMIT 101`).bind(actor.tenantId,...(memberCursor?[memberCursor.created_at,memberCursor.created_at,memberCursor.user_id]:[])).all();
  const invitations=await env.AGENT_DB.prepare(`SELECT * FROM agent_team_invitations WHERE tenant_id=? ${invitationCursor?'AND (created_at<? OR (created_at=? AND id<?))':''}
    ORDER BY created_at DESC,id DESC LIMIT 51`).bind(actor.tenantId,...(invitationCursor?[invitationCursor.created_at,invitationCursor.created_at,invitationCursor.id]:[])).all<Invitation>();
  await owner(env,actor);
  return {members:members.results.slice(0,100),invitations:invitations.results.slice(0,50).map(present),moreMembers:members.results.length>100,moreInvitations:invitations.results.length>50,nextMembersCursor:members.results.length>100?String(members.results[99].id):null,nextInvitationsCursor:invitations.results.length>50?invitations.results[49].id:null,seatLimit:getPlan(tenant.plan_id)?.allowances.seats??1};
}
export async function inviteMember(env:Env,actor:Actor,input:unknown,key:string){
  await owner(env,actor);const data=inputSchema.parse(input),hash=await digest(JSON.stringify(data));
  const id=await digest(JSON.stringify(['team-invitation',actor.tenantId,actor.userId,key])),now=new Date().toISOString(),expires=new Date(Date.now()+7*86400000).toISOString();
  await env.AGENT_DB.prepare(`INSERT OR IGNORE INTO agent_team_invitations(id,tenant_id,invited_email,role,invited_by,request_key,request_hash,status,created_at,expires_at)
    SELECT ?,?,?,?,?,?,?,'pending',?,? WHERE ${ownerSql}
    AND (SELECT COUNT(*) FROM agent_team_invitations WHERE tenant_id=? AND status='pending' AND expires_at>?)<50
    AND NOT EXISTS(SELECT 1 FROM agent_team_invitations WHERE tenant_id=? AND invited_email=? AND status='pending' AND expires_at>?)
    AND NOT EXISTS(SELECT 1 FROM agent_memberships m JOIN auth_user u ON u.id=m.user_id WHERE m.tenant_id=? AND lower(u.email)=? AND m.status='active')`)
    .bind(id,actor.tenantId,data.email,data.role,actor.userId,key,hash,now,expires,actor.tenantId,actor.userId,now,actor.tenantId,now,actor.tenantId,data.email,now,actor.tenantId,data.email).run();
  await owner(env,actor);
  const row=await env.AGENT_DB.prepare('SELECT * FROM agent_team_invitations WHERE id=? AND tenant_id=?').bind(id,actor.tenantId).first<Invitation>();
  if(!row)throw new HttpError(409,'invitation_unavailable','This person may already be a member or have a pending invitation. Refresh the team list; up to 50 invitations can be pending.');
  if(row.request_hash!==hash)throw new HttpError(409,'request_key_conflict','This request already belongs to another invitation.');
  return {invitation:present(row)};
}
export async function revokeInvitation(env:Env,actor:Actor,id:string){
  await owner(env,actor);const now=new Date().toISOString();
  await env.AGENT_DB.prepare(`UPDATE agent_team_invitations SET status='revoked',revoked_by=?,revoked_at=? WHERE id=? AND tenant_id=? AND status='pending' AND ${ownerSql}`)
    .bind(actor.userId,now,id,actor.tenantId,actor.tenantId,actor.userId,now).run();
  await owner(env,actor);
  const row=await env.AGENT_DB.prepare('SELECT * FROM agent_team_invitations WHERE id=? AND tenant_id=?').bind(id,actor.tenantId).first<Invitation>();
  if(!row||row.status!=='revoked')throw new HttpError(409,'invitation_unavailable','This invitation cannot be revoked. Refresh the team list.');
  return {invitation:present(row)};
}
async function verifiedEmail(env:Env,userId:string){
  const user=await env.AGENT_DB.prepare('SELECT email,emailVerified FROM auth_user WHERE id=?').bind(userId).first<{email:string;emailVerified:number}>();
  if(!user||user.emailVerified!==1)throw new HttpError(403,'verified_email_required','Sign in with a verified email address to view or accept invitations.');
  return user.email.toLowerCase();
}
export async function myInvitations(env:Env,userId:string,cursor?:string|null){
  const email=await verifiedEmail(env,userId),now=new Date().toISOString();
  if(cursor&&!/^[a-f0-9]{64}$/.test(cursor))throw new HttpError(400,'invalid_invitation_cursor','Refresh invitations to continue.');
  // An accepted/revoked anchor remains valid for its recipient: it is only a position.
  const anchor=cursor?await env.AGENT_DB.prepare('SELECT id,created_at FROM agent_team_invitations WHERE id=? AND invited_email=?').bind(cursor,email).first<{id:string;created_at:string}>():null;
  if(cursor&&!anchor)throw new HttpError(400,'invalid_invitation_cursor','Refresh invitations to continue.');
  const rows=await env.AGENT_DB.prepare(`SELECT i.id,i.role,i.expires_at AS expiresAt,t.name AS businessName FROM agent_team_invitations i JOIN agent_tenants t ON t.id=i.tenant_id
    JOIN agent_memberships m ON m.tenant_id=i.tenant_id AND m.user_id=i.invited_by
    WHERE i.invited_email=? AND i.status='pending' AND i.expires_at>? AND t.status NOT IN ('deleted','offboarding')
    AND m.role='owner' AND m.status='active' AND (m.expires_at IS NULL OR m.expires_at>?)
    ${anchor?'AND (i.created_at<? OR (i.created_at=? AND i.id<?))':''}
    ORDER BY i.created_at DESC,i.id DESC LIMIT 51`).bind(email,now,now,...(anchor?[anchor.created_at,anchor.created_at,anchor.id]:[])).all();
  if(await verifiedEmail(env,userId)!==email)throw new HttpError(409,'identity_changed','Your account changed. Sign in again.');
  return {invitations:rows.results.slice(0,50),more:rows.results.length>50,nextCursor:rows.results.length>50?String(rows.results[49].id):null};
}
export async function acceptInvitation(env:Env,userId:string,id:string){
  const email=await verifiedEmail(env,userId),now=new Date().toISOString(),operation=crypto.randomUUID();
  const row=await env.AGENT_DB.prepare('SELECT * FROM agent_team_invitations WHERE id=? AND invited_email=?').bind(id,email).first<Invitation>();
  if(!row)throw new HttpError(404,'invitation_unavailable','This invitation is not available for your account.');
  if(row.status==='accepted'&&row.accepted_by===userId){await requireTenant(env,{userId,tenantId:row.tenant_id});return {tenantId:row.tenant_id};}
  const tenant=await env.AGENT_DB.prepare('SELECT plan_id FROM agent_tenants WHERE id=?').bind(row.tenant_id).first<{plan_id:string}>();
  const seats=getPlan(tenant?.plan_id??'')?.allowances.seats??1;
  await env.AGENT_DB.batch([
    env.AGENT_DB.prepare(`UPDATE agent_team_invitations SET status='accepted',accepted_by=?,accepted_at=?,acceptance_token=?
      WHERE id=? AND invited_email=? AND status='pending' AND expires_at>? AND ${ownerSql}
      AND EXISTS(SELECT 1 FROM auth_user WHERE id=? AND emailVerified=1 AND lower(email)=?)
      AND EXISTS(SELECT 1 FROM agent_tenants WHERE id=? AND plan_id=?)
      AND (SELECT COUNT(*) FROM agent_memberships WHERE tenant_id=? AND status='active' AND role!='support' AND (expires_at IS NULL OR expires_at>?))<?
      AND NOT EXISTS(SELECT 1 FROM agent_memberships WHERE tenant_id=? AND user_id=? AND status='active')`)
      .bind(userId,now,operation,id,email,now,row.tenant_id,row.invited_by,now,userId,email,row.tenant_id,tenant?.plan_id??'',row.tenant_id,now,seats,row.tenant_id,userId),
    env.AGENT_DB.prepare(`INSERT INTO agent_memberships(tenant_id,user_id,role,status,created_at) SELECT tenant_id,?,role,'active',? FROM agent_team_invitations WHERE id=? AND acceptance_token=?
      ON CONFLICT(tenant_id,user_id) DO UPDATE SET role=excluded.role,status='active',expires_at=NULL,support_reason=NULL,revoked_by=NULL,revoked_at=NULL,revision=agent_memberships.revision+1`)
      .bind(userId,now,id,operation),
    env.AGENT_DB.prepare(`INSERT OR IGNORE INTO agent_activity(id,tenant_id,actor_id,action,summary,created_at) SELECT ?,tenant_id,?,'team.invitation.accepted','A verified account accepted a team invitation.',? FROM agent_team_invitations WHERE id=? AND acceptance_token=?`)
      .bind(`invite_${id}`,userId,now,id,operation),
  ]);
  const accepted=await env.AGENT_DB.prepare("SELECT tenant_id FROM agent_team_invitations WHERE id=? AND status='accepted' AND accepted_by=?").bind(id,userId).first<{tenant_id:string}>();
  if(!accepted)throw new HttpError(409,'invitation_unavailable','This invitation expired, was revoked, or the business has no available team seat.');
  await requireTenant(env,{userId,tenantId:accepted.tenant_id});return {tenantId:accepted.tenant_id};
}
