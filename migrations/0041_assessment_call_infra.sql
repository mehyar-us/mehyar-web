-- 0041_assessment_call_infra.sql — assessment-call INFRA session layer.
--
-- PIVOT 2026-10-09: the voice team (fb19eba4) owns WebRTC transport, STT/TTS,
-- the <=1s latency budget and turn-taking. The brain crew owns the
-- conversation (functions/api/assessment/*, assessment_sessions table).
-- THIS migration is the infra crew's session record:
--   - assessment_call_sessions: the voice-call lifecycle (consent, 45-min cap,
--     heartbeat, rate-limit joins). Links to the brain crew's
--     assessment_sessions row via brain_session_id.
--   - assessment_call_turns: the per-turn LATENCY LOG (stt_ms / ttt_ms /
--     brain_ms / tts_ms, supplied by the voice stack, stored by us) plus the
--     transcript text. No audio is ever stored.
--
-- Privacy contract (standing):
--   - ip_hash is SHA-256 of cf-connecting-ip. The raw IP is NEVER stored.
--   - consent_at is set only after the explicit UI consent gate
--     (recording/transcription notice + 18+, checkboxes unchecked by default).
--   - Deletion: POST /api/assessment-call/delete with the opaque session id
--     (possession = authorization) hard-deletes the session row and all turns.
--
-- NOTE: post-payment follow-up issuance (D7b) lives on the brain crew's
-- /api/assessment/book-followup (their 0041_assessment_call_followup.sql) —
-- this crew does NOT duplicate it. A follow-up call gets its own infra
-- session row here, linked via brain_session_id.

CREATE TABLE assessment_call_sessions (
  id TEXT PRIMARY KEY,                          -- opaque 128-bit session secret
  brain_session_id TEXT,                        -- link -> assessment_sessions.id (brain crew)
  ip_hash TEXT NOT NULL,                        -- SHA-256 of caller IP
  user_agent_hash TEXT,                         -- SHA-256 of UA (optional)
  consent_at TEXT NOT NULL,                     -- ISO8601, explicit UI consent
  status TEXT NOT NULL DEFAULT 'active',        -- active | ended | timed_out | deleted
  turn_count INTEGER NOT NULL DEFAULT 0,
  neurons_est REAL NOT NULL DEFAULT 0,          -- accumulated estimate (guard)
  usage_json TEXT,                              -- cost rollup (see docs/assessment-call-infra.md § Unit economics)
  cost_usd_est REAL NOT NULL DEFAULT 0,         -- pay-as-you-go equivalent, for pricing math
  last_heartbeat_at TEXT,
  ended_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX idx_call_sessions_status ON assessment_call_sessions(status);
CREATE INDEX idx_call_sessions_brain ON assessment_call_sessions(brain_session_id);
CREATE INDEX idx_call_sessions_created ON assessment_call_sessions(created_at);

-- Per-turn latency log. Field ownership (frozen in docs/voice-adapter-contract.md):
--   stt_ms   speech-end -> final transcript      (voice team, client-measured)
--   ttt_ms   transcript-final -> first reply byte (adapter-measured, /assessment/turn)
--   brain_ms brain server time, if reported       (brain crew, optional)
--   tts_ms   first reply byte -> first audible   (voice team, client-measured)
CREATE TABLE assessment_call_turns (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES assessment_call_sessions(id),
  seq INTEGER NOT NULL,                         -- per-session turn number
  role TEXT NOT NULL,                           -- user | assistant
  text TEXT NOT NULL,                           -- transcript / reply text
  stt_ms INTEGER,
  ttt_ms INTEGER,
  brain_ms INTEGER,
  tts_ms INTEGER,
  interrupted INTEGER NOT NULL DEFAULT 0,       -- barge-in marker
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX idx_call_turns_session ON assessment_call_turns(session_id, seq);
