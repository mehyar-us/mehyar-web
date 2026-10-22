// Unit tests for decide.js — run with: node functions/api/_shared/decide.test.js
// Mocks the transport (no network, no credentials). Exit non-zero on failure.
import { decide, verdict, stateParts, DECIDE_THRESHOLDS, DECIDE_MAX_QUESTIONS } from "./decide.js";

let passed = 0, failed = 0;
function eq(actual, expected, name) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { passed++; }
  else { failed++; console.error(`FAIL ${name}\n  expected: ${e}\n  actual:   ${a}`); }
}
function ok(cond, name) {
  if (cond) passed++;
  else { failed++; console.error(`FAIL ${name}`); }
}

// Mock transport: captures wire bodies, returns canned Jev answers.
function mockTransport(handler) {
  const calls = [];
  const fn = async (env, wireBody, opts) => {
    calls.push(wireBody);
    return handler(wireBody);
  };
  fn.calls = calls;
  return fn;
}

const JEV_OK = {
  raw: {
    model: "clef-flash",
    answers: {
      spam: { type: "noul", noul: 0.91 },
      intent: { type: "choice", choice: "booking",
        probabilities: { booking: 0.82, cancel: 0.1, price: 0.05, spam: 0.03 }, confidence: 0.7 },
      winnable: { type: "score", score: 3.4, legend: { 0: "No", 1: "Unlikely", 2: "Maybe", 3: "Likely", 4: "Yes" },
        probabilities: { 0: 0.05, 1: 0.1, 2: 0.15, 3: 0.5, 4: 0.2 }, confidence: 0.5 },
    },
    usage: { input_tokens: 120, output_tokens: 0 },
  },
  latencyMs: 40, via: "mock",
};

const QUESTIONS = {
  spam:     { type: "noul", ask: "This message is spam" },
  intent:   { type: "choice", ask: "What does the sender want?",
              options: { booking: "wants to book", cancel: "wants to cancel", price: "asking price", spam: "junk" } },
  winnable: { type: "score", ask: "How likely is dismissal?",
              levels: ["No", "Unlikely", "Maybe", "Likely", "Yes"] },
};

async function main() {
  // 1. Happy path: normalization of all three types.
  {
    const t = mockTransport(() => JEV_OK);
    const r = await decide({}, "hello", QUESTIONS, { transport: t, audit: () => {} });
    ok(r.ok, "happy ok");
    eq(r.answers.spam.decision, true, "noul decision");
    eq(r.answers.spam.confidence, 0.91, "noul confidence=max(p,1-p)");
    eq(r.answers.intent.decision, "booking", "choice decision");
    eq(r.answers.intent.confidence, 0.82, "choice confidence=winner prob");
    eq(r.answers.winnable.decision, 85, "score normalized 0-100 (3.4/4)");
    eq(r.answers.winnable.confidence, 0.5, "score confidence=max level prob");
    eq(r.usage.input_tokens, 120, "usage passthrough");
    eq(r.via, "mock", "via passthrough");
  }

  // 2. Wire format matches verified Jev schema.
  {
    const t = mockTransport(() => JEV_OK);
    await decide({}, "hi", { q1: { type: "noul", ask: "X?" } }, { transport: t, audit: () => {} });
    const body = t.calls[0];
    eq(body.model, "clef-flash", "wire model short name");
    eq(body.state, "hi", "wire state passthrough");
    eq(body.questions.q1, { type: "noul", instructions: "X?" }, "wire noul question");
  }
  {
    const t = mockTransport(() => JEV_OK);
    await decide({}, "hi", QUESTIONS, { transport: t, audit: () => {} });
    const q = t.calls[0].questions;
    eq(q.intent.criteria, QUESTIONS.intent.options, "choice criteria=options object");
    eq(q.winnable.criteria, QUESTIONS.winnable.levels, "score criteria=levels array");
  }

  // 3. verdict() thresholds.
  {
    eq(verdict({ ok: true, confidence: 0.9 }), "auto", "verdict auto");
    eq(verdict({ ok: true, confidence: 0.6 }), "review", "verdict review");
    eq(verdict({ ok: true, confidence: 0.4 }), "fail", "verdict fail");
    eq(verdict({ ok: false, confidence: 0.9 }), "fail", "verdict fail on !ok");
    eq(verdict({ ok: true, confidence: 0.85 }, DECIDE_THRESHOLDS.ticketbeat_winnable), "auto", "domain preset auto");
    eq(verdict({ ok: true, confidence: 0.7 }, DECIDE_THRESHOLDS.ticketbeat_winnable), "review", "domain preset review");
  }

  // 4. Transport failure → ok:false, per-question error, caller can fall back.
  {
    const t = mockTransport(() => { throw new Error("boom"); });
    const r = await decide({}, "hi", QUESTIONS, { transport: t, audit: () => {} });
    ok(!r.ok, "transport failure ok=false");
    ok(r.fallback === true, "fallback flag set");
    ok(r.answers.spam.ok === false, "per-question ok=false");
  }

  // 5. Malformed answers → per-question ok:false, others still normalize.
  {
    const t = mockTransport(() => ({ raw: { answers: {
      a: { type: "noul", noul: "garbage" },
      b: { type: "choice", choice: "zzz", probabilities: { booking: 1 } },
      c: { type: "noul", noul: 0.2 },
    } }, latencyMs: 1, via: "mock" }));
    const r = await decide({}, "hi", {
      a: { type: "noul", ask: "A?" }, b: { type: "choice", ask: "B?", options: { booking: "x" } },
      c: { type: "noul", ask: "C?" },
    }, { transport: t, audit: () => {} });
    ok(r.ok, "batch ok even with bad answers");
    ok(!r.answers.a.ok, "bad noul flagged");
    ok(!r.answers.b.ok, "choice winner not in distribution flagged");
    eq(r.answers.c.decision, false, "good answer still normalizes");
    eq(r.answers.c.confidence, 0.8, "noul confidence uses 1-p when p<0.5");
  }

  // 6. Batching: 70 questions → 2 wire calls (64 + 6).
  {
    const qs = {};
    const rawAnswers = {};
    for (let i = 0; i < 70; i++) { qs["q" + i] = { type: "noul", ask: "Q" + i + "?" }; rawAnswers["q" + i] = { type: "noul", noul: 0.6 }; }
    const t = mockTransport(() => ({ raw: { answers: rawAnswers, usage: { input_tokens: 10, output_tokens: 0 } }, latencyMs: 1, via: "mock" }));
    const r = await decide({}, "hi", qs, { transport: t, audit: () => {} });
    eq(t.calls.length, 2, "70 questions → 2 calls");
    eq(Object.keys(t.calls[0].questions).length, 64, "first chunk 64");
    eq(Object.keys(t.calls[1].questions).length, 6, "second chunk 6");
    eq(Object.keys(r.answers).length, 70, "all answers merged");
    eq(DECIDE_MAX_QUESTIONS, 64, "chunk constant");
  }

  // 7. Validation: no questions / empty state / bad question shape.
  {
    const t = mockTransport(() => JEV_OK);
    eq((await decide({}, "hi", {}, { transport: t, audit: () => {} })).error, "decide_no_questions", "empty questions rejected");
    eq((await decide({}, "  ", QUESTIONS, { transport: t, audit: () => {} })).error, "decide_empty_state", "empty state rejected");
    const r = await decide({}, "hi", { q: { type: "choice", ask: "X?" } }, { transport: t, audit: () => {} });
    ok(!r.ok && /choice_needs_options/.test(r.error), "choice without options rejected before transport");
    eq(t.calls.length, 0, "no transport call on validation failure");
  }

  // 8. Audit entry carries decisions, never state text.
  {
    let entry = null;
    const t = mockTransport(() => JEV_OK);
    await decide({}, "SECRET-PII-STATE", QUESTIONS, { transport: t, audit: (e) => { entry = e; } });
    const s = JSON.stringify(entry);
    ok(!s.includes("SECRET-PII-STATE"), "audit never contains state text");
    ok(entry.questions.length === 3, "audit has per-question rows");
    eq(entry.questions[0].decision, true, "audit decision recorded");
    ok(typeof entry.usage.input_tokens === "number", "audit usage recorded");
  }

  // 9. stateParts helper: text + up to 4 images.
  {
    const parts = stateParts("describe", ["u1", "u2", "u3", "u4", "u5"]);
    eq(parts.length, 5, "text + 4 images (5th dropped)");
    eq(parts[0], { type: "text", text: "describe" }, "text part");
    eq(parts[1], { type: "image_url", image_url: { url: "u1" } }, "image part shape");
  }

  // 10. noul boundary: p exactly 0.5 → true (fail-closed choice documented).
  {
    const t = mockTransport(() => ({ raw: { answers: { q: { type: "noul", noul: 0.5 } } }, latencyMs: 1, via: "mock" }));
    const r = await decide({}, "hi", { q: { type: "noul", ask: "X?" } }, { transport: t, audit: () => {} });
    eq(r.answers.q.decision, true, "noul 0.5 → true");
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error("HARNESS ERROR", e); process.exit(1); });
