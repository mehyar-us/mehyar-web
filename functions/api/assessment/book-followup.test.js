// Route tests for /api/assessment/book-followup (D7b).
// Run: node functions/api/assessment/book-followup.test.js
// D1 is faked in-memory. Exit non-zero on failure.

import { onRequestPost } from "./book-followup.js";

let passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) passed++;
  else { failed++; console.error(`FAIL ${name}`); }
}

// Minimal D1 fake: understands the 4 statements the route issues.
function fakeDb({ auditRows = {}, throwOnAudit = false } = {}) {
  const sessions = new Map(); // id -> { id, kind, followup_of }
  return {
    sessions,
    prepare(sql) {
      return {
        _sql: sql, _args: [],
        bind(...args) { this._args = args; return this; },
        async first() {
          if (throwOnAudit && this._sql.includes("audit_business_reports")) throw new Error("no such table");
          if (this._sql.includes("audit_business_reports")) {
            return auditRows[this._args[0]] || null;
          }
          if (this._sql.includes("FROM assessment_sessions WHERE kind")) {
            for (const s of sessions.values()) {
              if (s.kind === "followup" && s.followup_of === this._args[0]) return { id: s.id };
            }
            return null;
          }
          return null;
        },
        async run() {
          if (this._sql.includes("INSERT INTO assessment_sessions")) {
            const a = this._args;
            sessions.set(a[0], { id: a[0], kind: a[19] || "assessment", followup_of: a[20] || null });
            return { success: true };
          }
          if (this._sql.includes("DELETE FROM assessment_findings")) return { success: true };
          return { success: true };
        },
      };
    },
  };
}

const req = (body) => ({ request: { json: async () => body } });

const PAID_ROW = {
  id: "aud1", email_hash: "h", url: "https://acme.com", business_name: "Acme",
  status: "paid", access_token: "tok123",
};

// ── happy path ──────────────────────────────────────────────────────────────
{
  const db = fakeDb({ auditRows: { aud1: PAID_ROW } });
  const res = await onRequestPost({ ...req({ audit_id: "aud1", access_token: "tok123" }), env: { LEADS_DB: db } });
  const body = await res.json();
  ok(res.status === 200 && body.ok && body.kind === "followup", "paid audit → followup session issued");
  ok(/^https:\/\/mehyar\.us\/call\?session=.+&mode=followup$/.test(body.booking_url), `booking_url shape: ${body.booking_url}`);
  const sess = db.sessions.get(body.session_id);
  ok(sess?.kind === "followup" && sess?.followup_of === "aud1", "session row kind=followup, linked to audit");
}
{
  // idempotent: second call reuses
  const db = fakeDb({ auditRows: { aud1: PAID_ROW } });
  const r1 = await (await onRequestPost({ ...req({ audit_id: "aud1", access_token: "tok123" }), env: { LEADS_DB: db } })).json();
  const r2 = await (await onRequestPost({ ...req({ audit_id: "aud1", access_token: "tok123" }), env: { LEADS_DB: db } })).json();
  ok(r2.reused === true && r2.session_id === r1.session_id && db.sessions.size === 1, "one follow-up session per paid audit (idempotent)");
}
{
  // generating/ready also count as paid
  for (const st of ["generating", "ready"]) {
    const db = fakeDb({ auditRows: { aud1: { ...PAID_ROW, status: st } } });
    const body = await (await onRequestPost({ ...req({ audit_id: "aud1", access_token: "tok123" }), env: { LEADS_DB: db } })).json();
    ok(body.ok, `status=${st} → issued`);
  }
}

// ── rejection paths ─────────────────────────────────────────────────────────
{
  const db = fakeDb({ auditRows: { aud1: { ...PAID_ROW, status: "intake" } } });
  const res = await onRequestPost({ ...req({ audit_id: "aud1", access_token: "tok123" }), env: { LEADS_DB: db } });
  const body = await res.json();
  ok(res.status === 402 && body.error === "not_paid", "unpaid audit → 402 not_paid (never issue calls unpaid)");
  ok(db.sessions.size === 0, "no session created when unpaid");
}
{
  const db = fakeDb({ auditRows: { aud1: PAID_ROW } });
  const res = await onRequestPost({ ...req({ audit_id: "aud1", access_token: "wrong" }), env: { LEADS_DB: db } });
  ok(res.status === 403 && (await res.json()).error === "bad_token", "wrong token → 403");
}
{
  const db = fakeDb({ auditRows: {} });
  const res = await onRequestPost({ ...req({ audit_id: "nope", access_token: "tok123" }), env: { LEADS_DB: db } });
  ok(res.status === 404, "unknown audit → 404");
}
{
  const db = fakeDb({ throwOnAudit: true });
  const res = await onRequestPost({ ...req({ audit_id: "aud1", access_token: "tok123" }), env: { LEADS_DB: db } });
  const body = await res.json();
  ok(res.status === 503 && body.error === "audit_engine_not_ready", "missing audit table → loud 503, never silent issue");
}
{
  const db = fakeDb({ auditRows: { aud1: PAID_ROW } });
  const res = await onRequestPost({ ...req({}), env: { LEADS_DB: db } });
  ok(res.status === 400, "missing fields → 400");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
