// functions/api/_shared/auditBusinessBuild.js
// Paid-report builder for "Audit My Business" ($330 one-time audit).
// Used by POST /api/audit/business/generate (webhook-driven) and the admin
// retry endpoint. Idempotent: the row is claimed with a status lease so a
// re-fire never double-builds a ready report.
//
// HONESTY CONTRACT (standing):
// - Every number traces to a measured check (deterministicScore) or to the
//   LLM's cited rationale. Nothing is invented.
// - AI findings pass through decide(): auto-confidence findings are stated
//   as findings; anything below the auto threshold is labeled "Needs review"
//   and never stated as fact.
// - Sections that couldn't be assessed (fetch failed, no transcript) SAY SO.
// - Dollar figures are estimates with the word "Estimated" and no fake
//   precision.

import { chatJson, safeJsonParse } from "./llmChat.js";
import { decide, verdict, DECIDE_THRESHOLDS } from "./decide.js";
import { transcribeWalkthrough } from "./auditTranscribe.js";
import {
  normalizeUrl, sanitize, escapeHtml,
  extractBusinessSignals, deterministicScore, scoreGrade,
} from "./auditBusinessShared.js";

const FROM_EMAIL = "audit@mehyar.us";
const OWNER_EMAIL = "mrswelim@gmail.com";
const UNSUB_URL = "https://mehyar.us/unsubscribe";
const PHYSICAL = "MehyarSoft LLC, 228 Park Ave S #92842, New York, NY 10003";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
// NOTE: browser User-Agent is REQUIRED — non-browser clients get bot-blocked
// (Cloudflare 1010) on bot-managed hosts. Never route through the managed
// browser; this is a plain server-side fetch.
const STUCK_MINUTES = 15;
const FETCH_TIMEOUT_MS = 15000;
const BYTE_CAP = 500_000;
const LLAMA_70B = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

function nowIso() { return new Date().toISOString(); }

async function fetchSignals(url) {
  const t0 = Date.now();
  let html = "", status = 0, finalUrl = url, byteLength = 0;
  try {
    const resp = await fetch(url, {
      redirect: "follow",
      headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    status = resp.status;
    finalUrl = resp.url || url;
    const ct = resp.headers.get("content-type") || "";
    if (ct.includes("html") || ct.includes("text")) {
      const buf = await resp.arrayBuffer();
      byteLength = buf.byteLength;
      html = new TextDecoder("utf-8", { fatal: false }).decode(buf.slice(0, BYTE_CAP));
    }
  } catch (e) {
    throw new Error("fetch_failed:" + String((e && e.message) || e).slice(0, 80));
  }
  if (!html || status >= 400) throw new Error("fetch_failed:bad_status_" + status);
  return extractBusinessSignals(html, { requestedUrl: url, finalUrl, status, loadMs: Date.now() - t0 }, byteLength);
}

// ── LLM findings ─────────────────────────────────────────────────────────
const FINDINGS_SYSTEM = `You are a senior conversion-rate auditor writing a paid website audit.
You receive MEASURED signals from a real fetch of the business's homepage plus
an optional transcript of the owner's video walkthrough. Output STRICT JSON.

Rules:
- Every finding MUST cite its evidence: the exact signal or transcript quote
  that supports it. If a claim isn't supported by the evidence, do not make it.
- "confidence" is YOUR self-assessed probability (0-1) the finding is correct
  given the evidence. Be calibrated: 0.9+ only for directly observed facts.
- "severity" 1-5: 5 = losing money every day, 1 = polish.
- Dollar figures are rough estimates only. Prefix with "Estimated" and keep
  them round (no fake precision like $4,237).
- "ai_score" 0-100: your holistic assessment of the site. "score_rationale"
  MUST name the specific signals that drove it.
- "video_notes": what the walkthrough transcript reveals about the business
  (offer, objections, process). If no transcript was provided, set null —
  never invent walkthrough content.
- Keep each list tight: money_leaks <= 6, flaws <= 6, suggestions <= 6,
  ai_opportunities <= 4, prioritized_fixes <= 5.

JSON shape:
{"business_type":"<slug>","business_type_label":"<label>",
 "executive_summary":"<3 sentences>",
 "money_leaks":[{"title":"...","detail":"...","evidence":"...","severity":1-5,"confidence":0-1,"estimated_monthly_impact":"Estimated ..."}],
 "flaws":[{"title":"...","detail":"...","evidence":"...","severity":1-5,"confidence":0-1}],
 "suggestions":[{"title":"...","detail":"...","evidence":"...","severity":1-5,"confidence":0-1,"effort":"..."}],
 "ai_opportunities":[{"title":"...","detail":"...","evidence":"...","severity":1-5,"confidence":0-1,"estimated_monthly_upside":"Estimated ..."}],
 "prioritized_fixes":[{"title":"...","detail":"...","evidence":"...","severity":1-5,"confidence":0-1,"effort":"..."}],
 "video_notes": null,
 "ai_score": 0-100,
 "score_rationale":"..."}`;

function buildFindingsUserMessage(signals, det, transcript, coverage, businessName) {
  const sig = {
    url: signals.finalUrl, https: signals.https, load_ms: signals.loadMs,
    title: signals.title, meta_description: signals.metaDescription,
    og_tags: signals.hasOgTags, h1: signals.h1, h1_count: signals.h1Count,
    headlines: signals.headlines, word_count: signals.wordCount,
    page_weight_kb: signals.pageWeightKb,
    has_phone: signals.hasPhone, has_email: signals.hasEmail,
    has_contact_link: signals.hasContactLink, form_count: signals.formCount,
    cta_count: signals.ctaCount, ctas: signals.ctas,
    has_viewport: signals.hasViewport, socials: signals.socials,
    pixels: signals.pixels, trust: signals.trust,
    images_missing_alt: signals.imagesMissingAlt, image_count: signals.imageCount,
    has_schema: signals.hasSchema, has_address: signals.hasAddress,
    text_sample: signals.textSample,
  };
  let msg = `Business: ${businessName || "(not given)"}\n`;
  msg += `Measured homepage signals (from a real fetch):\n${JSON.stringify(sig).slice(0, 6000)}\n`;
  msg += `Deterministic score from the same signals: ${det.score}/100 (parts: ${JSON.stringify(det.parts)})\n`;
  if (transcript) {
    msg += `Owner walkthrough transcript (${coverage}):\n${transcript.slice(0, 6000)}\n`;
  } else {
    msg += `No walkthrough transcript was provided — set video_notes to null.\n`;
  }
  msg += `Write the audit JSON.`;
  return msg;
}

async function llmFindings(env, system, userMessage) {
  // Llama 3.3 70B per the product spec; fall back to the proven default.
  const models = [LLAMA_70B, null];
  let lastErr = "";
  for (const model of models) {
    const ai = await chatJson({
      env, model: model || undefined,
      messages: [
        { role: "system", content: system },
        { role: "user", content: userMessage },
      ],
      max_tokens: 4000, temperature: 0.3, timeout_ms: 150000,
    });
    if (ai.used_llm && ai.content) {
      const parsed = safeJsonParse(ai.content, null);
      if (parsed && typeof parsed === "object" && Array.isArray(parsed.money_leaks)) return { ok: true, data: parsed, model: ai.model };
      lastErr = "bad_json";
    } else {
      lastErr = ai.error || "llm_failed";
    }
  }
  return { ok: false, error: lastErr };
}

// ── decide() gating ──────────────────────────────────────────────────────
// Every AI finding is verified against the evidence pack with two typed
// questions: support (noul) + severity (score). verdict() with the
// audit_finding preset decides:
//   auto   (conf >= 0.8)  -> stated as a finding
//   review (conf >= 0.55) -> included, labeled "Needs review", never fact
//   fail   (< 0.55 / backend down) -> included, labeled "Needs review"
// The decision backend can never silently upgrade a finding: fail-closed.
const FINDING_LISTS = ["money_leaks", "flaws", "suggestions", "ai_opportunities", "prioritized_fixes"];

function evidencePackText(signals, det, transcript, coverage) {
  const lines = [
    `URL: ${signals.finalUrl} (HTTP ${signals.status}, loaded in ${signals.loadMs}ms)`,
    `Title: ${signals.title || "(none)"} | Meta description: ${signals.metaDescription ? "present" : "missing"} | H1: ${signals.h1 || "(none)"}`,
    `HTTPS: ${signals.https} | Mobile viewport: ${signals.hasViewport} | Schema.org: ${signals.hasSchema}`,
    `Contact: phone=${signals.hasPhone} email=${signals.hasEmail} contact_link=${signals.hasContactLink} forms=${signals.formCount}`,
    `CTAs (${signals.ctaCount}): ${(signals.ctas || []).join("; ") || "(none detected)"}`,
    `Words: ${signals.wordCount} | Page weight: ${signals.pageWeightKb}KB | Images: ${signals.imageCount} (${signals.imagesMissingAlt} missing alt)`,
    `Trust: ${(signals.trust || []).join(", ") || "none"} | Socials: ${(signals.socials || []).join(", ") || "none"} | Pixels: ${(signals.pixels || []).join(", ") || "none"}`,
    `Deterministic score: ${det.score}/100`,
  ];
  if (transcript) lines.push(`Walkthrough transcript (${coverage}): ${transcript.slice(0, 2500)}`);
  else lines.push(`No walkthrough transcript provided.`);
  return lines.join("\n");
}

async function gateFindings(env, findings, evidenceText, auditId, decideFn) {
  const questions = {};
  const order = []; // [{list, idx, qid}]
  for (const list of FINDING_LISTS) {
    const arr = Array.isArray(findings[list]) ? findings[list] : [];
    arr.forEach((f, idx) => {
      const qid = `${list}_${idx}`;
      order.push({ list, idx, qid });
      questions[`${qid}_support`] = {
        type: "noul",
        ask: `This finding about the business website is directly supported by the evidence. Finding: "${f.title || ""}" — ${f.detail || ""}. Cited evidence: "${f.evidence || ""}".`,
      };
      questions[`${qid}_severity`] = {
        type: "score",
        ask: `How severe or business-important is this finding? Finding: "${f.title || ""}" — ${f.detail || ""}.`,
        levels: ["Trivial", "Minor", "Notable", "Important", "Critical"],
      };
    });
  }
  if (!order.length) return { gated: findings, decideOk: true, gated_count: 0 };

  const th = DECIDE_THRESHOLDS.audit_finding;
  const state = `AUDIT EVIDENCE (audit ${auditId}):\n${evidenceText}`;
  const runDecide = decideFn || decide;
  let res;
  try {
    res = await runDecide(env, state, questions, {
      tag: `audit_business:${auditId}`,
      audit: (entry) => {
        // Persist the decision audit trail (question ids + decisions +
        // confidences only — decide() never logs state text).
        try {
          env.LEADS_DB.prepare(
            "UPDATE audit_business_reports SET findings_json = json_insert(COALESCE(findings_json,'{}'), '$.decide_audit', json(?)) WHERE id = ?"
          ).bind(JSON.stringify({ ts: entry.ts, questions: entry.questions }), auditId).run().catch(() => {});
        } catch { /* audit must never break the build */ }
      },
    });
  } catch (e) {
    res = { ok: false, error: String((e && e.message) || e) };
  }

  const gated = JSON.parse(JSON.stringify(findings));
  let autoCount = 0, reviewCount = 0;
  for (const { list, idx, qid } of order) {
    const f = gated[list][idx];
    const support = res.answers ? res.answers[`${qid}_support`] : null;
    const severity = res.answers ? res.answers[`${qid}_severity`] : null;
    const v = verdict(support, th);
    if (v === "auto") {
      f.gating = { verdict: "auto", support_confidence: round3(support.confidence) };
      autoCount++;
    } else {
      f.gating = {
        verdict: "review",
        needs_review: true,
        support_confidence: support && support.ok ? round3(support.confidence) : null,
        decide_note: !res.ok ? "decision backend unavailable — unverified" : "below auto-confidence — verify before acting",
      };
      reviewCount++;
    }
    if (severity && severity.ok) {
      // decide()'s severity score (0-100) corroborates or tempers the LLM's 1-5.
      f.decide_severity_100 = severity.decision;
    }
  }
  return { gated, decideOk: !!res.ok, auto_count: autoCount, review_count: reviewCount };
}

function round3(n) {
  return typeof n === "number" && Number.isFinite(n) ? Math.round(n * 1000) / 1000 : n;
}

// ── HTML report ──────────────────────────────────────────────────────────
function findingCard(f, accent) {
  const badge = f.gating && f.gating.needs_review
    ? `<span style="display:inline-block;background:#fef3c7;color:#92400e;font-size:12px;font-weight:700;padding:2px 8px;border-radius:999px;margin-left:8px">NEEDS REVIEW</span>`
    : "";
  const note = f.gating && f.gating.needs_review
    ? `<p style="color:#92400e;font-size:13px"><em>Our confidence check couldn't fully verify this against the evidence — treat it as a lead to confirm, not a fact.</em></p>`
    : "";
  const impact = f.estimated_monthly_impact || f.estimated_monthly_upside
    ? `<p style="color:#b45309"><strong>💸 ${escapeHtml(f.estimated_monthly_impact || f.estimated_monthly_upside)}</strong></p>` : "";
  return `<div style="border:1px solid #e5e7eb;border-left:4px solid ${accent};border-radius:12px;padding:16px;margin:12px 0">` +
    `<div style="font-weight:700;color:#0f172a">${escapeHtml(f.title)}${badge}</div>` +
    `<p style="color:#334155">${escapeHtml(f.detail)}</p>` +
    `<p style="color:#64748b;font-size:13px"><strong>Evidence:</strong> ${escapeHtml(f.evidence)}</p>` +
    impact +
    (f.effort ? `<p style="color:#047857;font-size:13px"><strong>Effort:</strong> ${escapeHtml(f.effort)}</p>` : "") +
    note + `</div>`;
}

function renderReportHtml(rep) {
  const sec = (t, inner) => `<h2 style="font-size:20px;margin-top:28px">${escapeHtml(t)}</h2>${inner}`;
  const leaks = (rep.money_leaks || []).map((f) => findingCard(f, "#dc2626")).join("");
  const flaws = (rep.flaws || []).map((f) => findingCard(f, "#d97706")).join("");
  const sugg = (rep.suggestions || []).map((f) => findingCard(f, "#2563eb")).join("");
  const aiop = (rep.ai_opportunities || []).map((f) => findingCard(f, "#7c3aed")).join("");
  const fixes = (rep.prioritized_fixes || []).map((f, i) =>
    `<div style="border:1px solid #e5e7eb;border-radius:12px;padding:16px;margin:12px 0">` +
    `<div style="font-weight:700">#${i + 1} ${escapeHtml(f.title)}${f.gating && f.gating.needs_review ? ' <span style="background:#fef3c7;color:#92400e;font-size:12px;font-weight:700;padding:2px 8px;border-radius:999px">NEEDS REVIEW</span>' : ""}</div>` +
    `<p style="color:#334155">${escapeHtml(f.detail)}</p>` +
    `<p style="color:#64748b;font-size:13px"><strong>Evidence:</strong> ${escapeHtml(f.evidence)}</p>` +
    (f.effort ? `<p style="color:#047857;font-size:13px"><strong>Effort:</strong> ${escapeHtml(f.effort)}</p>` : "") + `</div>`).join("");

  const coverageNote = rep.coverage_note
    ? `<p style="color:#64748b;font-size:13px"><em>${escapeHtml(rep.coverage_note)}</em></p>` : "";
  const videoSec = rep.video_section
    ? `<div style="border:1px solid #e5e7eb;border-radius:12px;padding:16px;margin:12px 0;background:#f8fafc">` +
      `<p style="color:#334155">${escapeHtml(rep.video_section)}</p></div>`
    : "";

  return `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;max-width:700px;margin:0 auto;padding:24px;color:#0f172a">` +
    `<p style="color:#64748b;font-size:13px">MEHYARSOFT · AUDIT MY BUSINESS${rep.business_type_label ? " · " + escapeHtml(rep.business_type_label) : ""}</p>` +
    `<h1 style="font-size:28px">Your business scored ${rep.score}/100 <span style="font-size:20px;color:#64748b">(${rep.grade})</span></h1>` +
    `<p style="font-size:16px;color:#334155"><em>"${escapeHtml(rep.executive_summary)}"</em></p>` +
    `<p style="color:#64748b;font-size:13px">Score = 70% measured checks (${rep.deterministic_score}/100) + 30% AI assessment (${rep.ai_score}/100). ${escapeHtml(rep.score_rationale || "")}</p>` +
    coverageNote +
    sec("Where you're leaking money", leaks || "<p>None identified.</p>") +
    sec("Flaws we found", flaws || "<p>None identified.</p>") +
    sec("Suggestions", sugg || "<p>None identified.</p>") +
    sec("Where AI fits your business", aiop || "<p>None identified.</p>") +
    sec("Your prioritized fix list", fixes || "<p>None identified.</p>") +
    sec("Your walkthrough video", videoSec) +
    `<div style="background:#0f172a;color:#fff;border-radius:12px;padding:20px;margin-top:28px">` +
    `<p style="margin:0 0 8px;font-weight:700">If you do only one thing:</p>` +
    `<p style="margin:0;color:#cbd5e1">${escapeHtml(rep.one_thing)}</p></div>` +
    `<p style="color:#64748b;font-size:13px;margin-top:16px"><strong>How this was built:</strong> ${escapeHtml(rep.methodology)}</p>` +
    `<p style="color:#94a3b8;font-size:12px;margin-top:24px"><a href="${UNSUB_URL}" style="color:#94a3b8">Unsubscribe</a> · ${PHYSICAL}</p>` +
    `</body></html>`;
}

// ── Main build ───────────────────────────────────────────────────────────
async function setStatus(env, id, status, failureReason) {
  await env.LEADS_DB.prepare(
    "UPDATE audit_business_reports SET status=?, failure_reason=?, status_changed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?"
  ).bind(status, failureReason || null, id).run();
}

export async function buildAuditBusinessReport(env, auditId) {
  if (!env?.LEADS_DB) return { ok: false, error: "service_unavailable" };

  const row = await env.LEADS_DB.prepare(
    "SELECT * FROM audit_business_reports WHERE id = ?"
  ).bind(auditId).first();
  if (!row) return { ok: false, error: "not_found" };
  if (row.status === "ready") return { ok: true, already_ready: true, audit_id: auditId };
  if (row.status !== "paid" && row.status !== "failed") {
    return { ok: false, error: "not_paid" };
  }

  // Claim the row: paid/failed, or a generating row stuck > 15 min.
  const claimed = await env.LEADS_DB.prepare(
    "UPDATE audit_business_reports SET status='generating', failure_reason=NULL, status_changed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') " +
    "WHERE id=? AND (status IN ('paid','failed') OR (status='generating' AND (status_changed_at IS NULL OR status_changed_at < strftime('%Y-%m-%dT%H:%M:%fZ','now','-" + STUCK_MINUTES + " minutes'))))"
  ).bind(auditId).run();
  if (!claimed?.meta?.changes) return { ok: false, error: "already_running" };

  const fail = async (reason) => {
    await setStatus(env, auditId, "failed", reason);
    return { ok: false, error: reason };
  };

  try {
    const safeUrl = normalizeUrl(row.url);
    if (!safeUrl) return await fail("invalid_url");

    // 1. Re-fetch the site, measure signals.
    let signals = null, fetchError = null;
    try {
      signals = await fetchSignals(safeUrl);
    } catch (e) {
      fetchError = String((e && e.message) || e).slice(0, 120);
    }

    // 2. Transcribe the walkthrough audio if the buyer uploaded one.
    let transcript = null, coverage = null, transcriptNote = null;
    if (row.audio_r2_key && env.PROPOSAL_ASSETS) {
      try {
        const obj = await env.PROPOSAL_ASSETS.get(row.audio_r2_key);
        if (obj) {
          const t = await transcribeWalkthrough(env, new Uint8Array(await obj.arrayBuffer()));
          if (t.ok && t.transcript) {
            transcript = t.transcript; coverage = t.coverage;
            await env.LEADS_DB.prepare(
              "UPDATE audit_business_reports SET transcript=?, transcript_coverage=? WHERE id=?"
            ).bind(transcript, coverage, auditId).run();
          } else {
            transcriptNote = "An audio track was uploaded but transcription returned no usable text (" + (t.error || "empty") + ").";
          }
        } else {
          transcriptNote = "An audio track was recorded at upload but could not be retrieved from storage.";
        }
      } catch (e) {
        transcriptNote = "Transcription hit a snag (" + String((e && e.message) || e).slice(0, 80) + ").";
      }
    }

    if (!signals) {
      // The site couldn't be fetched at all — honest failure, no invented audit.
      return await fail("fetch_failed:" + (fetchError || "site unreachable"));
    }
    const det = deterministicScore(signals);

    // 3. LLM findings from the evidence pack.
    const userMsg = buildFindingsUserMessage(signals, det, transcript, coverage, row.business_name);
    const llm = await llmFindings(env, FINDINGS_SYSTEM, userMsg);
    if (!llm.ok) return await fail("generation_failed:" + String(llm.error || "llm").slice(0, 60));
    const f = llm.data;

    // 4. decide() gating — verify each finding against the evidence.
    const evidenceText = evidencePackText(signals, det, transcript, coverage);
    const { gated, decideOk, auto_count, review_count } = await gateFindings(env, f, evidenceText, auditId);

    // 5. Score: 70% deterministic + 30% AI. Both halves trace to checks.
    const aiScore = Math.max(0, Math.min(100, Math.round(Number(f.ai_score) || det.score)));
    const score = Math.round(det.score * 0.7 + aiScore * 0.3);

    const oneThing = (gated.prioritized_fixes && gated.prioritized_fixes[0] && gated.prioritized_fixes[0].title)
      || (gated.money_leaks && gated.money_leaks[0] && gated.money_leaks[0].title)
      || "Fix the highest-severity finding above first, then re-run the audit to measure the lift.";

    const coverageNote = "Evaluated from a live fetch of your homepage on " + nowIso().slice(0, 10) + "." +
      (transcript ? " Your walkthrough video transcript (" + coverage + ") was included." :
        " " + (transcriptNote || "No walkthrough video transcript was available — the video section couldn't be assessed.")) +
      (!decideOk ? " Our automated confidence check was unavailable for this run, so every AI finding is marked Needs Review." : "");

    const videoSection = transcript
      ? (f.video_notes || "Your walkthrough covered: " + transcript.slice(0, 500) + "…") + " (Transcript covers " + coverage + ".)"
      : ("Video walkthrough: couldn't be assessed. " + (transcriptNote || "No walkthrough audio was uploaded with this audit."));

    const report = {
      score,
      grade: scoreGrade(score),
      deterministic_score: det.score,
      deterministic_parts: det.parts,
      ai_score: aiScore,
      score_rationale: String(f.score_rationale || ""),
      business_type: f.business_type || "other",
      business_type_label: f.business_type_label || "",
      executive_summary: String(f.executive_summary || ""),
      money_leaks: gated.money_leaks || [],
      flaws: gated.flaws || [],
      suggestions: gated.suggestions || [],
      ai_opportunities: gated.ai_opportunities || [],
      prioritized_fixes: gated.prioritized_fixes || [],
      video_section: videoSection,
      one_thing: oneThing,
      coverage_note: coverageNote,
      gating_summary: { auto: auto_count || 0, needs_review: review_count || 0, decide_ok: decideOk },
      methodology: "Homepage fetched live and measured (load time, HTTPS, mobile viewport, contact paths, CTAs, content depth, trust signals, schema, pixels, page weight). " +
        "AI findings were each checked against that evidence by an independent decision model; anything it couldn't verify is labeled Needs Review. " +
        "Money figures are estimates, not guarantees.",
      built_at: nowIso(),
    };

    const htmlDoc = renderReportHtml(report);
    await env.LEADS_DB.prepare(
      "UPDATE audit_business_reports SET status='ready', failure_reason=NULL, signals_json=?, findings_json=?, report_json=?, report_html=?, status_changed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?"
    ).bind(
      JSON.stringify(signals).slice(0, 60000),
      JSON.stringify(gated).slice(0, 120000),
      JSON.stringify(report).slice(0, 200000),
      htmlDoc.slice(0, 400000),
      auditId
    ).run();

    return { ok: true, audit_id: auditId, status: "ready", score };
  } catch (e) {
    console.error("audit business build error", e && e.message);
    return await fail("generation_failed");
  }
}

// Exported for unit tests.
export { evidencePackText, buildFindingsUserMessage, FINDING_LISTS, gateFindings };
