// Regression tests for the stale LLM-contract fix (2026-10-09).
// chat-eval, chat-analyze, and deep-analyze used to check `llmResp?.ok` /
// `llmResp.json` / `llmResp.text` — fields chatJson() never returns — so every
// model-success call returned HTTP 502 `llm_unavailable`.
// chatJson() returns { used_llm, content, model, usage, ... }; these tests
// stub global fetch (no network) and prove: success -> 200 (not 502), genuine
// LLM failure -> 502, garbage content -> fallback behavior per endpoint.
//
// Run with: node functions/api/_shared/adminLlmContract.test.js
// Exit non-zero on failure.

import { onRequestPost as chatEvalPost } from "../admin/leads/[id]/chat-eval.js";
import { onRequestPost as chatAnalyzePost } from "../admin/prospects/[id]/chat-analyze.js";
import { onRequestPost as deepAnalyzePost } from "../admin/prospects/[id]/deep-analyze.js";

let passed = 0, failed = 0;
function ok(cond, name, extra) {
  if (cond) passed++;
  else { failed++; console.error(`FAIL ${name}${extra ? `\n  ${extra}` : ""}`); }
}

// ─── fetch stub ─────────────────────────────────────────────────────────────
// Modes for the LLM leg: "success" (valid JSON content), "garbage" (non-JSON
// content), "http500" (provider error). The auth leg always succeeds.
let llmMode = "success";
const LLM_CONTENT = JSON.stringify({ reply: "test reply from model", patch: null });

globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes("/v1/admin/me")) {
    return { ok: true, json: async () => ({ ok: true, sub: "owner" }) };
  }
  if (llmMode === "http500") {
    return { ok: false, status: 500, text: async () => "provider boom" };
  }
  const content = llmMode === "garbage" ? "this is not json at all" : LLM_CONTENT;
  return {
    ok: true,
    json: async () => ({
      choices: [{ message: { content } }],
      model: "test-model",
      usage: { total_tokens: 10 },
    }),
  };
};

// ─── fake D1 ────────────────────────────────────────────────────────────────
function fakeDb() {
  return {
    prepare(sql) {
      return {
        bind() {
          return {
            first: async () => {
              if (sql.includes("FROM prospects")) {
                return { id: "p1", business_name: "Test Co", root_domain: "test.co" };
              }
              return null; // signals / cached deep_analyze: nothing cached
            },
            all: async () => ({ results: [] }),
            run: async () => ({}),
          };
        },
      };
    },
  };
}
const env = {
  LEADS_DB: fakeDb(),
  LLM_PROVIDER: "openai",
  LLM_BASE_URL: "https://test-llm.local",
  LLM_API_KEY: "test-key",
  LLM_CACHE_TTL: "0", // disable chatJson's in-memory cache so mode switches take effect
};

const UUID_TOKEN = "123e4567-e89b-12d3-a456-426614174000";
function postReq(url, body) {
  return new Request(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${UUID_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}
async function readJson(resp) {
  return { status: resp.status, body: await resp.json() };
}

// ─── 1. chat-eval: success must be 200, not 502 ─────────────────────────────
{
  llmMode = "success";
  const resp = await chatEvalPost({
    request: postReq("https://x/api/admin/leads/abc/chat-eval?kind=prospect", {
      message: "why is the fit score 65?",
      current_eval: { services: [], pricing_tiers: [] },
    }),
    env, params: { id: "abc" },
  });
  const { status, body } = await readJson(resp);
  ok(status === 200, "chat-eval success -> 200", `got ${status} ${JSON.stringify(body).slice(0, 160)}`);
  ok(body.ok === true && body.reply === "test reply from model", "chat-eval success -> reply parsed", JSON.stringify(body).slice(0, 200));
  ok(body.used_llm === true, "chat-eval success -> used_llm true");
}

// ─── 2. chat-eval: genuine LLM failure still 502s ────────────────────────────
{
  llmMode = "http500";
  const resp = await chatEvalPost({
    request: postReq("https://x/api/admin/leads/abc/chat-eval?kind=prospect", {
      message: "why?", current_eval: { services: [], pricing_tiers: [] },
    }),
    env, params: { id: "abc" },
  });
  const { status, body } = await readJson(resp);
  ok(status === 502 && body.error === "llm_unavailable", "chat-eval provider failure -> 502 llm_unavailable", `got ${status} ${JSON.stringify(body).slice(0, 120)}`);
}

// ─── 3. chat-eval: garbage content falls back to plain reply (200) ──────────
{
  llmMode = "garbage";
  const resp = await chatEvalPost({
    request: postReq("https://x/api/admin/leads/abc/chat-eval?kind=prospect", {
      message: "why?", current_eval: { services: [], pricing_tiers: [] },
    }),
    env, params: { id: "abc" },
  });
  const { status, body } = await readJson(resp);
  ok(status === 200 && body.ok === true, "chat-eval garbage content -> 200", `got ${status}`);
  ok(body.reply === "this is not json at all", "chat-eval garbage -> raw content as reply", JSON.stringify(body.reply));
}

// ─── 4. chat-analyze: success must be 200, not 502 ──────────────────────────
{
  llmMode = "success";
  const resp = await chatAnalyzePost({
    request: postReq("https://x/api/admin/prospects/p1/chat-analyze", {
      message: "add a pain point",
      current_analysis: { pain_points: [] },
    }),
    env, params: { id: "p1" },
  });
  const { status, body } = await readJson(resp);
  ok(status === 200, "chat-analyze success -> 200", `got ${status} ${JSON.stringify(body).slice(0, 160)}`);
  ok(body.ok === true && body.reply === "test reply from model", "chat-analyze success -> reply parsed", JSON.stringify(body).slice(0, 200));
}

// ─── 5. chat-analyze: genuine LLM failure still 502s ────────────────────────
{
  llmMode = "http500";
  const resp = await chatAnalyzePost({
    request: postReq("https://x/api/admin/prospects/p1/chat-analyze", {
      message: "hi", current_analysis: { pain_points: [] },
    }),
    env, params: { id: "p1" },
  });
  const { status, body } = await readJson(resp);
  ok(status === 502 && body.error === "llm_unavailable", "chat-analyze provider failure -> 502 llm_unavailable", `got ${status}`);
}

// ─── 6. deep-analyze: success must be 200 with sanitized analysis ────────────
{
  llmMode = "success";
  const resp = await deepAnalyzePost({
    request: postReq("https://x/api/admin/prospects/p1/deep-analyze", {}),
    env, params: { id: "p1" },
  });
  const { status, body } = await readJson(resp);
  ok(status === 200, "deep-analyze success -> 200", `got ${status} ${JSON.stringify(body).slice(0, 160)}`);
  ok(body.ok === true && body.used_llm === true, "deep-analyze success -> ok + used_llm", JSON.stringify(body).slice(0, 200));
  ok(body.analysis && typeof body.analysis.fit_score === "number", "deep-analyze success -> sanitized analysis", JSON.stringify(body.analysis || null).slice(0, 120));
}

// ─── 7. deep-analyze: genuine LLM failure still 502s ────────────────────────
{
  llmMode = "http500";
  const resp = await deepAnalyzePost({
    request: postReq("https://x/api/admin/prospects/p1/deep-analyze", {}),
    env, params: { id: "p1" },
  });
  const { status, body } = await readJson(resp);
  ok(status === 502 && body.error === "llm_unavailable", "deep-analyze provider failure -> 502 llm_unavailable", `got ${status}`);
}

// ─── 8. deep-analyze: garbage content -> 502 llm_parse_failed ───────────────
{
  llmMode = "garbage";
  const resp = await deepAnalyzePost({
    request: postReq("https://x/api/admin/prospects/p1/deep-analyze", {}),
    env, params: { id: "p1" },
  });
  const { status, body } = await readJson(resp);
  ok(status === 502 && body.error === "llm_parse_failed", "deep-analyze garbage -> 502 llm_parse_failed", `got ${status} ${JSON.stringify(body).slice(0, 120)}`);
}

console.log(`adminLlmContract: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
