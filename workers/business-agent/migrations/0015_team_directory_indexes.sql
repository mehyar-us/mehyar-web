CREATE INDEX agent_membership_directory ON agent_memberships(tenant_id,created_at,user_id);
CREATE INDEX agent_invitation_directory ON agent_team_invitations(tenant_id,created_at DESC,id DESC);
