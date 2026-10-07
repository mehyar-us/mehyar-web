// SQL predicate for a mayor_telnyx_admissions row aliased as a. Server admission
// time limits answer attempts; provider event timestamps are not a clock source.
export const freshTelnyxAdmission="COALESCE(julianday(a.created_at) BETWEEN julianday('now','-90 seconds') AND julianday('now','+5 seconds'),0)";
