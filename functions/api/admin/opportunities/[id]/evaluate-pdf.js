// POST /api/admin/opportunities/:id/evaluate-pdf
// Downloads SAM.gov opportunity PDF attachments, extracts text, runs LLM evaluation,
// and returns structured fit_score + recommended services + pricing tiers + draft angle.
//
// Body: { attachment_url?: string, attachment_index?: number, mode?: 'single'|'all' }
//   - mode='all' (default): evaluate every PDF attached to the opportunity
//   - mode='single': evaluate one (attachment_url OR attachment_index required)
//
// Result is persisted to gov_opportunity_briefs with type='pdf_eval' and audit-logged.

import { verifyAdminToken, json, corsHeaders } from "../../../_shared/adminAuth.js";
import { callLLM } from "../../../_shared/llmChat.js";

const MAX_PDF_BYTES = 8 * 1024 * 1024;   // 8 MB cap per PDF
const PDF_TIMEOUT_MS = 25_000;
const ALLOWED_HOSTS = [
  "sam.gov", "www.sam.gov",
  "api.sam.gov", "beta.sam.gov",
  "prod-titans-govt.s3.amazonaws.com",
  "s3.amazonaws.com",
];

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

export async function onRequestPost({ request, env, params }) {
  const auth = await verifyAdminToken(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.message }, auth.status, request, env);
  if (!env?.LEADS_DB) return json({ ok: false, error: "missing_db" }, 500, request, env);

  const opportunityId = params?.id;
  if (!opportunityId) return json({ ok: false, error: "missing_id" }, 400, request, env);

  let body;
  try { body = await request.json(); } catch { body = {}; }
  const mode = body?.mode === "single" ? "single" : "all";

  // Load opportunity + attachments
  let opp;
  try {
    opp = await env.LEADS_DB.prepare(`
      SELECT id, title, agency, description, attachments_json, requirements_json, stage
      FROM gov_opportunities WHERE id = ? LIMIT 1
    `).bind(opportunityId).first();
  } catch (e) {
    return json({ ok: false, error: "db_lookup_failed", details: String(e?.message || e) }, 500, request, env);
  }
  if (!opp) return json({ ok: false, error: "not_found" }, 404, request, env);

  let attachments = [];
  try {
    if (opp.attachments_json) {
      attachments = typeof opp.attachments_json === "string"
        ? JSON.parse(opp.attachments_json) : opp.attachments_json;
    }
  } catch { attachments = []; }

  // Filter to PDFs only
  const pdfs = (attachments || []).filter((a) => {
    const t = String(a?.type || "").toLowerCase();
    const u = String(a?.url || "").toLowerCase();
    return t.includes("pdf") || u.endsWith(".pdf");
  });

  if (pdfs.length === 0) {
    return json({ ok: false, error: "no_pdfs", message: "No PDF attachments found on this opportunity." }, 400, request, env);
  }

  // Pick which PDFs to evaluate
  let targets;
  if (mode === "single") {
    if (body.attachment_url) {
      targets = pdfs.filter((a) => a.url === body.attachment_url);
    } else if (typeof body.attachment_index === "number") {
      targets = [pdfs[body.attachment_index]].filter(Boolean);
    } else {
      targets = [pdfs[0]];
    }
    if (targets.length === 0) return json({ ok: false, error: "attachment_not_found" }, 404, request, env);
  } else {
    targets = pdfs.slice(0, 5); // cap at 5 PDFs to avoid blow-up
  }

  // Process each PDF
  const evaluations = [];
  for (const pdf of targets) {
    try {
      const evalResult = await evaluateSinglePdf(env, pdf, opp);
      evaluations.push(evalResult);
    } catch (e) {
      evaluations.push({
        attachment_url: pdf.url,
        attachment_name: pdf.name || pdf.url.split("/").pop(),
        ok: false,
        error: String(e?.message || e),
      });
    }
  }

  // Aggregate the strongest signal across all evaluations
  const successful = evaluations.filter((e) => e.ok);
  const aggregate = successful.length
    ? {
        best_fit_score: Math.max(...successful.map((e) => e.fit_score || 0)),
        best_attachment: successful.find((e) => e.fit_score === Math.max(...successful.map((e) => e.fit_score || 0)))?.attachment_name,
        recommended_services: pickTop(successful.flatMap((e) => e.recommended_services || []), 3),
        suggested_tiers: pickTop(successful.flatMap((e) => e.suggested_tiers || []), 3),
        aggregate_summary: successful.map((e) => `📄 ${e.attachment_name}: ${e.summary || ""}`).join("\n\n"),
      }
    : null;

  // Persist to gov_opportunity_briefs
  if (aggregate) {
    const briefId = crypto.randomUUID();
    try {
      await env.LEADS_DB.prepare(`
        INSERT INTO gov_opportunity_briefs (id, opportunity_id, brief_type, payload_json, created_at)
        VALUES (?, ?, 'pdf_eval', ?, datetime('now'))
      `).bind(briefId, opportunityId, JSON.stringify({
        evaluated: evaluations.length,
        aggregate,
        per_pdf: evaluations.map((e) => ({
          name: e.attachment_name,
          ok: e.ok,
          fit_score: e.fit_score,
          char_count: e.char_count,
          summary: e.summary,
        })),
      }).slice(0, 18000)).run();
    } catch (e) {
      // table may not exist
      await env.LEADS_DB.prepare(`
        CREATE TABLE IF NOT EXISTS gov_opportunity_briefs (
          id TEXT PRIMARY KEY,
          opportunity_id TEXT NOT NULL,
          brief_type TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `).run();
      await env.LEADS_DB.prepare(`
        INSERT INTO gov_opportunity_briefs (id, opportunity_id, brief_type, payload_json, created_at)
        VALUES (?, ?, 'pdf_eval', ?, datetime('now'))
      `).bind(briefId, opportunityId, JSON.stringify({
        evaluated: evaluations.length,
        aggregate,
        per_pdf: evaluations.map((e) => ({
          name: e.attachment_name,
          ok: e.ok,
          fit_score: e.fit_score,
          char_count: e.char_count,
          summary: e.summary,
        })),
      }).slice(0, 18000)).run();
    }
  }

  // Audit log
  try {
    await env.LEADS_DB.prepare(`
      INSERT INTO opportunity_events (id, kind, opportunity_id, sam_id, event_type, actor, payload_json, created_at)
      VALUES (?, 'sam', ?, ?, 'pdf_evaluated', 'owner', ?, datetime('now'))
    `).bind(crypto.randomUUID(), opportunityId, opportunityId, JSON.stringify({
      mode, evaluated: evaluations.length, successful: successful.length, aggregate_fit: aggregate?.best_fit_score || 0,
    }).slice(0, 18000)).run();
  } catch {}

  return json({
    ok: true,
    opportunity_id: opportunityId,
    mode,
    evaluated: evaluations.length,
    successful: successful.length,
    evaluations,
    aggregate,
    used_llm: successful.some((e) => e.used_llm),
  }, 200, request, env);
}

async function evaluateSinglePdf(env, pdf, opp) {
  // SSRF guard
  const url = new URL(pdf.url);
  if (!ALLOWED_HOSTS.includes(url.hostname) && !url.hostname.endsWith(".amazonaws.com")) {
    throw new Error(`blocked host: ${url.hostname}`);
  }

  // Download
  const r = await fetch(pdf.url, {
    headers: { "User-Agent": "MehyarSoft-PDF-Eval/1.0" },
    signal: AbortSignal.timeout(PDF_TIMEOUT_MS),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const buf = await r.arrayBuffer();
  if (buf.byteLength > MAX_PDF_BYTES) throw new Error(`PDF too large (${(buf.byteLength / 1024 / 1024).toFixed(1)}MB)`);

  // Parse PDF text — try pdfjs via dynamic import (Workers-compatible)
  let text = "";
  try {
    const pdfjs = await import("pdf-parse").catch(() => null);
    if (pdfjs) {
      const out = await pdfjs(Buffer.from(buf), { max: 80 });
      text = String(out.text || "").slice(0, 40_000);
    } else {
      // fallback: raw decode
      text = Buffer.from(buf).toString("utf8").slice(0, 40_000);
    }
  } catch (e) {
    text = `(PDF parse failed: ${String(e?.message || e)})`;
  }

  const cleanText = text.replace(/\s+/g, " ").trim().slice(0, 24_000);

  // LLM evaluation
  const messages = [{
    role: "system",
    content: `You are MehyarSoft's senior consultant analyzing US government (SAM.gov) opportunity PDFs.

You will be given the opportunity title/agency/description + extracted PDF text.

Return ONLY valid JSON (no commentary, no markdown fences) with this exact shape:
{
  "fit_score": <integer 0-100 — how well MehyarSoft (AI/automation/cloud/CRM/marketing for SMBs) fits>,
  "summary": "<2-3 sentence summary of what this opportunity actually needs>",
  "key_requirements": ["<bullet>", "<bullet>", ...up to 6],
  "recommended_services": [
    {"name": "<service>", "rationale": "<why>"},
    ...up to 3 services from: Custom Web App, CRM Automation, AI Chatbot, Cloud Migration, Marketing Automation, Business Workflow Automation, Data Pipeline, Mobile App, API Integration, Internal Tool>
  ],
  "suggested_tiers": [
    {"name": "<tier name>", "price_usd": <integer>, "scope": "<one-line scope>"},
    {"name": "<tier name>", "price_usd": <integer>, "scope": "<one-line scope>"},
    {"name": "<tier name>", "price_usd": <integer>, "scope": "<one-line scope>"}
  ],
  "red_flags": ["<risk>", "<risk>"],
  "next_action": "<one sentence — what Mehyar should do first>"
}

Be honest: if the fit is poor (e.g. heavy hardware, classified, requires certifications we don't have), say so. Lower the fit_score accordingly. Pricing should reflect US federal contracting norms.`
  }, {
    role: "user",
    content: `OPPORTUNITY
Title: ${opp.title || "(unknown)"}
Agency: ${opp.agency || "(unknown)"}
Description: ${(opp.description || "").slice(0, 2000)}

PDF EXTRACT (${cleanText.length} chars):
${cleanText}`
  }];

  let used_llm = false;
  let result = null;
  try {
    const llmResp = await callLLM(env, messages, { max_tokens: 1800, temperature: 0.3 });
    used_llm = llmResp?.ok !== false;
    const text = llmResp?.text || "";
    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      result = JSON.parse(jsonMatch[0]);
    }
  } catch (e) {
    // heuristic fallback
    result = heuristicEval(cleanText, opp);
  }
  if (!result) result = heuristicEval(cleanText, opp);

  return {
    ok: true,
    used_llm,
    attachment_url: pdf.url,
    attachment_name: pdf.name || pdf.url.split("/").pop(),
    char_count: cleanText.length,
    fit_score: clamp(result.fit_score ?? 50, 0, 100),
    summary: result.summary || "",
    key_requirements: (result.key_requirements || []).slice(0, 6),
    recommended_services: (result.recommended_services || []).slice(0, 3),
    suggested_tiers: (result.suggested_tiers || []).slice(0, 3),
    red_flags: (result.red_flags || []).slice(0, 4),
    next_action: result.next_action || "",
  };
}

function heuristicEval(text, opp) {
  const t = String(text).toLowerCase();
  const aiKeywords = ["ai", "automation", "chatbot", "machine learning", "data", "workflow", "integration", "api", "cloud", "saas"];
  const hits = aiKeywords.filter((k) => t.includes(k)).length;
  const fit = Math.min(95, 30 + hits * 8);
  return {
    fit_score: fit,
    summary: `Heuristic evaluation: ${hits} AI/automation keywords detected in PDF.`,
    key_requirements: ["(LLM fallback) — re-run with valid LLM credentials for full eval."],
    recommended_services: [{ name: "Custom Web App", rationale: "Generic safe pick from heuristic." }],
    suggested_tiers: [
      { name: "MVP / Discovery Sprint", price_usd: 7500, scope: "2-week requirements + design" },
      { name: "Build + Deploy", price_usd: 35000, scope: "Implementation + 90d support" },
    ],
    red_flags: [],
    next_action: "Re-run evaluate-pdf with LLM enabled for detailed recommendations.",
  };
}

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, Number(n) || 0)); }
function pickTop(arr, n) {
  // dedupe by name, keep n
  const seen = new Set();
  const out = [];
  for (const x of arr) {
    const key = JSON.stringify(x);
    if (!seen.has(key)) { seen.add(key); out.push(x); }
    if (out.length >= n) break;
  }
  return out;
}