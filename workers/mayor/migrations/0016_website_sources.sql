CREATE TABLE mayor_website_sources (
 id TEXT PRIMARY KEY,
 tenant_id TEXT NOT NULL REFERENCES agent_tenants(id),
 requested_url TEXT NOT NULL,
 source_url TEXT NOT NULL,
 title TEXT NOT NULL,
 excerpt TEXT NOT NULL,
 content_hash TEXT NOT NULL,
 fetched_by TEXT NOT NULL,
 fetched_at TEXT NOT NULL
);
CREATE INDEX website_source_tenant ON mayor_website_sources(tenant_id,fetched_at);
ALTER TABLE mayor_memory ADD COLUMN provenance_json TEXT NOT NULL DEFAULT '{}';
