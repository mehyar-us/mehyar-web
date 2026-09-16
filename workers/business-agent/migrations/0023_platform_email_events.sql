CREATE TABLE agent_platform_email_events (
  event_id TEXT PRIMARY KEY,
  payload_hash TEXT NOT NULL,
  route_ref TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('pending','linked','review_required')),
  received_at TEXT NOT NULL,
  next_attempt_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  processing_token TEXT
);
CREATE INDEX agent_platform_email_event_due ON agent_platform_email_events(route_ref,state,next_attempt_at);
CREATE INDEX agent_platform_email_provider_lookup ON agent_platform_email_outbox(route_ref,provider_id,state);
