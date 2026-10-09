-- 0041_assessment_call_followup.sql — post-payment follow-up call booking (D7b)
-- + background decide() scoring columns (D4).
--
-- kind: 'assessment' (the free front-door call) | 'followup' (the paid deeper dive,
--   issued only after the $330 checkout clears — see /api/assessment/book-followup).
-- followup_of: the audit_business_reports.id this follow-up call belongs to.
-- prospect_score / prospect_tier / next_best_action: written by the background
-- decide() scorer (D4); mirrored from state_json for CRM queries.

ALTER TABLE assessment_sessions ADD COLUMN kind TEXT NOT NULL DEFAULT 'assessment';
ALTER TABLE assessment_sessions ADD COLUMN followup_of TEXT;
ALTER TABLE assessment_sessions ADD COLUMN prospect_score INTEGER;
ALTER TABLE assessment_sessions ADD COLUMN prospect_tier TEXT;
ALTER TABLE assessment_sessions ADD COLUMN next_best_action TEXT;

CREATE INDEX idx_assessment_sessions_kind ON assessment_sessions(kind);
CREATE INDEX idx_assessment_sessions_followup_of ON assessment_sessions(followup_of);
