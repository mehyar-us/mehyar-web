CREATE INDEX agent_invitation_recipient_page ON agent_team_invitations(invited_email,status,created_at DESC,id DESC);
