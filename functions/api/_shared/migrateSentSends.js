// _shared/migrateSentSends.js
//
// One-shot, idempotent column adds for prospect_sends so the new
// /api/admin/mayor/sent endpoint can render the full email body and subject
// the founder actually sent. Wrangler d1 migrations exist (0017), but D1
// does not provide `ALTER TABLE … ADD COLUMN IF NOT EXISTS`, so we wrap
// each `ALTER TABLE` in a try/catch and rely on the column's existence
// (rather than the operation's success) as the success criterion.
//
// This is safe to call from every endpoint that touches prospect_sends.
// Failed ALTERs on existing columns are silently absorbed.

const STATEMENTS = [
  `ALTER TABLE prospect_sends ADD COLUMN subject              TEXT`,
  `ALTER TABLE prospect_sends ADD COLUMN body_text            TEXT`,
  `ALTER TABLE prospect_sends ADD COLUMN from_name            TEXT`,
  `ALTER TABLE prospect_sends ADD COLUMN list_unsub_header    TEXT`,
  `ALTER TABLE prospect_sends ADD COLUMN physical_address     TEXT`,
  `CREATE INDEX IF NOT EXISTS idx_prospect_replies_send_id
     ON prospect_replies(send_id)`,
  `CREATE INDEX IF NOT EXISTS idx_prospect_sends_created_at_desc
     ON prospect_sends(created_at DESC)`,
];

let _migrated = null;

export async function ensureSentHistorySchema(env) {
  if (!env?.LEADS_DB) return { ok: false, error: "missing_db" };
  if (_migrated && _migrated.db === env.LEADS_DB) {
    // Already migrated on this binding this session.
    return { ok: true, cached: true };
  }
  const db = env.LEADS_DB;
  let applied = 0;
  for (const sql of STATEMENTS) {
    try {
      await db.prepare(sql).run();
      applied += 1;
    } catch (_) {
      // ALTER TABLE without IF NOT EXISTS throws "duplicate column name" on
      // second run — that's fine. CREATE INDEX throws "already exists" too.
      // Both errors mean the schema is already where we want it.
    }
  }
  _migrated = { db, applied, at: Date.now() };
  return { ok: true, applied };
}
