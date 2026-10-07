// Recheck authority inside the statement that mutates a phone connection.
// Bind tenant ID and user ID, in that order. SQL time avoids a stale preflight clock.
export const phoneWriteAccess=`EXISTS(SELECT 1 FROM agent_memberships m JOIN agent_tenants t ON t.id=m.tenant_id WHERE m.tenant_id=? AND m.user_id=? AND m.status='active' AND t.status='active' AND m.role IN ('owner','manager') AND (m.expires_at IS NULL OR m.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')))`;
