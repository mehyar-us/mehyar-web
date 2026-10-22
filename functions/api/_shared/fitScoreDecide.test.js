// Integration test: fitScoreOne decide()-first fast path.
// Run: node functions/api/_shared/fitScoreDecide.test.js
// Mocks decide()'s transport (no network). The LLM fallback path is exercised
// with an env that has no credentials, so chatJson() fails closed.
import { fitScoreOne } from "./cloudflareAI.js";

let passed = 0, failed = 0;
function eq(a, e, name) {
  if (JSON.stringify(a) === JSON.stringify(e)) passed++;
  else { failed++; console.error(`FAIL ${name}\n  expected: ${JSON.stringify(e)}\n  actual:   ${JSON.stringify(a)}`); }
}
function ok(c, name) { if (c) passed++; else { failed++; console.error(`FAIL ${name}`); } }

const mockTransport = (answers) => async () => ({
  raw: { model: "clef-flash", answers, usage: { input_tokens: 200, output_tokens: 0 } },
  latencyMs: 40, via: "mock",
});
const NO_AUTH_ENV = {}; // chatJson -> used_llm:false without credentials
const ITEM = { title: "Brand-name toner cartridge renewal", agency: "Dept X",
  opportunity_type: "license resale", summary: "Renewal of brand-name toner." };

async function main() {
  // 1. High-confidence clear pass -> fast path, no LLM shape fields invented.
  {
    const r = await fitScoreOne(NO_AUTH_ENV, ITEM, null, {
      decideTransport: mockTransport({
        fit: { type: "score", score: 0.7, legend: { 0: "No fit", 1: "Weak", 2: "Moderate", 3: "Strong", 4: "Perfect" },
               probabilities: { 0: 0.85, 1: 0.1, 2: 0.03, 3: 0.01, 4: 0.01 } },
        action: { type: "choice", choice: "pass", probabilities: { pass: 0.9, draft_proposal: 0.05, ask_user: 0.03, check_referral: 0.02 } },
      }),
    });
    eq(r.used_decision_model, true, "fast path flagged");
    eq(r.parsed.next_action, "pass", "fast path next_action=pass");
    ok(r.parsed.fit_score <= 35, "fast path score <= 35");
    eq(r.provider, "cloudflare-decide", "provider labeled");
    ok(typeof r.neurons === "number", "neurons reported");
  }

  // 2. High-confidence HIGH score -> falls through to LLM path (unchanged behavior).
  {
    const r = await fitScoreOne(NO_AUTH_ENV, ITEM, null, {
      decideTransport: mockTransport({
        fit: { type: "score", score: 3.6, legend: { 0: "No fit", 1: "Weak", 2: "Moderate", 3: "Strong", 4: "Perfect" },
               probabilities: { 0: 0.01, 1: 0.03, 2: 0.06, 3: 0.2, 4: 0.7 } },
        action: { type: "choice", choice: "draft_proposal", probabilities: { draft_proposal: 0.88, pass: 0.05, ask_user: 0.04, check_referral: 0.03 } },
      }),
    });
    ok(!r.used_decision_model, "high score does not take fast path");
    eq(r.used_llm, false, "LLM path attempted (no auth -> used_llm false)");
    eq(r.parsed, null, "LLM path parse null without auth (existing behavior)");
  }

  // 3. decide() transport throws -> falls through, no crash.
  {
    const r = await fitScoreOne(NO_AUTH_ENV, ITEM, null, {
      decideTransport: async () => { throw new Error("net down"); },
    });
    ok(!r.used_decision_model, "transport failure -> no fast path");
    eq(r.used_llm, false, "falls through to LLM path shape");
  }

  // 4. Low-confidence score -> falls through (review, not auto).
  {
    const r = await fitScoreOne(NO_AUTH_ENV, ITEM, null, {
      decideTransport: mockTransport({
        fit: { type: "score", score: 0.5, legend: { 0: "No fit", 1: "Weak", 2: "Moderate", 3: "Strong", 4: "Perfect" },
               probabilities: { 0: 0.3, 1: 0.3, 2: 0.2, 3: 0.1, 4: 0.1 } },
        action: { type: "choice", choice: "pass", probabilities: { pass: 0.4, draft_proposal: 0.3, ask_user: 0.2, check_referral: 0.1 } },
      }),
    });
    ok(!r.used_decision_model, "low confidence -> no fast path");
  }

  // 5. Malformed decide answers -> falls through safely.
  {
    const r = await fitScoreOne(NO_AUTH_ENV, ITEM, null, {
      decideTransport: mockTransport({ fit: { type: "score", score: "nan", legend: {} } }),
    });
    ok(!r.used_decision_model, "malformed answers -> no fast path");
    eq(r.used_llm, false, "existing LLM-path shape preserved");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error("HARNESS ERROR", e); process.exit(1); });
