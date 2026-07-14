// POST /api/admin/jarvis
// Admin-only AI query endpoint. Accepts a natural-language question,
// executes a read-only SQL query against LEADS_DB (LIMIT 100 guard),
// and falls back to the appsolut /jarvis template if SQL can't answer.
// No Telegram/email side-effects. Full idempotency.
import { verifyAdminToken, json, corsHeaders } from "../../_shared/adminAuth.js";
import { chatJson, safeJsonParse } from "../../_shared/llmChat.js";

export async function onRequestOptions({ request, env }) {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

// ── SQL guard ─────────────────────────────────────────────────────────────────
// Only SELECT. No INSERT/UPDATE/DELETE/DROP/ALTER/TRUNCATE/CREATE.
// Rewrites LIMIT to an explicit cap. Strips dangerous SQL comments.
function buildSafeQuery(raw) {
  const upper = raw.replace(/--.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "").toUpperCase();
  const writeKeywords = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|REPLACE|EXEC|EXECUTE|GRANT|REVOKE|PRAGMA|ATTACH|BEGIN|COMMIT|ROLLBACK)\b/;
  if (writeKeywords.test(upper)) return null;
  // Force LIMIT 100
  let q = raw.replace(/\bLIMIT\s*\d+\b/gi, "").replace(/;+$/, "").trim();
  q = q.replace(/\bSELECT\b/i, "SELECT");
  // Strip trailing semicolons
  q = q.replace(/;+\s*$/, "").trim();
  if (!q.toUpperCase().startsWith("SELECT")) return null;
  // Append LIMIT 100
  return q + " LIMIT 100";
}

function formatResults(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return "No results found.";
  const cols = Object.keys(rows[0]);
  const lines = rows.map((r) => cols.map((c) => `${c}: ${r[c] ?? ""}`).join(" | "));
  return `${lines.length} result(s):\n` + lines.join("\n");
}

// ── Appsolut fallback template ────────────────────────────────────────────────
// Deterministic canned responses keyed to common question patterns.
// Used when the SQL path can't answer the question.
const APPSOLUT_FALLBACKS = [
  {
    pattern: /how many|i have|total|count|how many (leads|prospects|opportunities)/i,
    reply: (env) =>
      "Here's a quick snapshot from your database:\n" +
      `• Total leads: ${env._cached_counts?.leads ?? "?"}\n` +
      `• Total prospects: ${env._cached_counts?.prospects ?? "?"}\n` +
      `• Active (sent): ${env._cached_counts?.sent ?? "?"}\n` +
      `• Queued now: ${env._cached_counts?.queued ?? "?"}\n\n` +
      "Ask me to drill into any of these for more detail.",
  },
  {
    pattern: /pipeline|stage|funnel|status breakdown|by stage/i,
    reply: () =>
      "Your pipeline summary (all opportunities):\n" +
      "• Discovery: run SELECT stage, COUNT(*) FROM prospects GROUP BY stage\n" +
      "• Evaluating: inspect in the admin UI at /admin/opportunities\n" +
      "• Drafting / ReadyToSend: check the prospect queue\n" +
      "• Sent / Replied: tracked in prospect_sends\n\n" +
      "For a live breakdown, ask me a SQL question.",
  },
  {
    pattern: /recent|latest|last\s*\d|new.*since/i,
    reply: () =>
      "Recent activity (last 7 days):\n" +
      "• New leads: run `SELECT * FROM leads ORDER BY created_at DESC LIMIT 20`\n" +
      "• New prospects scanned: `SELECT * FROM prospects ORDER BY last_scanned_at DESC LIMIT 10`\n" +
      "• Recent sends: `SELECT * FROM prospect_sends ORDER BY created_at DESC LIMIT 10`",
  },
  {
    pattern: /government|sam\.gov|opportunity scout|gov/i,
    reply: () =>
      "Government opportunities are managed in /admin/opportunity-scout.\n" +
      "The SAM.gov pipeline scans and ingests new notices automatically.\n" +
      "For raw SQL: `SELECT * FROM gov_opportunities ORDER BY posted_date DESC LIMIT 20`",
  },
];

function appsolutFallback(question) {
  for (const f of APPSOLUT_FALLBACKS) {
    if (f.pattern.test(question)) return f.reply();
  }
  return null; // no template matched
}

// ── Main handler ──────────────────────────────────────────────────────────────
export async function onRequestPost({ request, env }) {
  const auth = await verifyAdminToken(request, env);
  if (!auth.ok) return json({ ok: false, error: auth.message }, auth.status, request, env);
  if (!env?.LEADS_DB) return json({ ok: false, error: "missing_db" }, 500, request, env);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400, request, env);
  }

  const question = typeof body?.question === "string" ? body.question.trim().slice(0, 500) : "";
  if (!question) return json({ ok: false, error: "question_required" }, 400, request, env);

  // ── Step 1: Try SQL ───────────────────────────────────────────────────────
  let sqlResult = null;
  let sqlError = null;

  // Detect a SQL question (starts with SELECT or contains SQL-like keywords)
  const looksLikeSql = /^\s*SELECT\b/i.test(question) || /\bFROM\b|\bWHERE\b|\bGROUP BY\b|\bORDER BY\b/i.test(question);

  if (looksLikeSql) {
    const safeQuery = buildSafeQuery(question);
    if (safeQuery) {
      try {
        const rows = await env.LEADS_DB.prepare(safeQuery).all();
        sqlResult = {
          query: safeQuery,
          rows: rows.results || [],
          count: (rows.results || []).length,
        };
      } catch (e) {
        sqlError = String(e?.message || e);
      }
    }
  }

  // ── Step 2: Build response ─────────────────────────────────────────────────
  let answer;
  let source = "appsolut";

  if (sqlResult) {
    answer = formatResults(sqlResult.rows);
    source = "sql";
  } else if (sqlError) {
    // SQL failed — fall through to LLM or appsolut
    const { content, used_llm, error: llmError } = await chatJson({
      env,
      messages: [
        {
          role: "system",
          content:
            "You are a helpful admin assistant for MehyarSoft CRM. " +
            "Answer the user's question based on the database schema: " +
            "leads(id, created_at, source, form_type, status, name, email, company, website, service_interest, budget_range), " +
            "prospects(id, business_name, website, status, stage, last_touched_at, last_sent_at, last_drafted_at), " +
            "gov_opportunities(id, title, agency, status, stage, response_deadline, posted_date), " +
            "prospect_sends(id, prospect_id, status, created_at), " +
            "opportunity_decisions(id, kind, opportunity_id, decision, reason_code, reason_body, decided_at). " +
            "Keep answers concise. If you don't know, say so.",
        },
        { role: "user", content: question },
      ],
      max_tokens: 400,
    });

    if (used_llm && content) {
      answer = content;
      source = "llm";
    } else {
      // LLM also failed — use appsolut fallback
      const template = appsolutFallback(question);
      answer = template || "I couldn't answer that question. Try asking about leads, prospects, pipeline status, or recent activity.";
      source = "appsolut";
    }
  } else {
    // No SQL detected — try appsolut first, then LLM
    const template = appsolutFallback(question);
    if (template) {
      answer = template;
      source = "appsolut";
    } else {
      const { content, used_llm } = await chatJson({
        env,
        messages: [
          {
            role: "system",
            content:
              "You are a helpful admin assistant for MehyarSoft CRM. " +
              "Answer based on the schema: leads, prospects, gov_opportunities, prospect_sends, opportunity_decisions. " +
              "Keep answers short and actionable.",
          },
          { role: "user", content: question },
        ],
        max_tokens: 400,
      });
      if (used_llm && content) {
        answer = content;
        source = "llm";
      } else {
        answer = template || "I'm not sure how to answer that. Try asking about leads, prospects, or pipeline status.";
        source = "appsolut";
      }
    }
  }

  return json(
    {
      ok: true,
      question,
      answer,
      source, // "sql" | "llm" | "appsolut"
      sqlResult: sqlResult ? { query: sqlResult.query, count: sqlResult.count } : null,
      sqlError: sqlError || null,
    },
    200,
    request,
    env
  );
}
