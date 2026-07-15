// Shared deep-evaluate helpers used by leads/[id]/deep-evaluate, bulk-action, etc.

/**
 * runDeepEvalForKind(env, kind, id)
 *   For kind='sam': returns { ok, fit_score, used_llm, summary } from gov_opportunity_briefs
 *   For kind='prospect': returns { ok, fit_score, used_llm, summary } from prospect_signals.eval_json
 *
 * NOTE: This is a thin orchestrator — actual LLM eval lives in leads/[id]/deep-evaluate.js.
 * For bulk operations we just call that endpoint internally.
 */
export async function runDeepEvalForKind(env, kind, id) {
  try {
    const origin = env?.MEHYAR_ORIGIN || "https://mehyar.us";
    const headers = {
      "authorization": `Bearer ${env.OWNER_TOKEN || env.GOV_INGEST_TOKEN || ""}`,
      "content-type": "application/json",
    };
    const url = `${origin}/api/admin/leads/${encodeURIComponent(id)}/deep-evaluate?kind=${kind}`;
    const r = await fetch(url, { method: "POST", headers, signal: AbortSignal.timeout(60_000) });
    const j = await r.json().catch(() => ({}));
    return {
      ok: !!j.ok,
      fit_score: j.fit_score || j.evaluation?.fit_score || 0,
      used_llm: !!j.used_llm,
      summary: j.summary || j.evaluation?.summary || "",
      details: j,
    };
  } catch (e) {
    return { ok: false, fit_score: 0, used_llm: false, error: String(e?.message || e) };
  }
}