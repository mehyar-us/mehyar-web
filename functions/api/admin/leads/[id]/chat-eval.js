// POST /api/admin/leads/<id>/chat-eval?kind=prospect|sam
// Body: { message: string, current_eval?: object }
// Returns: { ok, reply, patch?, new_eval?, usage, model }
//
// Two-way conversation about a saved evaluation. The user can:
//   - Ask the LLM for an explanation ("why is the fit score only 65?")
//   - Suggest a change ("add a 4th service for HIPAA compliance")
//   - Critique a tier ("the Growth tier is too expensive for a dental office")
//
// The endpoint returns a `reply` (always) and an optional `patch` (only if the
// LLM proposes a structured change to the evaluation). The UI shows both —
// reply as a chat bubble, patch as an "Apply changes" preview that, when clicked,
// merges into the canonical evaluation.
//
// Every chat turn is persisted to opportunity_events with event_type='eval_chat'
// so the history is preserved and inspectable.
//
// Owner-only.

import { verifyAdminToken, json, corsHeaders } from "../../../_shared/adminAuth.js";
import { chatJson } from "../../../_shared/llmChat.js";

const MAX_MESSAGE_LEN = 4000;
const MAX_HISTORY_TURNS = 16;

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

export async function onRequestPost({ request, env, params }) {
  const auth = await verifyAdminToken(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.message }, auth.status, request, env);
  if (!env?.LEADS_DB) return json({ ok: false, error: "missing_db" }, 500, request, env);

  const url = new URL(request.url);
  const kind = url.searchParams.get("kind");
  const id = params.id;
  if (!["prospect","sam"].includes(kind)) return json({ ok: false, error: "kind_required" }, 400, request, env);
  if (!id) return json({ ok: false, error: "missing_id" }, 400, request, env);

  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "bad_json" }, 400, request, env); }

  const message = String(body?.message || "").trim();
  if (!message) return json({ ok: false, error: "message_required" }, 400, request, env);
  if (message.length > MAX_MESSAGE_LEN) return json({ ok: false, error: "message_too_long", max: MAX_MESSAGE_LEN }, 400, request, env);

  // Load the latest saved evaluation (if not provided by client)
  let evalData = body?.current_eval;
  if (!evalData || typeof evalData !== "object") {
    try {
      const col = kind === "sam" ? "sam_id" : "prospect_id";
      const row = await env.LEADS_DB.prepare(`
        SELECT payload_json, created_at FROM opportunity_events
        WHERE ${col} = ? AND event_type = 'deep_evaluate'
        ORDER BY created_at DESC LIMIT 1
      `).bind(id).first().catch(() => null);
      if (row?.payload_json) evalData = safeJson(row.payload_json, null);
    } catch {}
  }
  if (!evalData) return json({ ok: false, error: "no_eval_to_chat_about" }, 400, request, env);

  // Load underlying entity context (title/agency/desc/etc) for grounding
  const ctx = await loadEntityContext(env, kind, id);

  // Load recent chat history for multi-turn coherence
  let history = [];
  try {
    const rows = await env.LEADS_DB.prepare(`
      SELECT payload_json FROM opportunity_events
      WHERE ${kind === "sam" ? "sam_id" : "prospect_id"} = ?
        AND event_type = 'eval_chat'
      ORDER BY created_at DESC LIMIT ?
    `).bind(id, MAX_HISTORY_TURNS).all();
    history = (rows?.results || []).reverse().map((r) => safeJson(r.payload_json, {})).filter(Boolean);
  } catch {}

  // Build the system prompt
  const systemPrompt = [
    `You are a senior solutions engineer at MehyarSoft, a Brooklyn NY small software agency.`,
    `You are chatting with the founder/owner about a saved evaluation of a prospect/solicitation.`,
    ``,
    `Your job:`,
    `1. Answer the user's question or comment in plain English (be specific, concise, cite the eval data).`,
    `2. If the user is asking you to CHANGE the evaluation (add a service, drop a tier, raise a price, update fit_score, add a risk flag, change next_action, etc.), propose a structured JSON patch that the UI will preview and offer to apply.`,
    ``,
    `Return STRICT JSON only — no markdown fences — with this exact shape:`,
    `{`,
    `  "reply": string ≤ 1200 chars — your conversational answer,`,
    `  "patch": null | {`,
    `    "reason": string ≤ 240 chars — why this change is being proposed,`,
    `    "set": {  // any of these optional top-level overrides`,
    `      "verdict": "🟢 strong fit" | "🟡 evaluate further" | "🔴 not a fit",`,
    `      "fit_score": integer 0-100,`,
    `      "executive_summary": string ≤ 600 chars,`,
    `      "next_action": string ≤ 200 chars,`,
    `      "risk_flags": [string ≤ 120 chars]`,
    `    },`,
    `    "add_services": [ { "name", "icon", "description" ≤ 280, "deliverables": [string] } ],`,
    `    "remove_service_names": [string],   // case-insensitive match`,
    `    "add_pricing_tiers": [ { "tier", "price_min", "price_max", "monthly_min", "monthly_max", "scope": [string] } ],`,
    `    "remove_pricing_tier_names": [string],  // case-insensitive match`,
    `    "edit_pricing_tiers": [ { "match_name": string, "price_min": int, "price_max": int, "monthly_min": int, "monthly_max": int } ]`,
    `  }`,
    `}`,
    ``,
    `If the user is just asking a question (not requesting a change), set "patch": null.`,
    `If a change is requested but you disagree (e.g. user wants to drop a tier that should stay), still return patch: null and explain in the reply why.`,
    ``,
    `Pricing tier rules unchanged from the original eval:`,
    `- Starter:  $2,500–$6,000 one-time + $100–$250/mo  (≤ ~30 hrs)`,
    `- Growth:   $6,000–$18,000 one-time + $400–$900/mo (~50–90 hrs)`,
    `- Premium:  $20,000–$60,000 one-time + $1,500–$4,000/mo (~120–280 hrs)`,
    ``,
    `Keep the patch minimal — only change what the user asked for, never rewrite the whole eval.`,
  ].join("\n");

  // Build the user message: include the current eval snapshot + ctx + history + new message
  const messages = [
    { role: "system", content: systemPrompt },
  ];

  // Inject prior history as user/assistant pairs so the LLM has context
  for (const turn of history) {
    if (turn.role && turn.content) {
      messages.push({ role: turn.role, content: String(turn.content).slice(0, 4000) });
    }
  }

  // Current state + new message
  const evalSnapshot = JSON.stringify(evalData, null, 2).slice(0, 12000);
  const ctxSnapshot = ctx ? JSON.stringify(ctx, null, 2).slice(0, 4000) : "{}";
  messages.push({
    role: "user",
    content: [
      `## Entity context`,
      ctxSnapshot,
      ``,
      `## Current saved evaluation (this is what the UI is showing)`,
      evalSnapshot,
      ``,
      `## New user message`,
      message,
    ].join("\n"),
  });

  // Call LLM with JSON mode
  let llmResp;
  try {
    llmResp = await chatJson({ env, messages, max_tokens: 2000, temperature: 0.4 });
  } catch (e) {
    return json({ ok: false, error: "llm_call_failed", details: String(e?.message || e) }, 500, request, env);
  }

  if (!llmResp?.ok) {
    return json({ ok: false, error: "llm_unavailable", details: llmResp?.error || "no_response" }, 502, request, env);
  }

  // Parse the assistant reply
  let parsed;
  try {
    parsed = typeof llmResp.json === "object" ? llmResp.json : JSON.parse(llmResp.text || "{}");
  } catch {
    // Fall back to wrapping as a plain reply
    parsed = { reply: llmResp.text || "(empty response)", patch: null };
  }

  const reply = String(parsed.reply || "").trim();
  let patch = parsed.patch || null;

  // Validate / sanitize the patch
  if (patch) {
    try { patch = sanitizePatch(patch); } catch (e) {
      return json({ ok: false, error: "invalid_patch_from_llm", details: String(e?.message || e) }, 502, request, env);
    }
    if (patch && !patch.reason) patch.reason = "LLM-suggested change";
  }

  // Compute new_eval preview if patch is non-null (don't persist yet — UI must apply)
  let new_eval_preview = null;
  if (patch) {
    try { new_eval_preview = applyPatch(evalData, patch); } catch (e) {
      return json({ ok: false, error: "patch_apply_failed", details: String(e?.message || e) }, 500, request, env);
    }
  }

  // Persist this chat turn (the user's message + the assistant's reply)
  // event_type='eval_chat' with payload_json = { role:'user', content:message }
  // then a separate row with role:'assistant', content:reply, patch
  const now = new Date().toISOString();
  try {
    const colId = kind === "sam" ? "sam_id" : "prospect_id";
    await env.LEADS_DB.prepare(`
      INSERT INTO opportunity_events (id, ${colId}, event_type, payload_json, created_at)
      VALUES (?, ?, 'eval_chat', ?, ?)
    `).bind(crypto.randomUUID(), id, JSON.stringify({ role: "user", content: message }), now).run();

    await env.LEADS_DB.prepare(`
      INSERT INTO opportunity_events (id, ${colId}, event_type, payload_json, created_at)
      VALUES (?, ?, 'eval_chat', ?, ?)
    `).bind(crypto.randomUUID(), id, JSON.stringify({
      role: "assistant",
      content: reply,
      patch: patch || null,
      model: llmResp.model || null,
    }), now).run();
  } catch (e) {
    // Persistence failure is non-fatal — the user still gets the reply.
    // eslint-disable-next-line no-console
    console.error("[chat-eval] persistence failed:", e);
  }

  return json({
    ok: true,
    reply,
    patch: patch || null,
    new_eval_preview, // present iff patch is non-null
    usage: llmResp.usage || null,
    model: llmResp.model || null,
    used_llm: true,
  }, 200, request, env);
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/admin/leads/<id>/chat-eval/apply?kind=prospect|sam
// Body: { new_eval: object, reason: string }
// Persists a patch-applied evaluation as a new deep_evaluate event
// (so the canonical "latest" eval moves forward and the history is preserved).
// ─────────────────────────────────────────────────────────────────────────────

export async function onRequestPut({ request, env, params }) {
  const auth = await verifyAdminToken(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.message }, auth.status, request, env);
  if (!env?.LEADS_DB) return json({ ok: false, error: "missing_db" }, 500, request, env);

  const url = new URL(request.url);
  const kind = url.searchParams.get("kind");
  const id = params.id;
  if (!["prospect","sam"].includes(kind)) return json({ ok: false, error: "kind_required" }, 400, request, env);
  if (!id) return json({ ok: false, error: "missing_id" }, 400, request, env);

  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: "bad_json" }, 400, request, env); }

  const new_eval = body?.new_eval;
  const reason = String(body?.reason || "Manual refinement via chat").slice(0, 240);
  if (!new_eval || typeof new_eval !== "object") return json({ ok: false, error: "new_eval_required" }, 400, request, env);

  // Sanity: enforce shape
  if (!Array.isArray(new_eval.services) || !Array.isArray(new_eval.pricing_tiers)) {
    return json({ ok: false, error: "invalid_eval_shape" }, 400, request, env);
  }

  const now = new Date().toISOString();
  try {
    const colId = kind === "sam" ? "sam_id" : "prospect_id";
    await env.LEADS_DB.prepare(`
      INSERT INTO opportunity_events (id, ${colId}, event_type, payload_json, created_at)
      VALUES (?, ?, 'deep_evaluate', ?, ?)
    `).bind(crypto.randomUUID(), id, JSON.stringify({ ...new_eval, _applied_reason: reason, _applied_at: now }), now).run();
  } catch (e) {
    return json({ ok: false, error: "persist_failed", details: String(e?.message || e) }, 500, request, env);
  }

  return json({ ok: true, saved_at: now }, 200, request, env);
}

// ─── helpers ────────────────────────────────────────────────────────────────

function safeJson(s, fallback) {
  if (!s) return fallback;
  try { return JSON.parse(s); } catch { return fallback; }
}

function clampStr(v, max) {
  return String(v || "").slice(0, max);
}

function sanitizePatch(p) {
  if (!p || typeof p !== "object") return null;

  const allowedSet = ["verdict", "fit_score", "executive_summary", "next_action", "risk_flags"];
  const set = {};
  if (p.set && typeof p.set === "object") {
    for (const k of allowedSet) {
      if (p.set[k] != null) {
        if (k === "fit_score") {
          const n = Number(p.set[k]);
          if (Number.isFinite(n)) set.fit_score = Math.max(0, Math.min(100, Math.round(n)));
        } else if (k === "risk_flags" || k === "executive_summary") {
          set[k] = k === "risk_flags"
            ? (Array.isArray(p.set[k]) ? p.set[k].slice(0, 10).map((s) => clampStr(s, 120)) : null)
            : clampStr(p.set[k], 600);
        } else {
          set[k] = clampStr(p.set[k], 200);
        }
      }
    }
  }

  const add_services = Array.isArray(p.add_services)
    ? p.add_services.slice(0, 6).map((s) => ({
        name: clampStr(s.name, 80),
        icon: clampStr(s.icon || "🛠", 4),
        description: clampStr(s.description, 280),
        deliverables: Array.isArray(s.deliverables) ? s.deliverables.slice(0, 8).map((d) => clampStr(d, 100)) : [],
      })).filter((s) => s.name)
    : [];

  const remove_service_names = Array.isArray(p.remove_service_names)
    ? p.remove_service_names.slice(0, 6).map((s) => clampStr(s, 80)).filter(Boolean)
    : [];

  const add_pricing_tiers = Array.isArray(p.add_pricing_tiers)
    ? p.add_pricing_tiers.slice(0, 3).map((t) => ({
        tier: clampStr(t.tier, 40),
        price_min: Math.max(0, Math.round(Number(t.price_min) || 0)),
        price_max: Math.max(0, Math.round(Number(t.price_max) || 0)),
        monthly_min: Math.max(0, Math.round(Number(t.monthly_min) || 0)),
        monthly_max: Math.max(0, Math.round(Number(t.monthly_max) || 0)),
        scope: Array.isArray(t.scope) ? t.scope.slice(0, 8).map((s) => clampStr(s, 100)) : [],
      })).filter((t) => t.tier)
    : [];

  const remove_pricing_tier_names = Array.isArray(p.remove_pricing_tier_names)
    ? p.remove_pricing_tier_names.slice(0, 6).map((s) => clampStr(s, 40)).filter(Boolean)
    : [];

  const edit_pricing_tiers = Array.isArray(p.edit_pricing_tiers)
    ? p.edit_pricing_tiers.slice(0, 6).map((t) => ({
        match_name: clampStr(t.match_name, 40),
        price_min: Math.max(0, Math.round(Number(t.price_min) || 0)),
        price_max: Math.max(0, Math.round(Number(t.price_max) || 0)),
        monthly_min: Math.max(0, Math.round(Number(t.monthly_min) || 0)),
        monthly_max: Math.max(0, Math.round(Number(t.monthly_max) || 0)),
      })).filter((t) => t.match_name)
    : [];

  const out = { reason: clampStr(p.reason, 240) || "LLM-suggested change" };
  if (Object.keys(set).length) out.set = set;
  if (add_services.length) out.add_services = add_services;
  if (remove_service_names.length) out.remove_service_names = remove_service_names;
  if (add_pricing_tiers.length) out.add_pricing_tiers = add_pricing_tiers;
  if (remove_pricing_tier_names.length) out.remove_pricing_tier_names = remove_pricing_tier_names;
  if (edit_pricing_tiers.length) out.edit_pricing_tiers = edit_pricing_tiers;
  return out;
}

function applyPatch(evalData, patch) {
  const out = JSON.parse(JSON.stringify(evalData));

  if (patch.set) {
    for (const k of Object.keys(patch.set)) out[k] = patch.set[k];
  }

  if (Array.isArray(patch.remove_service_names) && patch.remove_service_names.length) {
    const lower = patch.remove_service_names.map((n) => n.toLowerCase());
    out.services = (out.services || []).filter((s) => !lower.includes(String(s.name || "").toLowerCase()));
  }
  if (Array.isArray(patch.add_services) && patch.add_services.length) {
    out.services = (out.services || []).concat(patch.add_services).slice(0, 8);
  }

  if (Array.isArray(patch.remove_pricing_tier_names) && patch.remove_pricing_tier_names.length) {
    const lower = patch.remove_pricing_tier_names.map((n) => n.toLowerCase());
    out.pricing_tiers = (out.pricing_tiers || []).filter((t) => !lower.includes(String(t.tier || t.name || "").toLowerCase()));
  }
  if (Array.isArray(patch.add_pricing_tiers) && patch.add_pricing_tiers.length) {
    out.pricing_tiers = (out.pricing_tiers || []).concat(patch.add_pricing_tiers).slice(0, 6);
  }
  if (Array.isArray(patch.edit_pricing_tiers) && patch.edit_pricing_tiers.length) {
    for (const edit of patch.edit_pricing_tiers) {
      const lower = String(edit.match_name || "").toLowerCase();
      const t = (out.pricing_tiers || []).find((x) => String(x.tier || x.name || "").toLowerCase() === lower);
      if (t) {
        if (edit.price_min) t.price_min = edit.price_min;
        if (edit.price_max) t.price_max = edit.price_max;
        if (edit.monthly_min) t.monthly_min = edit.monthly_min;
        if (edit.monthly_max) t.monthly_max = edit.monthly_max;
      }
    }
  }

  out.services = (out.services || []).slice(0, 8);
  out.pricing_tiers = (out.pricing_tiers || []).slice(0, 6);
  out._last_patched_at = new Date().toISOString();
  return out;
}

async function loadEntityContext(env, kind, id) {
  try {
    if (kind === "sam") {
      const row = await env.LEADS_DB.prepare(`
        SELECT id, title, agency, naics, set_aside, deadline_date, description, fit_score
        FROM gov_opportunities WHERE id = ? LIMIT 1
      `).bind(id).first();
      return row || null;
    } else {
      const row = await env.LEADS_DB.prepare(`
        SELECT id, business_name, root_domain, email, vertical, city, region, leak_score, fit_score
        FROM prospects WHERE id = ? LIMIT 1
      `).bind(id).first();
      return row || null;
    }
  } catch { return null; }
}