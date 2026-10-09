// Funnel test: prefill token lifecycle (mint → GET → POST-consume → 410).
// Run: node redteam/funnel.test.mjs
// D1 is faked in-memory. Exit non-zero on failure.

import { onRequestGet as prefillGet, onRequestPost as prefillPost } from "../functions/api/assessment/prefill.js";
import { mintPrefillToken } from "../functions/api/_shared/assessmentStore.js";
import { newSession } from "../functions/api/_shared/assessmentBrain.js";

let passed = 0, failed = 0;
function ok(cond, name) {
  if (cond) passed++;
  else { failed++; console.error(`FAIL ${name}`); }
}

// ── D1 fake (minimal: prefill tokens + sessions) ────────────────────────────
function fakeDb() {
  const tokens = new Map();   // token_hash -> row
  const sessions = new Map(); // id -> { state }
  return {
    tokens, sessions,
    prepare(sql) {
      return {
        _sql: sql, _args: [],
        bind(...args) { this._args = args; return this; },
        async first() {
          const q = this._sql, a = this._args;
          if (q.includes("FROM assessment_prefill_tokens WHERE token_hash")) {
            return tokens.get(a[0]) || null;
          }
          if (q.includes("FROM assessment_sessions WHERE id")) {
            const row = sessions.get(a[0]);
            return row ? { id: a[0], state_json: JSON.stringify(row.state) } : null;
          }
          return null;
        },
        async run() {
          const q = this._sql, a = this._args;
          if (q.startsWith("INSERT INTO assessment_prefill_tokens")) {
            tokens.set(a[0], { token_hash: a[0], session_id: a[1], email_hash: a[2], expires_at: a[3], used_at: null });
          } else if (q.includes("UPDATE assessment_prefill_tokens SET used_at")) {
            const t = tokens.get(a[1]);
            if (t) t.used_at = a[0];
          } else if (q.includes("UPDATE assessment_sessions SET prefill_token_hash")) {
            // no-op for the fake
          } else if (q.startsWith("INSERT INTO assessment_sessions") || q.includes("assessment_sessions")) {
            // session upsert — stored via sessions map directly in test
          }
          return { success: true };
        },
        async all() { return { results: [] }; },
      };
    },
  };
}

function req(url, body) {
  return {
    url,
    json: async () => body || {},
  };
}

const db = fakeDb();
const env = { LEADS_DB: db };

// Seed a session with findings
const s = newSession();
s.id = "funnel-test-session";
s.businessName = "Acme Plumbing";
s.url = "https://acmeplumbing.com/";
s.category = "plumbing";
s.findings = [{ id: "no_https", title: "No HTTPS", severity: "high", observation: "Plain HTTP." }];
db.sessions.set(s.id, { state: s });

// ── Mint ────────────────────────────────────────────────────────────────────
const minted = await mintPrefillToken(env, s.id, "sal@acmeplumbing.com");
ok(minted.token.startsWith("act_"), "mint returns act_ token");
ok(db.tokens.has(minted.tokenHash), "token row stored");

// ── GET (does NOT consume) ──────────────────────────────────────────────────
let r = await prefillGet({ request: req(`https://x/api/assessment/prefill?token=${minted.token}`), env });
let b = await r.json();
ok(r.status === 200 && b.ok && b.payload.business_name === "Acme Plumbing", "GET returns prefill payload");
ok(b.payload.findings.length === 1 && b.payload.findings[0].id === "no_https", "GET payload carries findings");
ok(!db.tokens.get(minted.tokenHash).used_at, "GET does not consume the token");

// GET again — still valid (page refresh safe)
r = await prefillGet({ request: req(`https://x/api/assessment/prefill?token=${minted.token}`), env });
b = await r.json();
ok(r.status === 200 && b.ok, "second GET still 200 (refresh-safe)");

// ── POST (consumes) ─────────────────────────────────────────────────────────
r = await prefillPost({ request: req("https://x/api/assessment/prefill", { token: minted.token }), env });
b = await r.json();
ok(r.status === 200 && b.ok, "POST consumes and returns payload");
ok(!!db.tokens.get(minted.tokenHash).used_at, "POST marks token used");

// ── After consume: 410 ──────────────────────────────────────────────────────
r = await prefillGet({ request: req(`https://x/api/assessment/prefill?token=${minted.token}`), env });
b = await r.json();
ok(r.status === 410 && b.error === "token_used", "GET after consume → 410 token_used");
r = await prefillPost({ request: req("https://x/api/assessment/prefill", { token: minted.token }), env });
b = await r.json();
ok(r.status === 410, "POST after consume → 410");

// ── Invalid / missing ───────────────────────────────────────────────────────
r = await prefillGet({ request: req("https://x/api/assessment/prefill?token=bogus"), env });
ok(r.status === 410, "bogus token → 410");
r = await prefillGet({ request: req("https://x/api/assessment/prefill"), env });
ok(r.status === 410, "missing token → 410");

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
