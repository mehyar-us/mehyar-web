import {env} from 'cloudflare:workers';
import {describe,it,expect} from 'vitest';
import type {Env} from '../src/env';
import {createTenant,listTenants} from '../src/tenants';
import {inviteMember,myInvitations,acceptInvitation,revokeInvitation,revokeMember,teamDirectory} from '../src/team';
import {changeMemberRole} from '../src/team-roles';
import {requireMembership} from '../src/permissions';
const e=env as unknown as Env,uuid=()=>crypto.randomUUID();
async function user(verified=true){const id=uuid(),email=`${id}@example.test`;await e.AGENT_DB.prepare('INSERT INTO auth_user(id,name,email,emailVerified,createdAt,updatedAt) VALUES (?,?,?,?,?,?)').bind(id,'Team member',email,verified?1:0,Date.now(),Date.now()).run();return {id,email};}
async function fixture(){const u=await user(),tenant=await createTenant(e,u.id,{name:'Studio',website:'https://studio.com',goal:'Manage appointments'},uuid());await e.AGENT_DB.prepare("UPDATE agent_tenants SET plan_id='business' WHERE id=?").bind(tenant.id).run();return {actor:{userId:u.id,tenantId:tenant.id},u};}
describe('verified team invitations',()=>{
  it('changes roles with immutable receipts and prevents stale edits across removal and reinvitation',async()=>{
    const f=await fixture(),person=await user();
    const invitation=await inviteMember(e,f.actor,{email:person.email,role:'manager'},uuid());await acceptInvitation(e,person.id,invitation.invitation.id);
    const input={userId:person.id,role:'staff',expectedRevision:1},key=uuid();
    expect(await changeMemberRole(e,f.actor,input,key)).toEqual({recorded:true,role:'staff',revision:2});
    await expect(requireMembership(e,{userId:person.id,tenantId:f.actor.tenantId},['manager'])).rejects.toMatchObject({code:'permission_denied'});
    await changeMemberRole(e,f.actor,{...input,role:'billing',expectedRevision:2},uuid());
    expect(await changeMemberRole(e,f.actor,input,key)).toEqual({recorded:true,role:'staff',revision:2});
    expect((await requireMembership(e,{userId:person.id,tenantId:f.actor.tenantId})).role).toBe('billing');
    await expect(changeMemberRole(e,f.actor,{...input,role:'viewer'},key)).rejects.toMatchObject({code:'request_key_conflict'});
    await revokeMember(e,f.actor,person.id);
    const again=await inviteMember(e,f.actor,{email:person.email,role:'staff'},uuid());await acceptInvitation(e,person.id,again.invitation.id);
    await expect(changeMemberRole(e,f.actor,{...input,role:'manager',expectedRevision:3},uuid())).rejects.toMatchObject({code:'membership_changed'});
    expect((await teamDirectory(e,f.actor)).members.find(m=>m.id===person.id)).toMatchObject({role:'staff',revision:5});
  });
  it('serializes competing role edits and forbids nonowners, foreign targets and ownership escalation',async()=>{
    const f=await fixture(),person=await user(),other=await fixture();const invitation=await inviteMember(e,f.actor,{email:person.email,role:'staff'},uuid());await acceptInvitation(e,person.id,invitation.invitation.id);
    const input={userId:person.id,role:'manager',expectedRevision:1};
    const results=await Promise.allSettled(['manager','viewer'].map(role=>changeMemberRole(e,f.actor,{...input,role},uuid())));expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    await expect(changeMemberRole(e,other.actor,input,uuid())).rejects.toMatchObject({code:'membership_changed'});
    await expect(changeMemberRole(e,{userId:person.id,tenantId:f.actor.tenantId},{...input,userId:f.u.id},uuid())).rejects.toMatchObject({code:'permission_denied'});
    await expect(changeMemberRole(e,f.actor,{...input,userId:f.u.id},uuid())).rejects.toMatchObject({code:'owner_protected'});
    await expect(changeMemberRole(e,f.actor,{...input,role:'owner'},uuid())).rejects.toBeDefined();
  });
  it('keeps requests idempotent and accepts only the invited verified account without copying connections',async()=>{
    const f=await fixture(),recipient=await user(),stranger=await user(),key=uuid(),input={email:recipient.email.toUpperCase(),role:'billing'};
    const invite=await inviteMember(e,f.actor,input,key);expect(await inviteMember(e,f.actor,input,key)).toEqual(invite);
    await expect(inviteMember(e,f.actor,{...input,role:'staff'},key)).rejects.toMatchObject({code:'request_key_conflict'});
    expect((await myInvitations(e,recipient.id)).invitations).toHaveLength(1);expect((await myInvitations(e,stranger.id)).invitations).toHaveLength(0);
    await expect(acceptInvitation(e,stranger.id,invite.invitation.id)).rejects.toMatchObject({code:'invitation_unavailable'});
    expect(await acceptInvitation(e,recipient.id,invite.invitation.id)).toEqual({tenantId:f.actor.tenantId});
    expect(await acceptInvitation(e,recipient.id,invite.invitation.id)).toEqual({tenantId:f.actor.tenantId});
    expect((await listTenants(e,recipient.id)).map(t=>t.id)).toEqual([f.actor.tenantId]);
    expect((await teamDirectory(e,f.actor)).members.find(m=>m.id===recipient.id)?.role).toBe('billing');
    expect((await e.AGENT_DB.prepare('SELECT id FROM auth_provider_grants WHERE user_id=?').bind(recipient.id).all()).results).toHaveLength(0);
    await revokeMember(e,f.actor,recipient.id);await expect(acceptInvitation(e,recipient.id,invite.invitation.id)).rejects.toMatchObject({code:'workspace_not_found'});
    expect(await listTenants(e,recipient.id)).toEqual([]);await expect(revokeMember(e,f.actor,f.u.id)).rejects.toMatchObject({code:'owner_protected'});
  });
  it('rejects expired, revoked, unverified and owner-withdrawn invitations',async()=>{
    const f=await fixture(),recipient=await user(false);
    const first=await inviteMember(e,f.actor,{email:recipient.email,role:'staff'},uuid());
    await expect(myInvitations(e,recipient.id)).rejects.toMatchObject({code:'verified_email_required'});
    await expect(acceptInvitation(e,recipient.id,first.invitation.id)).rejects.toMatchObject({code:'verified_email_required'});
    await e.AGENT_DB.prepare('UPDATE auth_user SET emailVerified=1 WHERE id=?').bind(recipient.id).run();
    await revokeInvitation(e,f.actor,first.invitation.id);await expect(acceptInvitation(e,recipient.id,first.invitation.id)).rejects.toMatchObject({code:'invitation_unavailable'});
    const second=await inviteMember(e,f.actor,{email:recipient.email,role:'manager'},uuid());
    await e.AGENT_DB.prepare("UPDATE agent_team_invitations SET expires_at='2000-01-01T00:00:00Z' WHERE id=?").bind(second.invitation.id).run();
    await expect(acceptInvitation(e,recipient.id,second.invitation.id)).rejects.toMatchObject({code:'invitation_unavailable'});
    const third=await inviteMember(e,f.actor,{email:recipient.email,role:'viewer'},uuid());
    await e.AGENT_DB.prepare("UPDATE agent_memberships SET role='manager' WHERE tenant_id=? AND user_id=?").bind(f.actor.tenantId,f.u.id).run();
    expect((await myInvitations(e,recipient.id)).invitations).toEqual([]);
    await expect(acceptInvitation(e,recipient.id,third.invitation.id)).rejects.toMatchObject({code:'invitation_unavailable'});
    await expect(teamDirectory(e,f.actor)).rejects.toMatchObject({code:'permission_denied'});
  });
  it('enforces seat capacity under concurrent acceptance and rejects foreign owner mutations',async()=>{
    const f=await fixture(),other=await fixture(),people=await Promise.all([user(),user(),user()]);
    const invitations=await Promise.all(people.map(p=>inviteMember(e,f.actor,{email:p.email,role:'staff'},uuid())));
    const results=await Promise.allSettled(invitations.map((invite,i)=>acceptInvitation(e,people[i].id,invite.invitation.id)));
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(2);
    expect((await teamDirectory(e,f.actor)).members.filter(m=>m.status==='active')).toHaveLength(3);
    await expect(revokeInvitation(e,other.actor,invitations[0].invitation.id)).rejects.toMatchObject({code:'invitation_unavailable'});
    await expect(teamDirectory(e,{...other.actor,tenantId:f.actor.tenantId})).rejects.toMatchObject({code:'workspace_not_found'});
  });
});
