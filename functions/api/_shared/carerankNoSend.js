// functions/api/_shared/carerankNoSend.js
// STAGING GUARD — CareRank email no-send rule.
//
// Mayor's standing rule (since 2026-09-17): NEVER send external email without
// his explicit word. While CARE_RANK_NO_SEND is true, every CareRank email
// (subscribe preview, paid deliverable) is STAGED into the D1 table
// carerank_outbox — full payload + one-click unsubscribe URL preserved for
// audit — and NOTHING is sent to any recipient.
//
// The product works fine with email staged: free previews and paid reports
// are delivered in-browser via token-gated URLs, not by email.
//
// Flip CARE_RANK_NO_SEND to false ONLY when Mayor explicitly approves
// CareRank email. A code change + deploy is deliberately required — there is
// no env-var backdoor.
export const CARE_RANK_NO_SEND = true;

async function ensureOutbox(db) {
  await db
    .prepare(
      "CREATE TABLE IF NOT EXISTS carerank_outbox (" +
        "id INTEGER PRIMARY KEY AUTOINCREMENT, " +
        "email TEXT NOT NULL, " +
        "kind TEXT NOT NULL, " +
        "subject TEXT, " +
        "text TEXT, " +
        "html TEXT, " +
        "unsub_url TEXT, " +
        "headers_json TEXT, " +
        "created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))"
    )
    .run();
}

// maybeSendCarerankEmail(db, sendFn, { kind, unsubUrl, args })
//   sendFn — zero-arg thunk that performs the real send, e.g.
//            () => sendCloudflareEmail(env, args) or () => sendEmail(env, args).
//            Never invoked while the guard is on.
//   args   — the email payload {from, fromName, to, replyTo, subject, text,
//            html, headers} passed to sendFn.
export async function maybeSendCarerankEmail(db, sendFn, email) {
  if (!CARE_RANK_NO_SEND) {
    return await sendFn();
  }
  try {
    await ensureOutbox(db);
    await db
      .prepare(
        "INSERT INTO carerank_outbox (email, kind, subject, text, html, unsub_url, headers_json) VALUES (?,?,?,?,?,?,?)"
      )
      .bind(
        String((email.args && email.args.to) || ""),
        String(email.kind || "carerank"),
        String((email.args && email.args.subject) || ""),
        String((email.args && email.args.text) || "").slice(0, 20000),
        String((email.args && email.args.html) || "").slice(0, 40000),
        String(email.unsubUrl || ""),
        JSON.stringify((email.args && email.args.headers) || {})
      )
      .run();
  } catch (e) {
    console.error("carerank outbox stage failed", e && e.message);
  }
  console.log("carerank email STAGED (no-send guard on):", email.kind, email.args && email.args.to);
  return { ok: true, staged: true };
}
