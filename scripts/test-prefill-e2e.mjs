// scripts/test-prefill-e2e.mjs — F2 verification: the post-call funnel no longer
// drops the prefill token.
//
// Chain under test (no network, no real email — sendCfEmail degrades to
// {ok:false} without email env, which is exactly the no-send path):
//   1. Seed an assessment session (business name, URL, findings).
//   2. POST /api/assessment/end  -> mints prefill token, returns prefill_token.
//   3. GET  /api/assessment/prefill?token=<token> -> payload with business_name,
//      url, findings — the fields /audit?prefill= now consumes.
//   4. Expired/used/garbage tokens -> 410, never a crash.
//   5. Static check: client/src/pages/Audit.tsx reads ?prefill= and fetches the
//      endpoint (the page-side half of the fix).
import assert from "node:assert/strict";
import fs from "node:fs";

import { onRequestPost as endPost } from "../functions/api/assessment/end.js";
import { onRequestGet as prefillGet, onRequestPost as prefillPost } from "../functions/api/assessment/prefill.js";
import { saveSession } from "../functions/api/_shared/assessmentStore.js";

let N = 0;
const ok = (cond, msg) => { N++; assert.ok(cond, msg); };

// ── minimal D1 fake ─────────────────────────────────────────────────────────
class MockD1 {
  constructor() { this.sessions = new Map(); this.tokens = new Map(); }
  prepare(sql) {
    const db = this, s = sql.replace(/\s+/g, " ").trim(), st = { vals: [] };
    st.bind = (...v) => { st.vals = v; return st; };
    st.first = async () => {
      if (s.startsWith("SELECT * FROM assessment_sessions WHERE id = ?")) {
        const r = db.sessions.get(st.vals[0]);
        return r ? { ...r } : null;
      }
      if (s.startsWith("SELECT * FROM assessment_prefill_tokens WHERE token_hash = ?")) {
        const r = db.tokens.get(st.vals[0]);
        return r ? { ...r } : null;
      }
      return null;
    };
    st.run = async () => {
      if (s.startsWith("INSERT INTO assessment_sessions")) {
        const [id] = st.vals;
        db.sessions.set(id, { id, state_json: st.vals[9], email_sent_at: null });
        return { success: true };
      }
      if (s.startsWith("INSERT INTO assessment_prefill_tokens")) {
        const [token_hash, session_id, email_hash, expires_at] = st.vals;
        db.tokens.set(token_hash, { token_hash, session_id, email_hash, expires_at, used_at: null });
        return { success: true };
      }
      if (s.startsWith("UPDATE assessment_sessions SET prefill_token_hash")) {
        return { success: true };
      }
      if (s.startsWith("UPDATE assessment_prefill_tokens SET used_at")) {
        const t = db.tokens.get(st.vals[1]);
        if (t) t.used_at = st.vals[0];
        return { success: true };
      }
      if (s.startsWith("DELETE FROM assessment_findings") || s.startsWith("INSERT INTO assessment_findings")) {
        return { success: true };
      }
      return { success: true };
    };
    return st;
  }
}

const env = { LEADS_DB: new MockD1() }; // no email env -> sendCfEmail no-ops
const post = (path, body) => new Request("https://mehyar.us" + path, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});
const get = (path) => new Request("https://mehyar.us" + path, { method: "GET" });

// ── 1. seed a finished call session ─────────────────────────────────────────
const session = {
  id: "sess-f2-e2e",
  businessName: "Frank's Plumbing",
  url: "https://franksplumbing.example",
  category: "plumbing",
  contactName: "Frank",
  email: "frank@franksplumbing.example",
  consentGiven: true,
  outcome: "followup",
  findings: [
    { id: "f1", title: "No online booking", severity: "high", observation: "Phone number only; no booking form found." },
    { id: "f2", title: "Slow mobile load", severity: "medium", observation: "LCP over 4s on mobile." },
  ],
};
await saveSession(env, session);

// ── 2. POST /api/assessment/end mints the token ─────────────────────────────
let r = await endPost({ request: post("/api/assessment/end", { session_id: session.id }), env });
let d = await r.json();
ok(r.status === 200 && d.ok === true, "end: 200 ok");
ok(typeof d.prefill_token === "string" && d.prefill_token.startsWith("act_"), "end: returns raw prefill token");
ok(d.email_sent === false, "end: no real email sent in test env (send not configured)");
const token = d.prefill_token;

// ── 3. GET /api/assessment/prefill?token=… redeems the payload ───────────────
r = await prefillGet({ request: get(`/api/assessment/prefill?token=${encodeURIComponent(token)}`), env });
d = await r.json();
ok(r.status === 200 && d.ok === true, "prefill GET: 200 ok");
ok(d.payload.business_name === "Frank's Plumbing", "prefill: business_name survives");
ok(d.payload.url === "https://franksplumbing.example", "prefill: url survives");
ok(Array.isArray(d.payload.findings) && d.payload.findings.length === 2, "prefill: findings survive");
ok(typeof d.payload.findings_summary === "string" && d.payload.findings_summary.length > 0, "prefill: findings_summary present");
ok(!("email" in d.payload), "prefill: raw email NOT in payload (privacy)");

// ── 4. token lifecycle: use-once, garbage, tampered ─────────────────────────
r = await prefillPost({ request: post("/api/assessment/prefill", { token }), env });
d = await r.json();
ok(r.status === 200 && d.ok === true, "prefill POST: first redeem ok + marks used");
r = await prefillGet({ request: get(`/api/assessment/prefill?token=${encodeURIComponent(token)}`), env });
ok(r.status === 410, "prefill GET: used token -> 410");
r = await prefillGet({ request: get("/api/assessment/prefill?token=act_" + "0".repeat(64)), env });
ok(r.status === 410, "prefill GET: unknown token -> 410");
r = await prefillGet({ request: get("/api/assessment/prefill?token=not-a-token"), env });
ok(r.status === 410, "prefill GET: malformed token -> 410, no crash");

// ── 5. page-side: /audit consumes ?prefill= ──────────────────────────────────
const auditTsx = fs.readFileSync(new URL("../client/src/pages/Audit.tsx", import.meta.url), "utf8");
ok(auditTsx.includes('get("prefill")'), "Audit.tsx reads ?prefill= from the URL");
ok(auditTsx.includes("/api/assessment/prefill?token="), "Audit.tsx fetches the prefill endpoint");
ok(auditTsx.includes("setBusinessName(p.business_name)"), "Audit.tsx fills business name from payload");
ok(auditTsx.includes("setSiteUrl(p.url)"), "Audit.tsx fills URL from payload");

console.log(`\nAll ${N} prefill E2E assertions passed.`);
process.exit(0);
