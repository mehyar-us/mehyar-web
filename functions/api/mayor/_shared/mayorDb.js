// /api/mayor/_shared/mayorDb.js
// Schema initialization + query helpers for the Mayor engine.
// All migrations are idempotent (CREATE TABLE IF NOT EXISTS).

export async function ensureMayorSchema(env) {
  if (!env?.LEADS_DB) return { ok: false, error: "missing_db" };
  const db = env.LEADS_DB;
  const stmts = [
    // Event log for the live UI feed + audit
    `CREATE TABLE IF NOT EXISTS mayor_events (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      loop TEXT,
      summary TEXT NOT NULL,
      details_json TEXT,
      digest_sent INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE INDEX IF NOT EXISTS idx_mayor_events_created ON mayor_events(created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_mayor_events_kind    ON mayor_events(kind)`,

    // Key/value settings (kill switch, caps, schedule)
    `CREATE TABLE IF NOT EXISTS mayor_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now'))
    )`,

    // Per-prospect multi-step sequence (replaces ad-hoc outreach steps)
    `CREATE TABLE IF NOT EXISTS prospect_sequences (
      id TEXT PRIMARY KEY,
      prospect_id TEXT NOT NULL,
      step_no INTEGER NOT NULL,
      subject TEXT NOT NULL,
      body_text TEXT NOT NULL,
      send_after_days INTEGER,
      status TEXT DEFAULT 'queued',
      send_id TEXT,
      scheduled_for TEXT,
      sent_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE INDEX IF NOT EXISTS idx_seq_prospect   ON prospect_sequences(prospect_id, step_no)`,
    `CREATE INDEX IF NOT EXISTS idx_seq_status_due ON prospect_sequences(status, scheduled_for)`,

    // Inbound reply classification
    `CREATE TABLE IF NOT EXISTS mayor_replies (
      id TEXT PRIMARY KEY,
      prospect_id TEXT,
      from_email TEXT,
      subject TEXT,
      body_text TEXT,
      classification TEXT,
      sentiment_score REAL,
      recommended_action TEXT,
      suggested_reply TEXT,
      received_at TEXT,
      processed_at TEXT
    )`,
  ];
  for (const sql of stmts) {
    try { await db.prepare(sql).run(); } catch (e) { /* ignore index errors */ }
  }

  // Seed default settings
  const defaults = {
    daily_email_cap:    "25",       // warmup cap; bumped to 100 after day 14
    warmup_day:         "0",        // incremented daily
    paused_until:       "",         // ISO timestamp; "" = not paused
    paused_forever:     "0",        // 1 = killed
    auto_send:          "1",        // global send toggle
    bounce_rate_alert:  "0.10",     // pause threshold
    discovered_at:      "",         // last successful discovery
    outreach_run_at:    "",         // last outreach run
    followup_run_at:    "",         // last follow-up run
    digest_run_at:      "",         // last digest
    weekly_run_at:      "",         // last weekly
    daily_sent_count:   "0",        // reset each day
    daily_send_date:    "",         // YYYY-MM-DD
  };
  for (const [k, v] of Object.entries(defaults)) {
    await db.prepare(
      `INSERT INTO mayor_settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO NOTHING`
    ).bind(k, v).run();
  }
  return { ok: true };
}

// ── Settings helpers ──────────────────────────────────────────────────────

export async function getSetting(env, key, fallback = "") {
  if (!env?.LEADS_DB) return fallback;
  const row = await env.LEADS_DB.prepare(
    `SELECT value FROM mayor_settings WHERE key = ?`
  ).bind(key).first();
  return row?.value ?? fallback;
}

export async function setSetting(env, key, value) {
  if (!env?.LEADS_DB) return false;
  await env.LEADS_DB.prepare(
    `INSERT INTO mayor_settings (key, value, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
  ).bind(key, String(value)).run();
  return true;
}

export async function getAllSettings(env) {
  if (!env?.LEADS_DB) return {};
  const { results } = await env.LEADS_DB.prepare(
    `SELECT key, value, updated_at FROM mayor_settings ORDER BY key`
  ).all();
  const out = {};
  for (const r of (results || [])) out[r.key] = { value: r.value, updated_at: r.updated_at };
  return out;
}

// ── Event helpers ─────────────────────────────────────────────────────────

export async function logEvent(env, kind, summary, opts = {}) {
  if (!env?.LEADS_DB) return null;
  const id = crypto.randomUUID();
  await env.LEADS_DB.prepare(
    `INSERT INTO mayor_events (id, kind, loop, summary, details_json, digest_sent)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(
    id, kind, opts.loop || null, summary,
    opts.details ? JSON.stringify(opts.details) : null,
    opts.digest_sent ? 1 : 0
  ).run();
  return id;
}

export async function recentEvents(env, limit = 50) {
  if (!env?.LEADS_DB) return [];
  const lim = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200);
  const { results } = await env.LEADS_DB.prepare(
    `SELECT id, kind, loop, summary, details_json, digest_sent, created_at
     FROM mayor_events ORDER BY created_at DESC LIMIT ${lim}`
  ).all();
  return (results || []).map(r => ({
    ...r,
    details: r.details_json ? safeJson(r.details_json) : null,
  }));
}

function safeJson(s) { try { return JSON.parse(s); } catch { return null; } }

// ── Reply helpers ─────────────────────────────────────────────────────────

export async function listReplies(env, { needsAction = false, limit = 50 } = {}) {
  if (!env?.LEADS_DB) return [];
  const where = needsAction
    ? `WHERE recommended_action IS NOT NULL
       AND recommended_action != 'auto' AND recommended_action != 'unsubscribe'`
    : "";
  const { results } = await env.LEADS_DB.prepare(
    `SELECT id, prospect_id, from_email, subject, body_text, classification,
            sentiment_score, recommended_action, suggested_reply,
            received_at, processed_at
     FROM mayor_replies ${where}
     ORDER BY received_at DESC LIMIT ${Math.min(limit, 200)}`
  ).all();
  return results || [];
}

// ── Pause / kill ──────────────────────────────────────────────────────────

export function isPaused(settings) {
  if (!settings) return false;
  if (settings.paused_forever?.value === "1") return true;
  const until = settings.paused_until?.value || "";
  if (until && new Date(until) > new Date()) return true;
  return false;
}

export async function pause(env, { durationHours = 24, forever = false } = {}) {
  if (forever) {
    await setSetting(env, "paused_forever", "1");
    await logEvent(env, "pause", "Mayor KILLED (forever)", { loop: "system" });
    return { ok: true, paused_until: "forever" };
  }
  const until = new Date(Date.now() + durationHours * 3600 * 1000).toISOString();
  await setSetting(env, "paused_until", until);
  await logEvent(env, "pause", `Mayor paused for ${durationHours}h`, {
    loop: "system",
    details: { until, durationHours },
  });
  return { ok: true, paused_until: until };
}

export async function resume(env) {
  await setSetting(env, "paused_until", "");
  await setSetting(env, "paused_forever", "0");
  await logEvent(env, "pause", "Mayor resumed", { loop: "system" });
  return { ok: true };
}