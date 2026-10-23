-- Per-stage artifact preservation for the paid audit rail (DP-4, ruling
-- chief-of-decisions-audit-quality-scope-dps, 2026-10-23). The pipeline's
-- order row holds a single draft_json / review_json slot, overwritten every
-- round — the gap that cost exercises 2 and 9 their first-round review (and
-- exercise 9 its first draft) texts. This table is the append-only record:
-- one row per stage output (evidence / draft / review) per round, written by
-- the pipeline alongside the existing slot writes and never read back into
-- any stage input, criterion or flow decision.
CREATE TABLE mayor_audit_stage_artifacts (
 id TEXT PRIMARY KEY,
 order_id TEXT NOT NULL,
 stage TEXT NOT NULL,
 artifact_kind TEXT NOT NULL CHECK(artifact_kind IN ('evidence','draft','review')),
 round INTEGER NOT NULL,
 model TEXT,
 payload_json TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE INDEX idx_mayor_audit_stage_artifacts_order ON mayor_audit_stage_artifacts(order_id, artifact_kind, round);
