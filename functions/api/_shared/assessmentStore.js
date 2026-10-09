// functions/api/_shared/assessmentStore.js
//
// D1 persistence for the assessment call: sessions, findings, prefill tokens.
// Privacy: email_hash is SHA-256(lower(email)); raw emails and IPs never land
// in D1 — only their hashes. Prefill tokens are opaque; only SHA-256 is stored.

import { sha256hex } from "./assessmentDiagnose.js";
import { PREFILL_LINK_TTL_DAYS } from "./assessmentPersona.js";

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export function clientIpHashInput(request) {
  return request.headers.get("cf-connecting-ip")
    || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || "unknown";
}

export async function loadSession(env, id) {
  if (!id) return null;
  const row = await env.LEADS_DB.prepare(
    "SELECT * FROM assessment_sessions WHERE id = ?"
  ).bind(id).first();
  if (!row) return null;
  let state = null;
  try { state = JSON.parse(row.state_json || "null"); } catch {}
  return { row, state };
}

// Upsert the session row from the brain session object.
export async function saveSession(env, session) {
  const now = new Date().toISOString();
  const findings = session.findings || [];
  await env.LEADS_DB.prepare(
    `INSERT INTO assessment_sessions
       (id, consent_at, ip_hash, business_name, business_url, category, contact_name,
        email_hash, acquisition, state_json, findings_json, outcome, followup_consent,
        marketing_opt_out, prefill_token_hash, email_sent_at, created_at, updated_at, closed_at,
        kind, followup_of, prospect_score, prospect_tier, next_best_action)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       consent_at=excluded.consent_at, ip_hash=excluded.ip_hash,
       business_name=excluded.business_name, business_url=excluded.business_url,
       category=excluded.category, contact_name=excluded.contact_name,
       email_hash=excluded.email_hash, acquisition=excluded.acquisition,
       state_json=excluded.state_json, findings_json=excluded.findings_json,
       outcome=excluded.outcome, followup_consent=excluded.followup_consent,
       prefill_token_hash=excluded.prefill_token_hash, email_sent_at=excluded.email_sent_at,
       updated_at=excluded.updated_at, closed_at=excluded.closed_at,
       kind=excluded.kind, followup_of=excluded.followup_of,
       prospect_score=excluded.prospect_score, prospect_tier=excluded.prospect_tier,
       next_best_action=excluded.next_best_action`
  ).bind(
    session.id,
    session.consentGiven ? (session.consentAt || now) : (session.consentAt || null),
    session.ipHash || null,
    session.businessName || null,
    session.url || null,
    session.category || null,
    session.contactName || null,
    session.email ? await sha256hex("assessment-call|" + session.email.toLowerCase()) : (session.emailHash || null),
    session.acquisition || null,
    JSON.stringify(session),
    JSON.stringify(findings),
    session.outcome || null,
    session.followupConsent ? 1 : 0,
    session.marketingOptOut ? 1 : 0,
    session.prefillTokenHash || null,
    session.emailSentAt || null,
    session.createdAt || now,
    now,
    session.outcome ? (session.closedAt || now) : null,
    session.kind || "assessment",
    session.followupOf || null,
    typeof session.prospectScore === "number" ? session.prospectScore : null,
    session.prospectTier || null,
    session.nextBestAction || null,
  ).run();

  // Mirror findings rows (delete + reinsert keeps it idempotent per turn).
  if (findings.length) {
    await env.LEADS_DB.prepare("DELETE FROM assessment_findings WHERE session_id = ?").bind(session.id).run();
    for (const f of findings) {
      await env.LEADS_DB.prepare(
        `INSERT INTO assessment_findings
           (id, session_id, finding_id, severity, severity_source, needs_review, title, observation, evidence)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        crypto.randomUUID(), session.id, f.id, f.severity,
        f.severitySource || "deterministic", f.needsReview ? 1 : 0,
        f.title, f.observation, f.evidence,
      ).run();
    }
  }
}

// Mint an opaque prefill token (7-day TTL). Returns the RAW token (goes in the
// email link); only the hash is stored. Format: act_<64 hex> — unguessable.
export async function mintPrefillToken(env, sessionId, email) {
  const raw = "act_" + [...crypto.getRandomValues(new Uint8Array(32))]
    .map((b) => b.toString(16).padStart(2, "0")).join("");
  const tokenHash = await sha256hex("assessment-prefill|" + raw);
  const emailHash = await sha256hex("assessment-call|" + String(email || "").toLowerCase());
  const expiresAt = new Date(Date.now() + PREFILL_LINK_TTL_DAYS * 86400 * 1000).toISOString();
  await env.LEADS_DB.prepare(
    `INSERT INTO assessment_prefill_tokens (token_hash, session_id, email_hash, expires_at)
     VALUES (?, ?, ?, ?)`
  ).bind(tokenHash, sessionId, emailHash, expiresAt).run();
  await env.LEADS_DB.prepare(
    "UPDATE assessment_sessions SET prefill_token_hash = ?, updated_at = ? WHERE id = ?"
  ).bind(tokenHash, new Date().toISOString(), sessionId).run();
  return { token: raw, tokenHash, expiresAt };
}

// Validate a prefill token; returns the prefill payload for the audit form.
export async function redeemPrefillToken(env, rawToken) {
  if (!rawToken || !String(rawToken).startsWith("act_")) {
    return { ok: false, error: "invalid_token" };
  }
  const tokenHash = await sha256hex("assessment-prefill|" + rawToken);
  const tok = await env.LEADS_DB.prepare(
    "SELECT * FROM assessment_prefill_tokens WHERE token_hash = ?"
  ).bind(tokenHash).first();
  if (!tok) return { ok: false, error: "invalid_token" };
  if (tok.used_at) return { ok: false, error: "token_used" };
  if (Date.parse(tok.expires_at) < Date.now()) return { ok: false, error: "token_expired" };
  const sess = await loadSession(env, tok.session_id);
  if (!sess || !sess.state) return { ok: false, error: "session_not_found" };
  const s = sess.state;
  return {
    ok: true,
    payload: {
      source: "assessment_call",
      session_id: tok.session_id,
      business_name: s.businessName || "",
      url: s.url || "",
      category: s.category || "",
      contact_name: s.contactName || "",
      findings: (s.findings || []).map((f) => ({
        id: f.id, title: f.title, severity: f.severity, observation: f.observation,
      })),
      findings_summary: (s.findings || []).map((f) => `${f.title} (${f.severity})`).join("; "),
      call_minutes: s.turns ? Math.round(s.turns.length / 2) : 0,
      outcome: s.outcome || "",
    },
    tokenHash,
  };
}

export async function markTokenUsed(env, tokenHash) {
  await env.LEADS_DB.prepare(
    "UPDATE assessment_prefill_tokens SET used_at = ? WHERE token_hash = ?"
  ).bind(new Date().toISOString(), tokenHash).run();
}
