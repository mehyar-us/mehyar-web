const TASK_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS mayor_tasks (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    prospect_id TEXT,
    reply_id TEXT,
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    priority INTEGER NOT NULL DEFAULT 50,
    due_at TEXT,
    cta_text TEXT,
    value_usd REAL NOT NULL DEFAULT 0,
    source TEXT,
    payload_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_mayor_tasks_status_kind ON mayor_tasks(status, kind, due_at)`,
  `CREATE INDEX IF NOT EXISTS idx_mayor_tasks_prospect ON mayor_tasks(prospect_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_mayor_tasks_reply ON mayor_tasks(reply_id)`,
];

let migrated = false;

export async function ensureMayorTasksSchema(env) {
  if (!env?.LEADS_DB) return { ok: false, error: "missing_db" };
  if (migrated) return { ok: true, cached: true };
  for (const sql of TASK_SCHEMA) {
    await env.LEADS_DB.prepare(sql).run().catch(() => null);
  }
  migrated = true;
  return { ok: true };
}

export async function createBookingTaskForReply(env, reply, options = {}) {
  if (!env?.LEADS_DB) return { ok: false, error: "missing_db" };
  if (!reply?.id || !reply?.prospect_id) return { ok: false, error: "missing_reply_or_prospect" };
  await ensureMayorTasksSchema(env);
  const db = env.LEADS_DB;
  const existing = await db.prepare(`
    SELECT id, status, due_at
    FROM mayor_tasks
    WHERE kind = 'booking' AND reply_id = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).bind(reply.id).first().catch(() => null);
  if (existing) {
    await markReplyBookingLinked(db, reply, existing.id);
    return { ok: true, already_exists: true, task_id: existing.id, status: existing.status, due_at: existing.due_at };
  }

  const ctaText = String(options.meeting_cta || options.cta_text || "Would tomorrow or the next morning be better for a quick 15-minute call?")
    .trim()
    .slice(0, 1000);
  const valueUsd = clampMoney(options.value_usd, 7500);
  const taskId = crypto.randomUUID();
  const title = `Book 15-minute call with ${reply.business_name || reply.email || reply.from_email || "warm lead"}`.slice(0, 500);
  const payload = JSON.stringify({
    reply_id: reply.id,
    classification: reply.classification,
    reply_subject: reply.subject,
    reply_excerpt: reply.body_excerpt,
    root_domain: reply.root_domain,
    source: options.source || "warm_reply",
  }).slice(0, 8000);

  await db.prepare(`
    INSERT INTO mayor_tasks (
      id, kind, prospect_id, reply_id, title, status, priority, due_at,
      cta_text, value_usd, source, payload_json, created_at, updated_at
    )
    VALUES (?, 'booking', ?, ?, ?, 'open', 95, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `).bind(
    taskId,
    reply.prospect_id,
    reply.id,
    title,
    options.due_at || new Date().toISOString(),
    ctaText,
    valueUsd,
    options.source || "warm_reply",
    payload
  ).run();

  await markReplyBookingLinked(db, reply, taskId);

  return { ok: true, task_id: taskId, title, meeting_cta: ctaText, value_usd: valueUsd, status: "open" };
}

async function markReplyBookingLinked(db, reply, taskId) {
  await db.prepare(`
    UPDATE prospect_replies
    SET created_action = CASE
          WHEN created_action IS NULL OR created_action = '' OR created_action = 'note_appended'
            THEN 'booking_task_created'
          ELSE created_action
        END
    WHERE id = ?
  `).bind(reply.id).run().catch(() => null);

  await db.prepare(`
    UPDATE prospects
    SET status = 'replied',
        last_contact_at = COALESCE(last_contact_at, datetime('now')),
        updated_at = datetime('now')
    WHERE id = ?
  `).bind(reply.prospect_id).run().catch(() => null);

  await db.prepare(`
    INSERT INTO mayor_events (id, kind, loop, summary, details_json, created_at)
    VALUES (?, 'reply', 'booking_auto_task', ?, ?, datetime('now'))
  `).bind(
    crypto.randomUUID(),
    `Booking task linked for ${reply.business_name || reply.email || reply.from_email || reply.prospect_id}`,
    JSON.stringify({ task_id: taskId, reply_id: reply.id, prospect_id: reply.prospect_id }).slice(0, 4000)
  ).run().catch(() => null);
}

function clampMoney(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.max(100, Math.min(250000, Math.round(n)));
}
