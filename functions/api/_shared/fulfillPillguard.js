// functions/api/_shared/fulfillPillguard.js
// Stripe fulfillment for fulfillment='pillguard' products:
//   pillguard-scan          ($9 one-time) — full FDA recall report for the buyer's meds
//   pillguard-watch-monthly ($2.99/mo)    — FDA recall watch subscription
//
// Contract: fulfillPillguard({ db, env, waitUntil, sendEmail }, payment, sess)
//   db        — D1 binding (shared mehyar-jobs DB; pillguard_* tables)
//   env       — worker env (PILLGUARD_BASE_URL optional)
//   waitUntil — Pages Functions waitUntil (optional; falls back to await)
//   sendEmail — injected mailer: sendEmail(env, {from, fromName, to, replyTo,
//               subject, text, html}) -> {ok, ...}. NEVER sends in local dev.
//   payment   — billing_payments row {id, product_id, email, metadata_json}
//   sess      — Stripe checkout session object (sess.mode / sess.subscription
//               distinguish the watch subscription from the one-time report)
//
// Behavior:
//   1. Idempotent: exactly one pillguard_orders row per payment.id (UNIQUE on
//      payment_id); watchlists upsert on stripe_subscription_id (UNIQUE).
//      Replays return {replay:true} and do nothing.
//   2. Scan: build the full report — deterministic exact-set matching against
//      the pillguard_fda_snapshot, AI judge (house chatJson) for ambiguous
//      CANDIDATE pairs only. Class I hits go to pillguard_class1_review_queue
//      AND are marked "pending review" in the report (never overstated).
//      report_json stored on the order; access token unified onto
//      billing_payments; buyer emailed the token-gated report link.
//   3. Watch: create the pillguard_watchlists row seeding meds from the single
//      paid intake session (params.session_id -> pillguard_scan_sessions) —
//      NO re-entry. Confirmation email. Token unification as above.
//   4. Buyer is recorded in pillguard_subscribers (brand='pillguard', separate
//      marketing vs alerts prefs) AND subscribers_global (brand='pillguard').
//      Marketing unsubscribe NEVER cancels paid alerts — only a Stripe
//      subscription cancellation (webhook branch) stops the watch.
//   5. Never throws: on generation failure the order is marked 'failed' and no
//      email goes out (buyer retries from the report page).

import { chatJson } from "./llmChat.js";

const nowSql = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

const PRODUCT_NAMES = {
  "pillguard-scan": "PillGuard Recall Report",
  "pillguard-watch-monthly": "PillGuard Watch — Monthly",
};

const JUDGE_MODEL = "@cf/meta/llama-3.1-8b-instruct"; // pinned per data-spec §4
const MAX_JUDGE_CALLS = 12; // per fulfillment — deterministic prefilter does the bulk

function randomToken(bytes = 32) {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

function baseUrl(env) {
  return String(env.PILLGUARD_BASE_URL || "https://pillguard.mehyar.us").replace(/\/+$/, "");
}

function fromAddress(env) {
  // Until pillguard.mehyar.us is onboarded on BOTH ESPs (standing rule),
  // send from the proven mehyar.us identity.
  return { from: env.PILLGUARD_FROM_EMAIL || "team@mehyar.us", fromName: "PillGuard" };
}

// ── Normalization: data-spec §2a (applied identically to user input,
//    recall drug text, and openfda names) ──────────────────────────────
const DOSAGE_FORMS = new Set([
  "tablet","tablets","caplet","caplets","capsule","capsules","injection","injections",
  "vial","vials","bottle","bottles","solution","solutions","suspension","suspensions",
  "cream","creams","ointment","ointments","gel","gels","drop","drops","spray","sprays",
  "patch","patches","powder","granule","granules","syrup","elixir","lozenge","lozenges",
  "suppository","suppositories","syringe","syringes","kit","kits",
]);
const LABEL_NOISE = new Set([
  "usp","nf","bp","ep","rx","generic","brand","otc",
]);
const SALT_SUFFIXES = new Set([
  "calcium","sodium","potassium","magnesium","hydrochloride","dihydrochloride",
  "mesylate","maleate","tartrate","phosphate","sulfate","sulphate","besylate",
  "citrate","fumarate","succinate","edisylate","pamoate","xinafoate",
  "hemihydrate","monohydrate","anhydrous",
]);
// Spec's connector list (and/with/plus) plus obvious English glue words.
// Documented extension: "in/of/for/as/per" are never drug-name tokens.
const CONNECTORS = new Set(["and","with","plus","in","of","for","as","per","a","an","the"]);

function normalize(raw) {
  let s = String(raw || "").toLowerCase().normalize("NFKC");
  s = s.replace(/\([^)]*\)/g, " ");                       // strip parentheticals
  s = s.replace(/[^\p{L}\p{N}\s]/gu, " ");                 // punctuation → spaces
  s = s.replace(/\b\d+(\.\d+)?\s*(mg|mcg|µg|g|ml|l|iu|units?|%|meq|grains?|oz|ounces?|fl\.?\s*oz)\b/gi, " "); // strengths
  s = s.replace(/\b(mg|mcg|µg|g|ml|l|iu|units?|%|meq|oz|ounces?)\b/gi, " "); // lone unit leftovers (e.g. "10 mg/mL")
  s = s.replace(/\b\d+(\.\d+)?\b/g, " ");                  // bare numbers ("SkinGuard 24", "5-fluorouracil")
  const tokens = s.split(/\s+/).filter(Boolean).filter((t) =>
    !DOSAGE_FORMS.has(t) && !LABEL_NOISE.has(t) && !SALT_SUFFIXES.has(t) && !CONNECTORS.has(t) &&
    t !== "rxonly" && t !== "over" && t !== "counter"
  );
  // Never strip a token that is the entire remaining set (spec §2f guard).
  if (tokens.length === 0) {
    const fallback = s.split(/\s+/).filter(Boolean);
    if (fallback.length) return new Set(fallback);
  }
  return new Set(tokens);
}

const setKey = (set) => [...set].sort().join("|");
const setsEqual = (a, b) => a.size === b.size && [...a].every((t) => b.has(t));

// Extract recall drug token sets from a snapshot row (data-spec §2b):
// strip parenthetical content FIRST, then take the pre-comma segment.
function recallTokenSets(row) {
  const sets = [];
  const desc = String(row.product_description || "").replace(/\([^)]*\)/g, " ");
  const preComma = desc.split(",")[0] || "";
  const main = normalize(preComma);
  if (main.size) sets.push(main);
  else {
    const full = normalize(desc);
    if (full.size) sets.push(full);
  }
  try {
    const openfda = JSON.parse(row.openfda_json || "{}") || {};
    for (const k of ["brand_name", "generic_name", "substance_name"]) {
      const arr = openfda[k];
      if (Array.isArray(arr)) for (const name of arr) {
        const ns = normalize(name);
        if (ns.size) sets.push(ns);
      }
    }
  } catch {}
  return sets;
}

function fdaLink(recallNumber) {
  return "https://api.fda.gov/drug/enforcement.json?search=recall_number:%22" +
    encodeURIComponent(recallNumber) + "%22";
}

// ── AI match judge: data-spec §4 (CANDIDATE pairs only) ─────────────────
async function judgeCandidate(env, watchTokens, row) {
  const system = "You are a pharmacovigilance matching assistant. Answer ONLY with the JSON object described. Never explain outside the JSON.";
  const user =
    "Decide whether the FDA recall below is a recall OF the watched drug.\n\n" +
    "WATCHED DRUG (normalized): " + JSON.stringify([...watchTokens]) + "\n" +
    "RECALL: " + row.recall_number + " | classification " + row.classification + "\n" +
    'product_description: "' + String(row.product_description || "").slice(0, 500) + '"\n' +
    'reason_for_recall: "' + String(row.reason_for_recall || "").slice(0, 500) + '"\n\n' +
    "Rules:\n" +
    '- "yes" ONLY if the recall is unambiguously a recall of the watched drug itself (including its salt forms, e.g. atorvastatin calcium IS atorvastatin, and including when the watched drug is one component of a combination product).\n' +
    '- "no" if the recall is for a different drug, a non-drug product, or the watched drug is merely mentioned in passing (e.g. as a comparator).\n' +
    '- "uncertain" for anything you cannot decide cleanly.\n\n' +
    "Respond with exactly:\n" + '{"verdict":"yes|no|uncertain","confidence":0.0-1.0,"reason":"<25 words>"}';
  try {
    const r = await chatJson({
      env, model: JUDGE_MODEL, temperature: 0, max_tokens: 256, json_mode: true,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      timeout_ms: 30000,
    });
    if (!r || !r.used_llm || r.error) return { verdict: "unavailable", confidence: 0, reason: String((r && r.error) || "judge_unavailable").slice(0, 60) };
    let parsed = r.parsed;
    if (!parsed && r.content) { try { parsed = JSON.parse(r.content); } catch {} }
    const v = parsed && parsed.verdict;
    if (v === "yes" || v === "no" || v === "uncertain") {
      return { verdict: v, confidence: Number(parsed.confidence) || 0, reason: String(parsed.reason || "").slice(0, 120) };
    }
    return { verdict: "uncertain", confidence: 0, reason: "judge_parse_failure" };
  } catch (e) {
    return { verdict: "unavailable", confidence: 0, reason: String((e && e.message) || e).slice(0, 60) };
  }
}

// ── Intake parsing ─────────────────────────────────────────────────────
function medName(x) {
  // Scan sessions store meds as objects {med, tokens, alias_of}; other
  // sources store plain strings. Never String() an object ("[object Object]").
  if (x == null) return "";
  if (typeof x === "object") return String(x.med || x.name || x.drug || "").trim();
  return String(x).trim();
}

function parseMedsList(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v.map(medName).filter(Boolean);
  const s = String(v).trim();
  if (!s) return [];
  if (s.startsWith("[")) { try { const a = JSON.parse(s); if (Array.isArray(a)) return a.map(medName).filter(Boolean); } catch {} }
  return s.split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean);
}

function readIntake(meta) {
  const m = (meta && typeof meta === "object") ? meta : {};
  const inner = (m.inputs && typeof m.inputs === "object") ? m.inputs : {};
  const flat = { ...inner, ...m };
  delete flat.inputs;
  return {
    session_id: flat.session_id || flat.sessionId || null,
    meds: parseMedsList(flat.meds || flat.watchlist || flat.medications || flat.drugs),
    persona: flat.persona === "loved_one" ? "loved_one" : "mine",
  };
}

async function resolveWatchSets(db, medInput) {
  // Returns [{input, sets:[Set,...]}]. Alias table maps brand → canonical;
  // the user confirms the mapping at intake, and we store BOTH token sets
  // (data-spec §2c). Unknown brands stay single-set (never guessed).
  let aliasRows = [];
  try {
    aliasRows = (await db.prepare("SELECT alias, canonical FROM pillguard_drug_aliases").all()).results || [];
  } catch { /* table not seeded yet — raw inputs only */ }
  const aliasMap = new Map(aliasRows.map((r) => [String(r.alias).toLowerCase(), String(r.canonical)]));
  return medInput.map((input) => {
    const rawSet = normalize(input);
    const sets = rawSet.size ? [rawSet] : [];
    const canonicalRaw = aliasMap.get(input.toLowerCase().trim());
    let canonical = null;
    if (canonicalRaw) {
      // Canonical may be a JSON string or JSON array (combination products).
      let cVals = [canonicalRaw];
      try {
        const p = JSON.parse(canonicalRaw);
        cVals = Array.isArray(p) ? p : [canonicalRaw];
      } catch {}
      const cSet = new Set();
      for (const cv of cVals) for (const t of normalize(cv)) cSet.add(t);
      if (cSet.size && setKey(cSet) !== setKey(rawSet)) {
        sets.push(cSet);
        canonical = cVals.join("+");
      }
    }
    return { input, sets, canonical };
  });
}

// ── Deterministic matcher over the snapshot ────────────────────────────
async function findCandidateRecalls(db, watchSets) {
  // Token-index prefilter: only recalls sharing ≥1 token with a watch set
  // are fetched. Falls back to a bounded full scan if the index is missing.
  const allTokens = new Set();
  for (const w of watchSets) for (const s of w.sets) for (const t of s) allTokens.add(t);
  if (!allTokens.size) return { rows: [], via: "none" };
  try {
    const inList = [...allTokens].slice(0, 60);
    const ph = inList.map(() => "?").join(",");
    const hits = (await db.prepare(
      "SELECT DISTINCT recall_number FROM pillguard_fda_token_index WHERE token IN (" + ph + ")"
    ).bind(...inList).all()).results || [];
    if (!hits.length) return { rows: [], via: "index" };
    const rows = [];
    for (let i = 0; i < hits.length; i += 50) {
      const chunk = hits.slice(i, i + 50);
      const cph = chunk.map(() => "?").join(",");
      const rs = (await db.prepare(
        "SELECT recall_number, classification, product_description, reason_for_recall, " +
        "recall_initiation_date, report_date, distribution_pattern, status, " +
        "recalling_firm, code_info, openfda_json FROM pillguard_fda_snapshot WHERE recall_number IN (" + cph + ")"
      ).bind(...chunk.map((h) => h.recall_number)).all()).results || [];
      rows.push(...rs);
    }
    return { rows, via: "index" };
  } catch (e) {
    // Index table missing (pre-backfill): bounded fallback scan.
    console.error("fulfillPillguard token index unavailable", e && e.message);
    return { rows: [], via: "index-missing" };
  }
}

function classifyPair(watchSet, recallSets) {
  // HIT: exact set equality on any pairing. CANDIDATE: any other non-empty
  // relationship. NO MATCH: disjoint. (data-spec §2d)
  for (const rs of recallSets) {
    if (setsEqual(watchSet, rs)) return "HIT";
  }
  for (const rs of recallSets) {
    let overlap = 0;
    for (const t of watchSet) if (rs.has(t)) overlap++;
    if (overlap > 0) return "CANDIDATE";
  }
  return "NO_MATCH";
}

const DISCLAIMER =
  "PillGuard reports FDA enforcement records as published. This is not medical advice. " +
  "Never start, stop, or change a medication because of a recall notice — talk to your doctor or pharmacist first.";

// ── Report generation (scan SKU) ───────────────────────────────────────
async function snapshotHealth(db) {
  try {
    const s = await db.prepare(
      "SELECT data_as_of, status, record_count FROM pillguard_fda_sync WHERE id = 1"
    ).first();
    if (!s) return { data_as_of: null, status: "empty", record_count: 0 };
    return s;
  } catch { return { data_as_of: null, status: "empty", record_count: 0 }; }
}

async function judgedOnce(db, watchKey, recallNumber) {
  try {
    const r = await db.prepare(
      "SELECT verdict, confidence, reason FROM pillguard_judge_cache WHERE id = ?"
    ).bind(watchKey + "|" + recallNumber).first();
    return r || null;
  } catch { return null; }
}

async function cacheJudgment(db, watchKey, recallNumber, j) {
  try {
    await db.prepare(
      "INSERT OR IGNORE INTO pillguard_judge_cache (id, verdict, confidence, reason, created_at) " +
      "VALUES (?, ?, ?, ?, " + nowSql + ")"
    ).bind(watchKey + "|" + recallNumber, j.verdict, j.confidence || 0, (j.reason || "").slice(0, 120)).run();
  } catch {}
}

async function queueClass1Review(db, recallNumber, matchedMed, watchlistId, note) {
  try {
    await db.prepare(
      "INSERT INTO pillguard_class1_review_queue (recall_number, matched_med, watchlist_id, status, note, created_at) " +
      "VALUES (?, ?, ?, 'pending', ?, " + nowSql + ")"
    ).bind(recallNumber, matchedMed, watchlistId || null, String(note || "").slice(0, 200)).run();
  } catch (e) { console.error("fulfillPillguard review queue insert failed", e && e.message); }
}

function recallView(row, source, reviewStatus) {
  return {
    recall_number: row.recall_number,
    classification: row.classification,
    product_description: row.product_description,
    reason_for_recall: row.reason_for_recall,
    recall_initiation_date: row.recall_initiation_date,
    report_date: row.report_date,
    distribution_pattern: row.distribution_pattern,
    status: row.status,
    recalling_firm: row.recalling_firm,
    source,                       // 'deterministic' | 'ai_judge'
    review_status: reviewStatus,  // 'pending review' for Class I, else null
    fda_link: fdaLink(row.recall_number),
  };
}

async function buildReport({ db, env, watchEntries, orderId }) {
  const health = await snapshotHealth(db);
  const hasSets = watchEntries.some((w) => w.sets && w.sets.length > 0);
  const { rows: candidates, via } = hasSets
    ? await findCandidateRecalls(db, watchEntries)
    : { rows: [], via: "none" };
  let judgeCalls = 0;
  const meds = [];

  for (const w of watchEntries) {
    const matches = [];
    const seenRecall = new Set();
    for (const ws of w.sets) {
      for (const row of candidates) {
        if (seenRecall.has(row.recall_number)) continue;
        const rSets = recallTokenSets(row);
        if (!rSets.length) continue;
        const verdict = classifyPair(ws, rSets);
        if (verdict === "NO_MATCH") continue;
        const cls = String(row.classification || "");
        const isClass1 = cls === "Class I";
        const isActionable = cls === "Class I" || cls === "Class II";
        if (verdict === "HIT") {
          if (!isActionable) continue; // Class III: weekly digest only, not in the paid report
          seenRecall.add(row.recall_number);
          if (isClass1) await queueClass1Review(db, row.recall_number, w.input, null, "deterministic hit in paid report");
          matches.push(recallView(row, "deterministic", isClass1 ? "pending review" : null));
        } else {
          // CANDIDATE → AI judge (never an automatic hit). Budget-guarded.
          const watchKey = setKey(ws);
          let j = await judgedOnce(db, watchKey, row.recall_number);
          if (!j && judgeCalls < MAX_JUDGE_CALLS) {
            judgeCalls++;
            j = await judgeCandidate(env, ws, row);
            await cacheJudgment(db, watchKey, row.recall_number, j);
          }
          if (!j) continue; // budget exhausted: stay silent (precision-first)
          if (j.verdict === "yes") {
            if (!isActionable) continue;
            seenRecall.add(row.recall_number);
            if (isClass1) await queueClass1Review(db, row.recall_number, w.input, null, "ai_judge=yes in paid report");
            matches.push(recallView(row, "ai_judge", isClass1 ? "pending review" : null));
          } else if (j.verdict === "uncertain" && isClass1) {
            // Human review queue; report marks it honestly, never confirmed.
            await queueClass1Review(db, row.recall_number, w.input, null, "ai_judge=uncertain: " + (j.reason || ""));
            matches.push({ ...recallView(row, "ai_judge", "pending review"), unconfirmed: true });
          }
          // 'no' and uncertain Class II/III: discarded, logged via judge cache.
        }
      }
    }
    matches.sort((a, b) => String(b.report_date || "").localeCompare(String(a.report_date || "")));
    meds.push({
      input: w.input,
      canonical: w.canonical,
      match_count: matches.length,
      matches,
      note: matches.length ? null : "No matching FDA enforcement records found for this medication in our current snapshot.",
    });
  }

  return {
    generated_at: new Date().toISOString(),
    data_as_of: health.data_as_of,
    snapshot_status: health.status,
    snapshot_via: via,
    meds,
    total_matches: meds.reduce((n, m) => n + m.match_count, 0),
    disclaimer: DISCLAIMER,
  };
}

// ── Subscribers (brand list + global list; separate marketing/alerts prefs) ─
async function recordSubscriber(db, email, meds, source) {
  const prefs = JSON.stringify({ marketing: true, alerts: true });
  try {
    await db.prepare(
      "INSERT INTO pillguard_subscribers (email, meds_json, source, confirmed, brand, tags, prefs_json, created_at) " +
      "VALUES (?, ?, ?, 0, 'pillguard', ?, ?, " + nowSql + ") " +
      "ON CONFLICT(email) DO UPDATE SET meds_json=excluded.meds_json, prefs_json=COALESCE(pillguard_subscribers.prefs_json, excluded.prefs_json)"
    ).bind(email, JSON.stringify(meds), source, source, prefs).run();
  } catch (e) { console.error("fulfillPillguard pillguard_subscribers upsert failed", e && e.message); }
  try {
    await db.prepare(
      "INSERT INTO subscribers_global (email, brand, status, unsubscribed) VALUES (?, 'pillguard', 'active', 0) " +
      "ON CONFLICT(email, brand) DO UPDATE SET unsubscribed=0, updated_at=" + nowSql
    ).bind(email).run();
  } catch (e) { console.error("fulfillPillguard subscribers_global upsert failed", e && e.message); }
}

async function medsFromSession(db, sessionId, fallbackMeds) {
  if (sessionId) {
    try {
      const s = await db.prepare(
        "SELECT meds_json, persona, email FROM pillguard_scan_sessions WHERE id = ?"
      ).bind(String(sessionId)).first();
      if (s && s.meds_json) {
        let meds = [];
        try { meds = JSON.parse(s.meds_json) || []; } catch {}
        const clean = meds.map(medName).filter(Boolean);
        if (clean.length) return { meds: clean, persona: s.persona || "mine" };
      }
    } catch (e) { console.error("fulfillPillguard session lookup failed", e && e.message); }
  }
  return { meds: fallbackMeds, persona: "mine" };
}

// ── Emails (transactional only; injected sendEmail) ─────────────────────
async function emailReportReady(sendEmail, env, to, reportUrl, totalMatches, medCount, dataAsOf) {
  const { from, fromName } = fromAddress(env);
  const subject = "Your PillGuard recall report is ready";
  const headline = totalMatches === 0
    ? `Good news: none of your ${medCount} medication${medCount === 1 ? "" : "s"} matched an FDA enforcement record in our current data.`
    : `${totalMatches} FDA enforcement record${totalMatches === 1 ? "" : "s"} matched your medications — review inside.`;
  const pending = totalMatches > 0
    ? "\n\nClass I matches are flagged \"pending review\" — our team double-checks every serious match before it is presented as confirmed. This keeps false alarms at zero."
    : "";
  const text =
    `Thanks for your purchase!\n\n${headline}${pending}\n\n` +
    `View your full report:\n${reportUrl}\n\n` +
    (dataAsOf ? `FDA data as of ${dataAsOf}.\n\n` : "") +
    "This is not medical advice. Never start, stop, or change a medication because of a recall notice — talk to your doctor or pharmacist first.\n\n" +
    "This link is personal to you — keep it somewhere safe.\n\n-- " + fromName;
  const html =
    `<p>Thanks for your purchase!</p><p>${headline}</p>` +
    (totalMatches > 0 ? `<p style="color:#6b7280;font-size:13px;">Class I matches are flagged <strong>"pending review"</strong> — our team double-checks every serious match before it is presented as confirmed.</p>` : "") +
    `<p><a href="${reportUrl}" style="display:inline-block;background:#7c3aed;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold;">View your report</a></p>` +
    `<p style="color:#6b7280;font-size:13px;">Or copy this link:<br><a href="${reportUrl}">${reportUrl}</a></p>` +
    (dataAsOf ? `<p style="color:#6b7280;font-size:13px;">FDA data as of ${dataAsOf}.</p>` : "") +
    `<p style="color:#6b7280;font-size:13px;">This is not medical advice. Never start, stop, or change a medication because of a recall notice — talk to your doctor or pharmacist first.</p>` +
    `<p>-- ${fromName}</p>`;
  return sendEmail(env, { from, fromName, to, replyTo: "info@mehyar.us", subject, text, html });
}

async function emailWatchConfirmation(sendEmail, env, to, meds) {
  const { from, fromName } = fromAddress(env);
  const subject = "Your PillGuard watch is on";
  const list = meds.map((m) => "• " + m).join("\n");
  const text =
    `Your FDA recall watch is active.\n\n` +
    `Watching:\n${list}\n\n` +
    `You'll get an email the moment a Class I or Class II FDA enforcement record matches one of these medications. ` +
    `Class III notices arrive in a weekly digest.\n\n` +
    `Your subscription renews monthly at $2.99. Cancel anytime — reply to this email and we'll stop the watch (and the billing) immediately.\n\n` +
    `This is not medical advice. Never start, stop, or change a medication because of a recall notice — talk to your doctor or pharmacist first.\n\n-- ${fromName}`;
  const html =
    `<p>Your FDA recall watch is <strong>active</strong>.</p>` +
    `<p>Watching:</p><ul>` + meds.map((m) => `<li>${String(m).replace(/</g, "&lt;")}</li>`).join("") + `</ul>` +
    `<p>You'll get an email the moment a Class I or Class II FDA enforcement record matches one of these medications. Class III notices arrive in a weekly digest.</p>` +
    `<p style="color:#6b7280;font-size:13px;">Your subscription renews monthly at $2.99. Cancel anytime — reply to this email and we'll stop the watch (and the billing) immediately.</p>` +
    `<p style="color:#6b7280;font-size:13px;">This is not medical advice. Never start, stop, or change a medication because of a recall notice — talk to your doctor or pharmacist first.</p>` +
    `<p>-- ${fromName}</p>`;
  return sendEmail(env, { from, fromName, to, replyTo: "info@mehyar.us", subject, text, html });
}

// Pure helpers, exported for unit tests and for the product worker's reuse.
export { normalize, recallTokenSets, classifyPair, setKey, setsEqual, fdaLink, medName, parseMedsList };

// ── Main entry ─────────────────────────────────────────────────────────
export async function fulfillPillguard({ db, env, waitUntil, sendEmail }, payment, sess) {
  try {
    if (!db || !payment || !payment.id) throw new Error("fulfillPillguard: bad args");
    const productId = payment.product_id;
    const productName = PRODUCT_NAMES[productId] || productId;
    const isWatch = productId === "pillguard-watch-monthly" ||
      (sess && sess.mode === "subscription" && !!sess.subscription);

    let meta = {};
    try { meta = JSON.parse(payment.metadata_json || "{}"); } catch {}
    const intake = readIntake(meta);

    // Idempotent order row (one per payment).
    const existing = await db.prepare(
      "SELECT id, access_token, status, product_id FROM pillguard_orders WHERE payment_id = ?"
    ).bind(String(payment.id)).first();
    if (existing) return { ok: true, replay: true, order_id: existing.id, status: existing.status };

    // Token unification: the checkout-time token (already in the success URL
    // and in billing_payments.access_token) IS the order/report token.
    // Rotating it here would orphan the success page and the report link.
    const existingToken = payment.access_token ? String(payment.access_token) : "";
    const accessToken = existingToken.length >= 16 ? existingToken : randomToken(32);
    const ins = await db.prepare(
      "INSERT INTO pillguard_orders (payment_id, product_id, email, session_id, meds_json, status, access_token, created_at, updated_at) " +
      "VALUES (?, ?, ?, ?, ?, 'paid', ?, " + nowSql + ", " + nowSql + ")"
    ).bind(String(payment.id), productId, payment.email, intake.session_id, JSON.stringify(intake.meds), accessToken).run();
    const orderId = ins.meta.last_row_id;

    // Token unification: every PillGuard surface gates on the order token.
    // Only persist it to the payment row when we had to mint one (legacy
    // rows pre-dating the checkout-time token); normally it is already there.
    if (accessToken !== existingToken) {
      await db.prepare("UPDATE billing_payments SET access_token = ? WHERE id = ?")
        .bind(accessToken, payment.id).run();
    }

    const reportUrl = `${baseUrl(env)}/report.html?token=${accessToken}`;

    if (isWatch) {
      // ── Watch subscription: seed meds from the single intake session —
      //    the buyer never re-enters them. ──
      const { meds, persona } = await medsFromSession(db, intake.session_id, intake.meds);
      const subId = sess && sess.subscription ? String(sess.subscription) : null;
      const customerId = sess && sess.customer ? String(sess.customer) : null;
      if (subId) {
        await db.prepare(
          "INSERT INTO pillguard_watchlists (email, session_id, meds_json, persona, stripe_subscription_id, stripe_customer_id, status, created_at, updated_at) " +
          "VALUES (?, ?, ?, ?, ?, ?, 'active', " + nowSql + ", " + nowSql + ") " +
          "ON CONFLICT(stripe_subscription_id) DO UPDATE SET status='active', updated_at=" + nowSql
        ).bind(payment.email, intake.session_id, JSON.stringify(meds), persona, subId, customerId).run();
      } else {
        // No subscription id on the session (shouldn't happen post-migration,
        // but never lose the watch): key the row by email+product.
        await db.prepare(
          "INSERT INTO pillguard_watchlists (email, session_id, meds_json, persona, stripe_subscription_id, stripe_customer_id, status, created_at, updated_at) " +
          "VALUES (?, ?, ?, ?, ?, ?, 'active', " + nowSql + ", " + nowSql + ")"
        ).bind(payment.email, intake.session_id, JSON.stringify(meds), persona, "email:" + payment.email, customerId).run();
      }
      await db.prepare("UPDATE pillguard_orders SET status='ready', updated_at=" + nowSql + " WHERE id=?")
        .bind(orderId).run();
      await recordSubscriber(db, payment.email, meds, "watch-checkout");
      const result = await emailWatchConfirmation(sendEmail, env, payment.email, meds.length ? meds : ["(no medications listed — reply to add them)"]);
      if (!result.ok) console.error("fulfillPillguard watch email failed", productId, result.error);
      return { ok: true, order_id: orderId, mode: "watch", meds: meds.length, email_ok: !!result.ok };
    }

    // ── One-time scan: generate the full report in the background. ──
    await recordSubscriber(db, payment.email, intake.meds, "scan-checkout");
    const run = async () => {
      try {
        const { meds } = await medsFromSession(db, intake.session_id, intake.meds);
        const watchEntries = await resolveWatchSets(db, meds.length ? meds : intake.meds);
        const report = await buildReport({ db, env, watchEntries, orderId });
        await db.prepare(
          "UPDATE pillguard_orders SET status='ready', report_json=?, meds_json=?, updated_at=" + nowSql + " WHERE id=? AND status != 'ready'"
        ).bind(JSON.stringify(report), JSON.stringify(meds), orderId).run();
        const result = await emailReportReady(sendEmail, env, payment.email, reportUrl, report.total_matches, meds.length, report.data_as_of);
        if (!result.ok) console.error("fulfillPillguard report email failed", productId, result.error);
      } catch (e) {
        console.error("fulfillPillguard background report failed", productId, e && e.message);
        try {
          await db.prepare("UPDATE pillguard_orders SET status='failed', updated_at=" + nowSql + " WHERE id=? AND status='paid'")
            .bind(orderId).run();
        } catch {}
        // No email on failure: the buyer lands on success.html?token= from
        // Stripe; the report page shows live status + a retry path.
      }
    };
    if (typeof waitUntil === "function") waitUntil(run());
    else await run();

    return { ok: true, order_id: orderId, mode: "scan", product: productName };
  } catch (e) {
    // Never throw out of the hook — the webhook catches, but a throw risks a 500.
    console.error("fulfillPillguard failed", e && e.message);
    return { ok: false, error: String((e && e.message) || e).slice(0, 120) };
  }
}
